const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createAuthService } = require('../services/authService');
const { createGroupChatService } = require('../services/groupChatService');
const { createApp } = require('../index');
const groups = require('../config/groups.json');

async function verify() {
  const db = createDatabase();
  const accounts = [];
  let server;
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(info.name.toLowerCase(), 'proyectointegrador');
    const auth = createAuthService(db);
    for (const groupCode of [...groups, '3ro TIC', '1ro ADM']) {
      const suffix = randomBytes(5).toString('hex');
      const name = `group_${suffix}`;
      const result = await auth.register({ name, email: `${suffix}@prueba.local`, password: randomBytes(16).toString('hex'), groupCode });
      accounts.push({ ...result, name, cookie: `anima_session=${result.token}` });
      if (accounts.length <= 7) await auth.simulatePurchase(result.token, { plan: 'Small Plan', method: 'Visa' });
    }
    server = createApp(auth, { groupChatService: createGroupChatService(db, auth), sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, account, body) {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: account.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await request('/group-chat')).status, 401);
    assert.equal((await request('/group-chat/messages', null, { content: 'sin sesión' })).status, 401);
    assert.equal((await request('/group-chat', accounts[7])).status, 403);
    const markers = groups.map(() => randomBytes(8).toString('hex'));
    for (let index = 0; index < 6; index++) {
      const result = await request('/group-chat/messages', accounts[index], { content: markers[index], groupCode: groups[(index + 1) % 6], senderId: accounts[6].user.idUser });
      assert.equal(result.status, 201);
    }
    for (let index = 0; index < 6; index++) {
      const result = await request(`/group-chat?groupCode=${encodeURIComponent(groups[(index + 1) % 6])}`, accounts[index]);
      assert.equal(result.status, 200);
      assert.equal(result.data.group.code, groups[index]);
      const own = result.data.messages.find(message => message.content === markers[index]);
      assert.equal(own.senderId, accounts[index].user.idUser);
      for (let other = 0; other < 6; other++) if (other !== index) assert.ok(!result.data.messages.some(message => message.content === markers[other]));
    }
    assert.ok((await request('/group-chat', accounts[6])).data.messages.some(message => message.content === markers[2]));
    assert.equal((await request('/users/group', accounts[2], { groupCode: '1ro TIC' })).status, 409);
    assert.equal((await request('/group-chat/messages', accounts[2], { content: ' ' })).status, 400);
    assert.equal((await request('/group-chat/messages', accounts[2], { content: 'x'.repeat(5001) })).status, 400);
    const legacy = accounts[6];
    await db.execute('UPDATE users SET groupCode = NULL WHERE idUser = ?', [legacy.user.idUser]);
    assert.equal((await request('/group-chat', legacy)).status, 409);
    assert.equal((await request('/group-chat/messages', legacy, { content: 'sin grupo' })).status, 409);
    assert.equal((await request('/users/group', legacy, { groupCode: 'admin' })).status, 400);
    const joined = await request('/users/group', legacy, { groupCode: '2do ADM' });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.user.groupCode, '2do ADM');
    assert.equal((await request('/users/group', legacy, { groupCode: '2do ADM' })).status, 200);
    assert.equal((await request('/users/group', legacy, { groupCode: '3ro TIC' })).status, 409);
    const restored = await createGroupChatService(db, createAuthService(db)).history(legacy.token);
    assert.equal(restored.group.code, '2do ADM');
    assert.ok(restored.messages.some(message => message.content === markers[4]));
    assert.ok(!restored.messages.some(message => message.content === markers[2]));
    await auth.logout(legacy.token);
    assert.equal((await request('/group-chat', legacy)).status, 401);
    console.log('Chat grupal verificado: seis grupos aislados, recepción compartida, registro, elección única para cuentas anteriores, validación y sesión. No se enviaron correos reales.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      const id = account.user.idUser;
      await db.execute('DELETE FROM group_chat_messages WHERE senderId = ?', [id]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM simulated_purchases WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [id, account.name]);
    }
    await db.end();
    console.log('Cuentas y mensajes temporales del chat eliminados.');
  }
}
verify().catch(err => { console.error('Falló la verificación del chat:', err.code || err.message); process.exitCode = 1; });
