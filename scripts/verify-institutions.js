const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createAuthService } = require('../services/authService');
const { createInstitutionService } = require('../services/institutionService');
const { createGroupChatService } = require('../services/groupChatService');
const { createMessageService } = require('../services/messageService');
const { createApp } = require('../index');

async function verify() {
  const db = createDatabase();
  const accounts = [], institutionIds = [];
  let server;
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(info.name.toLowerCase(), 'proyectointegrador');
    const auth = createAuthService(db);
    for (let index = 0; index < 6; index++) {
      const suffix = randomBytes(5).toString('hex');
      const account = { name: `inst_${suffix}`, email: `${suffix}@prueba.local`, password: randomBytes(16).toString('hex') };
      const result = await auth.register({ ...account, typeUser: 'superadmin', groupCode: '3ro TIC' });
      assert.equal(result.user.typeUser, 'user');
      assert.equal(result.user.hasAccess, false);
      accounts.push({ ...result, ...account, cookie: `anima_session=${result.token}` });
    }
    const [root, adminA, adminB, studentA, studentB, outsider] = accounts;
    await db.execute("UPDATE users SET typeUser = 'superadmin' WHERE idUser = ?", [root.user.idUser]);
    server = createApp(auth, { institutionService: createInstitutionService(db, auth), groupChatService: createGroupChatService(db, auth), messageService: createMessageService(db, auth), sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, account, body, method) {
      const response = await fetch(base + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: account.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await request('/platform/institutions')).status, 401);
    assert.equal((await request('/platform/institutions', studentA)).status, 403);
    for (const [label, groupCodes] of [['A', ['3ro TIC', '1ro ADM']], ['B', ['3ro TIC']]]) {
      const created = await request('/platform/institutions', root, { name: `Institución prueba ${label} ${randomBytes(5).toString('hex')}`, groupCodes });
      assert.equal(created.status, 201);
      institutionIds.push(created.data.id);
    }
    const platform = (await request('/platform/institutions', root)).data;
    const spaceA = platform.spaces.find(space => space.institutionId === institutionIds[0] && space.name === '3ro TIC');
    const extraA = platform.spaces.find(space => space.institutionId === institutionIds[0] && space.name === '1ro ADM');
    const spaceB = platform.spaces.find(space => space.institutionId === institutionIds[1]);
    assert.notEqual(spaceA.id, spaceB.id);
    assert.equal((await request('/platform/administrators', adminA, { user: adminA.name, spaceIds: [spaceA.id] })).status, 403);
    assert.equal((await request('/platform/administrators', root, { user: adminA.name, spaceIds: [spaceA.id, extraA.id] })).status, 200);
    assert.equal((await request('/platform/administrators', root, { user: adminB.email, spaceIds: [spaceB.id] })).status, 200);
    assert.equal((await auth.profile(adminA.token)).canPurchase, true);
    const payment = { plan: 'Small Plan', method: 'Visa', spaceIds: [spaceA.id] };
    assert.equal((await request('/payments/simulate', root, payment)).status, 403);
    assert.equal((await request('/payments/simulate', studentA, payment)).status, 403);
    assert.equal((await request('/payments/simulate', adminA, { ...payment, spaceIds: [spaceB.id] })).status, 403);
    assert.equal((await request('/payments/simulate', adminA, payment)).status, 200);
    assert.equal((await auth.profile(studentA.token)).hasAccess, false);
    assert.equal((await request('/users/group', studentA, { groupCode: '3ro TIC' })).status, 403);
    assert.equal((await request('/group-chat?spaceId=' + spaceA.id, studentA)).status, 403);
    assert.equal((await request(`/admin/spaces/${spaceB.id}/members`, adminA, { user: studentA.name })).status, 403);
    assert.equal((await request(`/admin/spaces/${spaceA.id}/members`, adminA, { user: studentA.name, typeUser: 'admin' })).status, 200);
    const admitted = await auth.profile(studentA.token);
    assert.equal(admitted.typeUser, 'user');
    assert.equal(admitted.hasAccess, true);
    assert.equal(admitted.purchase, null);
    assert.deepEqual(admitted.spaces.map(space => space.id), [spaceA.id]);
    assert.equal((await request(`/admin/spaces/${spaceB.id}/members`, adminB, { user: studentB.email })).status, 200);
    assert.equal((await auth.profile(studentB.token)).hasAccess, false);
    assert.equal((await request('/payments/simulate', adminB, { ...payment, spaceIds: [spaceB.id] })).status, 200);
    assert.equal((await request('/group-chat?spaceId=' + spaceB.id, studentA)).status, 403);
    const markerA = randomBytes(8).toString('hex'), markerB = randomBytes(8).toString('hex');
    assert.equal((await request('/group-chat/messages', studentA, { content: markerA, spaceId: spaceA.id, senderId: studentB.user.idUser })).status, 201);
    assert.equal((await request('/group-chat/messages', studentB, { content: markerB, spaceId: spaceB.id })).status, 201);
    assert.equal((await request('/group-chat/messages', studentA, { content: 'ajeno', spaceId: spaceB.id })).status, 403);
    const historyA = (await request('/group-chat?spaceId=' + spaceA.id, adminA)).data.messages;
    const historyB = (await request('/group-chat?spaceId=' + spaceB.id, studentB)).data.messages;
    assert.equal(historyA[0].content, markerA);
    assert.equal(historyA[0].senderId, studentA.user.idUser);
    assert.equal(historyB[0].content, markerB);
    assert.ok(!historyA.some(message => message.content === markerB));
    assert.equal((await request(`/admin/spaces/${spaceA.id}/members`, outsider)).status, 403);
    const message = { recipient: adminA.name, subject: 'Prueba privada', content: 'Consulta de mi espacio', spaceId: spaceA.id };
    assert.equal((await request('/messages', studentA, { ...message, recipient: studentB.name })).status, 400);
    const sent = await request('/messages', studentA, message);
    assert.equal(sent.status, 201);
    assert.equal((await request(`/messages/${sent.data.threadId}`, adminB)).status, 404);
    assert.equal((await request(`/messages/${sent.data.threadId}/replies`, adminA, { content: 'Respuesta' })).status, 201);
    assert.equal((await request('/messages?filter=received', studentA)).data.threads.length, 1);
    assert.equal((await request(`/messages/${sent.data.threadId}/star`, studentA, { starred: true })).status, 200);
    assert.equal((await request('/messages?filter=starred', studentA)).data.threads.length, 1);
    await request(`/admin/spaces/${spaceA.id}/members/${studentA.user.idUser}`, adminA, undefined, 'DELETE');
    assert.equal((await auth.profile(studentA.token)).hasAccess, false);
    assert.equal((await request(`/messages/${sent.data.threadId}`, studentA)).status, 403);
    await request(`/admin/spaces/${spaceA.id}/members`, adminA, { user: studentA.name });
    await request('/admin/plan/groups', adminA, { spaceIds: [extraA.id] });
    assert.equal((await auth.profile(studentA.token)).hasAccess, false);
    await request('/admin/plan/groups', adminA, { spaceIds: [spaceA.id, extraA.id] });
    assert.equal((await auth.profile(studentA.token)).hasAccess, true);
    await request(`/platform/spaces/${spaceA.id}/administrators/${adminA.user.idUser}`, root, undefined, 'DELETE');
    assert.equal((await auth.profile(studentA.token)).hasAccess, false);
    assert.equal((await auth.profile(studentB.token)).hasAccess, true);
    console.log('Flujo institucional verificado: superadmin → administrador autorizado → plan → miembro admitido; instituciones aisladas, mismo curso sin mezclar, revocación, chat y mensajes privados.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      const id = account.user.idUser;
      await db.execute('DELETE FROM message_stars WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM mesages WHERE senderId = ? OR recipientId = ?', [id, id]);
      await db.execute('DELETE FROM message_threads WHERE senderId = ? OR recipientId = ?', [id, id]);
      await db.execute('DELETE FROM group_chat_messages WHERE senderId = ?', [id]);
      await db.execute('DELETE FROM admin_plan_spaces WHERE adminId = ?', [id]);
      await db.execute('DELETE FROM space_memberships WHERE idUser = ? OR grantedBy = ?', [id, id]);
      await db.execute('DELETE FROM space_administrators WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM simulated_purchases WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [id, account.name]);
    }
    for (const id of institutionIds) { await db.execute('DELETE FROM communication_spaces WHERE institutionId = ?', [id]); await db.execute('DELETE FROM institutions WHERE id = ?', [id]); }
    await db.end();
    console.log('Instituciones, cuentas y mensajes temporales eliminados.');
  }
}
verify().catch(err => { console.error('Falló el flujo institucional:', err.code || err.message); process.exitCode = 1; });
