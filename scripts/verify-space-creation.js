const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createAuthService } = require('../services/authService');
const { createInstitutionService } = require('../services/institutionService');
const { createApp } = require('../index');

async function verify() {
  const db = createDatabase();
  const accounts = [];
  const institutionIds = [];
  let server;
  try {
    const [[database]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(database.name.toLowerCase(), 'proyectointegrador');
    const auth = createAuthService(db);
    const institutions = createInstitutionService(db, auth);
    for (let index = 0; index < 5; index++) {
      const suffix = randomBytes(5).toString('hex');
      const name = `create_${suffix}`;
      accounts.push({ ...await auth.register({ name, email: `${suffix}@prueba.local`, password: randomBytes(16).toString('hex') }), name });
    }
    const [root, admin, colleague, student, outsider] = accounts;
    await db.execute("UPDATE users SET typeUser = 'superadmin' WHERE idUser = ?", [root.user.idUser]);
    for (let index = 0; index < 2; index++) institutionIds.push((await institutions.createInstitution(root.token, { name: `Creación ${randomBytes(5).toString('hex')}` })).id);
    const institutionId = institutionIds[0];
    await institutions.grantAdministrator(root.token, { user: admin.name, institutionId });
    await institutions.grantAdministrator(root.token, { user: colleague.name, institutionId });
    await institutions.grantAdministrator(root.token, { user: outsider.name, institutionId: institutionIds[1] });
    const before = await auth.profile(admin.token);
    assert.equal(before.typeUser, 'admin');
    assert.equal(before.canPurchase, true);
    assert.equal(before.managedSpaces.length, 0);
    assert.equal(before.managedInstitutions[0].spaceCount, 0);
    server = createApp(auth, { institutionService: institutions, sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, account, body, method = 'POST') {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: `anima_session=${account.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    const create = (account, name) => request('/admin/spaces', account, { institutionId, name });
    assert.equal((await request('/platform/institutions', null, undefined, 'GET')).status, 401);
    assert.equal((await request('/platform/institutions', admin, undefined, 'GET')).status, 403);
    const directory = (await request('/platform/institutions', root, undefined, 'GET')).data;
    for (const account of [admin, colleague, outsider]) assert.equal(directory.adminAccounts.filter(item => item.idUser === account.user.idUser).length, 1);
    assert.ok(!directory.adminAccounts.some(item => [root.user.idUser, student.user.idUser].includes(item.idUser)));
    assert.equal((await create(admin, 'Sin plan')).status, 409);
    assert.equal((await create(student, 'Sin permiso')).status, 403);
    assert.equal((await create(outsider, 'Otra institución')).status, 403);
    const paid = await request('/payments/simulate', admin, { institutionId, plan: 'Small Plan', method: 'Visa' });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.user.purchase.spaceIds.length, 0);
    assert.equal(paid.data.user.managedInstitutions[0].maxSpaces, 10);
    assert.equal((await auth.profile(colleague.token)).purchase.plan, 'Small Plan');
    assert.equal((await create(admin, ' ')).status, 400);
    assert.equal((await create(admin, 'a'.repeat(31))).status, 400);
    const first = await create(admin, 'Desarrollo web');
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(first.data.capacity, 25);
    assert.equal((await create(colleague, 'Desarrollo web')).status, 409);
    assert.equal((await create(colleague, 'Diseño')).status, 201);
    for (let index = 2; index < 9; index++) assert.equal((await create(admin, `Clase inicial ${index}`)).status, 201);
    const competing = await Promise.all([create(admin, 'Programación'), create(colleague, 'Matemática')]);
    assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
    assert.equal((await auth.profile(admin.token)).managedInstitutions[0].spaceCount, 3);
    while ((await auth.profile(admin.token)).managedInstitutions[0].spaceCount < 10) assert.equal((await create(admin, `Clase ${randomBytes(3).toString('hex')}`)).status, 201);
    assert.equal((await create(admin, 'No cabe')).status, 409);
    await institutions.grantMember(admin.token, first.data.id, { user: student.name });
    assert.equal((await auth.profile(student.token)).hasAccess, true);
    assert.equal((await request(`/admin/spaces/${first.data.id}`, admin, undefined, 'DELETE')).status, 200);
    assert.equal((await auth.profile(student.token)).hasAccess, false);
    assert.equal((await auth.profile(admin.token)).purchase.plan, 'Small Plan');
    assert.equal((await create(admin, 'Nuevo espacio')).status, 201);
    for (const [plan, limit] of [['Medium Plan', 20], ['Large Plan', 30]]) {
      assert.equal((await request('/payments/simulate', colleague, { institutionId, plan, method: 'Visa' })).status, 200);
      while ((await auth.profile(admin.token)).managedInstitutions[0].spaceCount < limit) assert.equal((await create(admin, `Clase ${randomBytes(3).toString('hex')}`)).status, 201);
      assert.equal((await create(colleague, 'Supera el límite')).status, 409);
    }
    assert.equal((await request('/payments/simulate', admin, { institutionId, plan: 'Small Plan', method: 'Visa' })).status, 409);
    assert.equal((await request('/admin/plan', colleague, { institutionId }, 'DELETE')).status, 200);
    assert.equal((await auth.profile(admin.token)).purchase, null);
    assert.equal((await auth.profile(admin.token)).managedSpaces.length, 30);
    assert.equal((await create(admin, 'Sin cobertura')).status, 409);
    assert.equal((await request('/payments/simulate', admin, { institutionId, plan: 'Large Plan', method: 'Visa' })).status, 200);
    for (const space of (await auth.profile(admin.token)).managedSpaces) assert.equal((await request(`/admin/spaces/${space.id}`, admin, undefined, 'DELETE')).status, 200);
    assert.equal((await auth.profile(admin.token)).purchase.plan, 'Large Plan');
    assert.equal((await create(admin, 'Después de borrar todos')).status, 201);
    assert.equal((await request(`/platform/institutions/${institutionId}/administrators/${colleague.user.idUser}`, root, undefined, 'DELETE')).status, 200);
    assert.equal((await create(colleague, 'Permiso retirado')).status, 403);
    await institutions.deleteInstitution(root.token, institutionIds[1]);
    const updatedDirectory = (await request('/platform/institutions', root, undefined, 'GET')).data;
    assert.ok(updatedDirectory.adminAccounts.some(item => item.idUser === outsider.user.idUser));
    assert.ok(!updatedDirectory.institutionAdministrators.some(item => item.idUser === outsider.user.idUser));
    console.log('Verificado: institución vacía, admin sin espacios, pago previo, creación libre con cupos 10/20/30, concurrencia, cancelación y recreación.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      const id = account.user.idUser;
      await db.execute('DELETE FROM space_memberships WHERE idUser = ? OR grantedBy = ?', [id, id]);
      await db.execute('DELETE FROM admin_plan_spaces WHERE adminId = ?', [id]);
      await db.execute('DELETE FROM space_administrators WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM institution_administrators WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM simulated_purchases WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [id, account.name]);
    }
    for (const id of institutionIds) {
      await db.execute('DELETE FROM communication_spaces WHERE institutionId = ?', [id]);
      await db.execute('DELETE FROM institutions WHERE id = ?', [id]);
    }
    await db.end();
  }
}
verify().catch(err => { console.error('Falló la creación de espacios:', err.code || err.message); process.exitCode = 1; });
