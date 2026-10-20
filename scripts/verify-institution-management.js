const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createAuthService } = require('../services/authService');
const { createInstitutionService } = require('../services/institutionService');
const { createGroupChatService } = require('../services/groupChatService');
const { createMessageService } = require('../services/messageService');
const { createApp } = require('../index');

async function verify() {
  const db = createDatabase();
  const accounts = [];
  const institutionIds = [];
  let server;
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(info.name.toLowerCase(), 'proyectointegrador');
    const auth = createAuthService(db);
    const institutions = createInstitutionService(db, auth);
    const chat = createGroupChatService(db, auth);
    const messages = createMessageService(db, auth);
    for (let index = 0; index < 5; index++) {
      const suffix = randomBytes(5).toString('hex');
      const name = `manage_${suffix}`;
      accounts.push({ ...await auth.register({ name, email: `${suffix}@prueba.local`, password: randomBytes(16).toString('hex') }), name });
    }
    const [root, adminA, adminB, studentA, studentB] = accounts;
    await db.execute("UPDATE users SET typeUser = 'superadmin' WHERE idUser = ?", [root.user.idUser]);
    for (const label of ['A', 'B']) {
      const result = await institutions.createInstitution(root.token, { name: `Gestión ${label} ${randomBytes(5).toString('hex')}`, groupCodes: ['1ro TIC', '2do TIC'] });
      institutionIds.push(result.id);
    }
    const [spacesA] = await db.execute('SELECT id FROM communication_spaces WHERE institutionId = ? ORDER BY id', [institutionIds[0]]);
    const [spacesB] = await db.execute('SELECT id FROM communication_spaces WHERE institutionId = ? ORDER BY id', [institutionIds[1]]);
    await institutions.grantAdministrator(root.token, { user: adminA.name, spaceIds: spacesA.map(space => space.id) });
    await institutions.grantAdministrator(root.token, { user: adminB.name, spaceIds: spacesB.map(space => space.id) });
    for (const [admin, spaces, student] of [[adminA, spacesA, studentA], [adminB, spacesB, studentB]]) {
      await auth.simulatePurchase(admin.token, { plan: 'Small Plan', method: 'Visa', spaceIds: spaces.map(space => space.id) });
      await institutions.grantMember(admin.token, spaces[0].id, { user: student.name });
    }
    server = createApp(auth, { institutionService: institutions, groupChatService: chat, messageService: messages, sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, account, body, method = 'DELETE') {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: `anima_session=${account.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    const spacePath = `/admin/spaces/${spacesA[0].id}`;
    assert.equal((await request(spacePath)).status, 401);
    assert.equal((await request(spacePath, studentA)).status, 403);
    assert.equal((await request(spacePath, adminB)).status, 403);
    assert.equal((await request(spacePath, adminB, { name: 'Ajeno' }, 'PATCH')).status, 403);
    assert.equal((await request(spacePath, adminA, { name: 'Comunicación institucional' }, 'PATCH')).status, 200);
    await chat.send(studentA.token, { spaceId: spacesA[0].id, content: 'Mensaje en espacio renombrado' });
    assert.equal((await chat.history(studentA.token, spacesA[0].id)).messages.length, 1);
    const threadA = await messages.send(studentA.token, { spaceId: spacesA[0].id, recipient: adminA.name, subject: 'Conversación A', content: 'Conservar al eliminar el espacio' });
    await messages.setStar(studentA.token, threadA.threadId, { starred: true });
    await chat.send(studentB.token, { spaceId: spacesB[0].id, content: 'Chat B' });
    const threadB = await messages.send(studentB.token, { spaceId: spacesB[0].id, recipient: adminB.name, subject: 'Conversación B', content: 'Borrar con la institución B' });
    await messages.setStar(studentB.token, threadB.threadId, { starred: true });
    assert.equal((await request(spacePath, adminA)).status, 200);
    assert.equal((await auth.profile(studentA.token)).hasAccess, false);
    assert.equal((await auth.profile(adminA.token)).managedSpaces.length, 1);
    const [[removedChat]] = await db.execute('SELECT COUNT(*) AS count FROM group_chat_messages WHERE spaceId = ?', [spacesA[0].id]);
    assert.equal(removedChat.count, 0);
    const [[preservedThread]] = await db.execute('SELECT spaceId, institutionId FROM message_threads WHERE id = ?', [threadA.threadId]);
    assert.equal(preservedThread.spaceId, null);
    assert.equal(preservedThread.institutionId, institutionIds[0]);
    await institutions.grantMember(adminA.token, spacesA[1].id, { user: studentA.name });
    assert.equal((await messages.conversation(studentA.token, threadA.threadId)).messages.length, 1);
    assert.equal((await auth.profile(studentB.token)).hasAccess, true);

    const failingDb = {
      async getConnection() {
        const connection = await db.getConnection();
        return {
          beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(), rollback: () => connection.rollback(), release: () => connection.release(),
          execute(sql, values) {
            if (sql === 'DELETE FROM institutions WHERE id = ?') throw new Error('Fallo simulado al finalizar');
            return connection.execute(sql, values);
          },
        };
      },
    };
    await assert.rejects(createInstitutionService(failingDb, auth).deleteInstitution(root.token, institutionIds[1]), /Fallo simulado/);
    assert.equal((await chat.history(studentB.token, spacesB[0].id)).messages.length, 1);
    assert.equal((await messages.conversation(studentB.token, threadB.threadId)).messages.length, 1);
    assert.equal((await messages.list(studentB.token, 'starred')).threads.length, 1);
    assert.equal((await request(`/platform/institutions/${institutionIds[1]}`, adminB)).status, 403);
    assert.equal((await request(`/platform/institutions/${institutionIds[1]}`, root)).status, 200);
    assert.equal((await request(`/platform/institutions/${institutionIds[1]}`, root)).status, 404);
    for (const [table, column] of [['message_threads', 'id'], ['mesages', 'threadId'], ['message_stars', 'threadId']]) {
      const [[row]] = await db.execute(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`, [threadB.threadId]);
      assert.equal(row.count, 0);
    }
    assert.equal((await auth.profile(adminB.token)).purchase, null);
    assert.equal((await auth.profile(adminB.token)).typeUser, 'admin');
    assert.equal((await auth.profile(studentB.token)).hasAccess, false);
    assert.equal((await auth.profile(studentA.token)).hasAccess, true);
    assert.equal((await request(`/admin/spaces/${spacesA[1].id}`, root, { name: 'Último espacio' }, 'PATCH')).status, 200);
    assert.equal((await request(`/admin/spaces/${spacesA[1].id}`, root)).status, 200);
    assert.equal((await auth.profile(adminA.token)).purchase, null);
    assert.equal((await request(`/platform/institutions/${institutionIds[0]}`, root)).status, 200);
    console.log('Verificado: nombres personalizados, borrado autorizado, limpieza de datos, aislamiento, conservación de cuentas y rollback completo.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      const id = account.user.idUser;
      await db.execute('DELETE FROM message_stars WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM mesages WHERE senderId = ? OR recipientId = ?', [id, id]);
      await db.execute('DELETE FROM message_threads WHERE senderId = ? OR recipientId = ?', [id, id]);
      await db.execute('DELETE FROM group_chat_messages WHERE senderId = ?', [id]);
      await db.execute('DELETE FROM space_memberships WHERE idUser = ? OR grantedBy = ?', [id, id]);
      await db.execute('DELETE FROM admin_plan_spaces WHERE adminId = ?', [id]);
      await db.execute('DELETE FROM space_administrators WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM simulated_purchases WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [id]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [id, account.name]);
      await db.execute('DELETE FROM institution_administrators WHERE idUser = ?', [id]);
    }
    for (const id of institutionIds) {
      await db.execute('DELETE FROM communication_spaces WHERE institutionId = ?', [id]);
      await db.execute('DELETE FROM institutions WHERE id = ?', [id]);
    }
    await db.end();
  }
}
verify().catch(err => { console.error('Falló la verificación de gestión:', err.code || err.message); process.exitCode = 1; });
