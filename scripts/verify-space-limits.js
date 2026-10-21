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
  let institutionId;
  let server;
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(info.name.toLowerCase(), 'proyectointegrador');
    const auth = createAuthService(db);
    const institutions = createInstitutionService(db, auth);
    for (let index = 0; index < 34; index++) {
      const suffix = randomBytes(5).toString('hex');
      const name = `lim_${suffix}`;
      const registered = await auth.register({ name, email: `${suffix}@prueba.local`, password: randomBytes(16).toString('hex') });
      accounts.push({ ...registered, name });
    }
    const [root, admin, other, ...students] = accounts;
    await db.execute("UPDATE users SET typeUser = 'superadmin' WHERE idUser = ?", [root.user.idUser]);
    const created = await institutions.createInstitution(root.token, { name: `Límites ${randomBytes(5).toString('hex')}`, groupCodes: require('../config/groups.json') });
    institutionId = created.id;
    const [spaces] = await db.execute('SELECT id FROM communication_spaces WHERE institutionId = ? ORDER BY id', [institutionId]);
    const ids = spaces.map(space => space.id);
    await institutions.grantAdministrator(root.token, { user: admin.name, spaceIds: ids });
    await auth.simulatePurchase(admin.token, { plan: 'Small Plan', method: 'Visa', spaceIds: ids.slice(0, 3) });
    await institutions.grantMember(admin.token, ids[0], { user: other.name });
    await institutions.grantAdministrator(root.token, { user: other.name, spaceIds: ids });
    assert.equal((await auth.profile(admin.token)).typeUser, 'admin');
    assert.equal((await auth.profile(other.token)).typeUser, 'admin');
    assert.equal((await institutions.members(admin.token, ids[0])).members.length, 0);

    server = createApp(auth, { institutionService: institutions, sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, account, body, method) {
      const response = await fetch(base + path, {
        method: method || (body === undefined ? 'GET' : 'POST'),
        headers: { 'Content-Type': 'application/json', Cookie: `anima_session=${account.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }
    for (const [plan, limit] of Object.entries(require('../config/planLimits.json'))) {
      const paid = await request('/payments/simulate', admin, { plan, method: 'Visa', spaceIds: ids.slice(0, limit) });
      assert.equal(paid.status, 200, JSON.stringify(paid.data));
      assert.equal(paid.data.user.spaces.filter(space => space.isActive).length, Math.min(limit, ids.length));
      if (limit < ids.length) {
        assert.equal((await request('/payments/simulate', admin, { plan, method: 'Visa', spaceIds: ids.slice(0, limit + 1) })).status, 400);
        assert.equal((await request('/admin/plan/groups', admin, { spaceIds: ids.slice(0, limit + 1) })).status, 400);
      }
    }
    await db.execute('UPDATE simulated_purchases SET plan = ?, amount = ? WHERE idUser = ?', ['Medium Plan', 500, admin.user.idUser]);
    assert.equal((await auth.profile(admin.token)).hasAccess, true);
    assert.equal((await request('/admin/plan/groups', admin, { spaceIds: ids.slice(0, 4) })).status, 200);
    assert.equal((await auth.profile(admin.token)).spaces.filter(space => space.isActive).length, 4);
    const downgraded = await request('/payments/simulate', admin, { plan: 'Small Plan', method: 'Visa', spaceIds: ids.slice(0, 3) });
    assert.equal(downgraded.status, 200);
    assert.equal(downgraded.data.user.spaces.filter(space => space.isActive).length, 3);
    assert.equal((await request('/payments/simulate', other, { plan: 'Small Plan', method: 'Visa', spaceIds: ids.slice(3) })).status, 200);
    assert.equal((await request(`/admin/spaces/${ids[0]}`, students[0], { name: 'Sin permiso' }, 'PATCH')).status, 403);
    assert.equal((await request(`/admin/spaces/${ids[0]}`, admin, { name: ' ' }, 'PATCH')).status, 400);
    assert.equal((await request(`/admin/spaces/${ids[0]}`, admin, { name: 'a'.repeat(31) }, 'PATCH')).status, 400);
    assert.equal((await request(`/admin/spaces/${ids[0]}`, admin, { name: 'Clase personalizada' }, 'PATCH')).status, 200);
    assert.equal((await request(`/admin/spaces/${ids[1]}`, admin, { name: 'Clase personalizada' }, 'PATCH')).status, 409);
    assert.equal((await auth.profile(admin.token)).managedSpaces.find(space => space.id === ids[0]).name, 'Clase personalizada');

    for (const student of students.slice(0, 24)) await institutions.grantMember(admin.token, ids[0], { user: student.name });
    const admission = await Promise.all(students.slice(24).map(student => request(`/admin/spaces/${ids[0]}/members`, admin, { user: student.name })));
    assert.equal(admission.filter(result => result.status === 409).length, 1);
    assert.equal(admission.filter(result => result.status === 200).length, admission.length - 1);
    const members = await institutions.members(admin.token, ids[0]);
    assert.equal(members.members.length, 25);
    assert.equal(members.capacity, 25);
    assert.equal(members.available, 0);
    await institutions.grantMember(admin.token, ids[0], { user: students[0].name });
    await institutions.revokeMember(admin.token, ids[0], students[0].user.idUser);
    const waiting = students[24 + admission.findIndex(result => result.status === 409)];
    await institutions.grantMember(admin.token, ids[0], { user: waiting.name });
    assert.equal((await institutions.members(admin.token, ids[0])).members.length, 25);

    assert.equal((await request('/admin/plan', students[0], undefined, 'DELETE')).status, 403);
    assert.equal((await request('/admin/plan', admin, undefined, 'DELETE')).status, 200);
    assert.equal((await request('/admin/plan', admin, undefined, 'DELETE')).status, 200);
    const canceled = await auth.profile(admin.token);
    assert.equal(canceled.purchase, null);
    assert.equal(canceled.typeUser, 'admin');
    assert.equal(canceled.hasAccess, false);
    assert.equal((await institutions.members(admin.token, ids[0])).members.length, 25);
    const competing = await Promise.all([admin, other].map((account, index) => request('/payments/simulate', account, { plan: 'Small Plan', method: 'Visa', spaceIds: ids.slice(index * 3, index * 3 + 3) })));
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 200]);
    console.log('Verificado: límites 10/20/30, cambio de plan, nombres, 25 usuarios por espacio con concurrencia, cancelación y rol admin persistente.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      const id = account.user.idUser;
      await db.execute('DELETE FROM space_memberships WHERE idUser = ? OR grantedBy = ?', [id, id]);
      await db.execute('DELETE FROM admin_plan_spaces WHERE adminId = ?', [id]);
      await db.execute('DELETE FROM space_administrators WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM simulated_purchases WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [id, account.name]);
      await db.execute('DELETE FROM institution_administrators WHERE idUser = ?', [id]);
    }
    if (institutionId) {
      await db.execute('DELETE FROM communication_spaces WHERE institutionId = ?', [institutionId]);
      await db.execute('DELETE FROM institutions WHERE id = ?', [institutionId]);
    }
    await db.end();
  }
}
verify().catch(err => { console.error('Falló la verificación de límites:', err.code || err.message); process.exitCode = 1; });
