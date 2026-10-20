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
    const [[database]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(database.name.toLowerCase(), 'proyectointegrador');
    const auth = createAuthService(db);
    const institutions = createInstitutionService(db, auth);
    for (let index = 0; index < 4; index++) {
      const suffix = randomBytes(5).toString('hex');
      const credentials = { name: `status_${suffix}`, email: `${suffix}@prueba.local`, password: randomBytes(16).toString('hex') };
      accounts.push({ ...await auth.register(credentials), ...credentials });
    }
    const [root, admin, colleague, student] = accounts;
    await db.execute("UPDATE users SET typeUser = 'superadmin' WHERE idUser = ?", [root.user.idUser]);
    institutionId = (await institutions.createInstitution(root.token, { name: `Estados ${randomBytes(5).toString('hex')}` })).id;
    for (const account of [admin, colleague]) await institutions.grantAdministrator(root.token, { user: account.name, institutionId });
    await auth.simulatePurchase(admin.token, { institutionId, plan: 'Small Plan', method: 'Visa' });
    const space = await institutions.createSpace(admin.token, { institutionId, name: 'Clase de prueba' });
    await institutions.grantMember(admin.token, space.id, { user: student.name });
    const secondSession = await auth.login({ name: admin.name, password: admin.password });
    server = createApp(auth, { institutionService: institutions, sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, account, body, method = 'PATCH') {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: `anima_session=${account.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
    }
    const path = `/platform/administrators/${admin.user.idUser}`;
    assert.equal((await request(path, null, { isActive: false })).status, 401);
    assert.equal((await request(path, admin, { isActive: false })).status, 403);
    assert.equal((await request(path, student, { isActive: false })).status, 403);
    assert.equal((await request(path, root, { isActive: 'false' })).status, 400);
    assert.equal((await request(`/platform/administrators/${root.user.idUser}`, root, { isActive: false })).status, 400);
    assert.equal((await request(`/platform/administrators/${student.user.idUser}`, root, { isActive: false })).status, 400);
    assert.equal((await request('/platform/administrators/0000000000', root, { isActive: false })).status, 404);

    const failingDb = {
      async getConnection() {
        const connection = await db.getConnection();
        return {
          beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(), rollback: () => connection.rollback(), release: () => connection.release(),
          execute(sql, values) {
            if (sql === 'DELETE FROM auth_sessions WHERE idUser = ?') throw new Error('Fallo simulado');
            return connection.execute(sql, values);
          },
        };
      },
    };
    await assert.rejects(createInstitutionService(failingDb, auth).setAdministratorStatus(root.token, admin.user.idUser, { isActive: false }), /Fallo simulado/);
    assert.equal((await auth.profile(admin.token)).isActive, true);
    assert.equal((await request(path, root, { isActive: false })).status, 200);
    assert.equal((await request(path, root, { isActive: false })).status, 200);
    for (const account of [admin, secondSession]) await assert.rejects(auth.profile(account.token), err => err.status === 401);
    const blocked = await request('/auth/login', null, { name: admin.name, password: admin.password }, 'POST');
    assert.equal(blocked.status, 403);
    assert.match(blocked.data.error, /inactiva/);
    assert.equal(blocked.cookie, null);
    await institutions.grantAdministrator(root.token, { user: admin.name, institutionId });
    assert.equal((await request('/auth/login', null, { email: admin.email, password: admin.password }, 'POST')).status, 403);
    const directory = await institutions.dashboard(root.token);
    assert.equal(directory.adminAccounts.find(account => account.idUser === admin.user.idUser).isActive, false);
    assert.equal((await auth.profile(student.token)).hasAccess, true);
    assert.equal((await auth.profile(colleague.token)).purchase.plan, 'Small Plan');
    await institutions.createSpace(colleague.token, { institutionId, name: 'Plan conservado' });
    assert.equal((await request(path, root, { isActive: true })).status, 200);
    const restored = await auth.login({ name: admin.name, password: admin.password });
    assert.equal(restored.user.typeUser, 'admin');
    assert.equal(restored.user.isActive, true);
    assert.equal(restored.user.managedSpaces.length, 2);
    assert.equal(restored.user.purchase.plan, 'Small Plan');
    await assert.rejects(auth.profile(admin.token), err => err.status === 401);
    const concurrent = await Promise.all([
      request('/auth/login', null, { name: admin.name, password: admin.password }, 'POST'),
      request(path, root, { isActive: false }),
    ]);
    assert.ok([200, 403].includes(concurrent[0].status));
    assert.equal(concurrent[1].status, 200);
    const [[sessions]] = await db.execute('SELECT COUNT(*) AS count FROM auth_sessions WHERE idUser = ?', [admin.user.idUser]);
    assert.equal(sessions.count, 0);
    assert.equal((await request('/admin/spaces', restored, { institutionId, name: 'Sin permiso' }, 'POST')).status, 401);
    assert.equal((await request(path, root, { isActive: true })).status, 200);
    console.log('Verificado: estados activo/inactivo, acceso exclusivo de Thotem, sesiones revocadas, reactivación, datos conservados, concurrencia y rollback.');
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
    if (institutionId) {
      await db.execute('DELETE FROM communication_spaces WHERE institutionId = ?', [institutionId]);
      await db.execute('DELETE FROM institutions WHERE id = ?', [institutionId]);
    }
    await db.end();
  }
}
verify().catch(err => { console.error('Falló la verificación de estados:', err.code || err.message); process.exitCode = 1; });
