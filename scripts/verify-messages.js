const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createAuthService } = require('../services/authService');
const { createMessageService } = require('../services/messageService');
const { createApp } = require('../index');

async function verify() {
  const db = createDatabase();
  const accounts = [];
  let server;
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(info.name.toLowerCase(), 'proyectointegrador');
    const auth = createAuthService(db);
    for (let index = 0; index < 4; index++) {
      const suffix = randomBytes(5).toString('hex');
      const name = `msg_${suffix}`;
      const email = `${suffix}@prueba.local`;
      const result = await auth.register({ name, email, password: randomBytes(16).toString('hex'), groupCode: '3ro TIC' });
      accounts.push({ ...result, name, email, cookie: `anima_session=${result.token}` });
      if (index < 3) await auth.simulatePurchase(result.token, { plan: 'Small Plan', method: 'Visa' });
    }
    const [sender, recipient, stranger, unpaid] = accounts;
    server = createApp(auth, { messageService: createMessageService(db, auth), sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, account, body) {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: account.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await request('/messages')).status, 401);
    assert.equal((await request('/messages', unpaid)).status, 403);
    assert.deepEqual((await request('/messages', sender)).data.threads, []);
    const body = { recipient: recipient.email, subject: 'Prueba de mensajería', content: 'Hola, ¿recibiste este mensaje?\nSegunda línea.' };
    assert.equal((await request('/messages', null, body)).status, 401);
    assert.equal((await request('/messages', unpaid, body)).status, 403);
    assert.equal((await request('/messages', sender, { ...body, recipient: sender.name })).status, 400);
    assert.equal((await request('/messages', sender, { ...body, recipient: 'usuario_inexistente_prueba' })).status, 400);
    assert.equal((await request('/messages', sender, { ...body, content: ' ' })).status, 400);
    assert.equal((await request('/messages', sender, { ...body, content: 'x'.repeat(5001) })).status, 400);
    assert.equal((await request('/messages', sender, { ...body, subject: 'x'.repeat(121) })).status, 400);
    const sent = await request('/messages', sender, { ...body, senderId: stranger.user.idUser });
    assert.equal(sent.status, 201);
    const id = sent.data.threadId;
    const sentList = (await request('/messages', sender)).data.threads;
    const inbox = (await request('/messages', recipient)).data.threads;
    assert.equal(sentList.length, 1);
    assert.equal(inbox[0].id, id);
    assert.equal(inbox[0].content, body.content);
    assert.equal(inbox[0].senderId, sender.user.idUser);
    assert.equal((await request('/messages', stranger)).data.threads.length, 0);
    assert.equal((await request('/messages?filter=sent', sender)).data.threads.length, 1);
    assert.equal((await request('/messages?filter=received', sender)).data.threads.length, 0);
    assert.equal((await request('/messages?filter=received', recipient)).data.threads.length, 1);
    assert.equal((await request('/messages?filter=sent', recipient)).data.threads.length, 0);
    assert.equal((await request('/messages?filter=starred', sender)).data.threads.length, 0);
    assert.equal((await request('/messages?filter=invalido', sender)).status, 400);
    assert.equal((await request(`/messages/${id}/star`, stranger, { starred: true })).status, 404);
    assert.equal((await request(`/messages/${id}/star`, sender, { starred: 'true' })).status, 400);
    assert.equal((await request(`/messages/${id}/star`, sender, { starred: true })).status, 200);
    assert.equal((await request(`/messages/${id}/star`, sender, { starred: true })).status, 200);
    const starred = (await request('/messages?filter=starred', sender)).data.threads;
    assert.equal(starred.length, 1);
    assert.equal(starred[0].isStarred, true);
    assert.equal((await request('/messages?filter=starred', recipient)).data.threads.length, 0);
    assert.equal((await request('/messages?filter=sent', stranger)).data.threads.length, 0);
    assert.equal((await createMessageService(db, createAuthService(db)).list(sender.token, 'starred')).threads[0].id, id);
    assert.equal((await request(`/messages/${id}`, stranger)).status, 404);
    assert.equal((await request(`/messages/${id}/replies`, stranger, { content: 'Acceso ajeno' })).status, 404);
    assert.equal((await request('/messages/no-valido', sender)).status, 404);
    assert.equal((await request(`/messages/${id}/replies`, recipient, { content: ' ' })).status, 400);
    assert.equal((await request(`/messages/${id}/replies`, recipient, { content: 'Sí, lo recibí.', recipientId: stranger.user.idUser })).status, 201);
    assert.equal((await request(`/messages/${id}/replies`, sender, { content: 'Gracias.' })).status, 201);
    const conversation = (await request(`/messages/${id}`, recipient)).data;
    assert.deepEqual(conversation.messages.map(message => message.content), [body.content, 'Sí, lo recibí.', 'Gracias.']);
    assert.equal(conversation.messages[1].senderId, recipient.user.idUser);
    assert.equal(conversation.messages[1].recipientId, sender.user.idUser);
    assert.equal((await request('/messages', recipient)).data.threads[0].content, 'Gracias.');
    assert.equal((await request('/messages?filter=received', sender)).data.threads[0].content, 'Sí, lo recibí.');
    assert.equal((await request('/messages?filter=sent', recipient)).data.threads[0].content, 'Sí, lo recibí.');
    assert.equal((await request('/messages?filter=received', recipient)).data.threads[0].content, 'Gracias.');
    assert.equal((await request(`/messages/${id}/star`, sender, { starred: false })).status, 200);
    assert.equal((await request('/messages?filter=starred', sender)).data.threads.length, 0);
    const restored = await createMessageService(db, createAuthService(db)).conversation(sender.token, id);
    assert.equal(restored.messages.length, 3);
    assert.equal((await request('/messages', sender, { ...body, recipient: recipient.name, subject: 'Segundo asunto' })).status, 201);
    assert.equal((await request('/messages', sender)).data.threads.length, 2);
    await auth.logout(sender.token);
    assert.equal((await request(`/messages/${id}/replies`, sender, { content: 'Sesión cerrada' })).status, 401);
    console.log('Mensajería verificada: envío por email y usuario, recepción, respuestas ordenadas y persistentes, validación, privacidad, sesión y acceso pagado. No se enviaron correos ni mensajes a usuarios reales.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      const id = account.user.idUser;
      await db.execute('DELETE FROM message_stars WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM mesages WHERE senderId = ? OR recipientId = ?', [id, id]);
      await db.execute('DELETE FROM message_threads WHERE senderId = ? OR recipientId = ?', [id, id]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM simulated_purchases WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [id, account.name]);
    }
    await db.end();
    console.log('Cuentas y mensajes temporales eliminados.');
  }
}
verify().catch(err => { console.error('Falló la verificación:', err.code || err.message); process.exitCode = 1; });
