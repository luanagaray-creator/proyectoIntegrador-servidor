const { randomBytes } = require('node:crypto');
const { selectActiveSpace, activeCoverage } = require('./spaceAccess');
const fail = (status, message) => Object.assign(new Error(message), { status });
// Ambos participantes deben conservar acceso activo a la institución de la conversación.
function participantAccess(id) {
  return `EXISTS (SELECT 1 FROM communication_spaces s WHERE s.institutionId = t.institutionId AND ${activeCoverage} AND (EXISTS (SELECT 1 FROM space_memberships member WHERE member.spaceId = s.id AND member.idUser = ${id}) OR EXISTS (SELECT 1 FROM space_administrators manager WHERE manager.spaceId = s.id AND manager.idUser = ${id})))`;
}
const participantsAllowed = `${participantAccess('t.senderId')} AND ${participantAccess('t.recipientId')}`;
function threadAccess(user) {
  if (user.typeUser === 'superadmin') return {
    sql: `((t.senderId = ? AND EXISTS (SELECT 1 FROM institution_administrators ia JOIN users admin ON admin.idUser = ia.idUser AND admin.typeUser = 'admin' AND admin.isActive = 1 WHERE ia.institutionId = t.institutionId AND ia.idUser = t.recipientId)) OR (t.recipientId = ? AND EXISTS (SELECT 1 FROM institution_administrators ia JOIN users admin ON admin.idUser = ia.idUser AND admin.typeUser = 'admin' AND admin.isActive = 1 WHERE ia.institutionId = t.institutionId AND ia.idUser = t.senderId)))`,
    values: [user.idUser, user.idUser],
  };
  return {
    sql: `((t.senderId = ? OR t.recipientId = ?) AND (${participantsAllowed} OR (EXISTS (SELECT 1 FROM institution_administrators ia WHERE ia.institutionId = t.institutionId AND ia.idUser = ?) AND EXISTS (SELECT 1 FROM users superadmin WHERE superadmin.typeUser = 'superadmin' AND (t.senderId = superadmin.idUser OR t.recipientId = superadmin.idUser)))))`,
    values: [user.idUser, user.idUser, user.idUser],
  };
}
function threadQuery(user, lock = false) {
  const access = threadAccess(user);
  return { sql: `SELECT t.*, sender.name AS senderName, sender.typeUser AS senderType, recipient.name AS recipientName, recipient.typeUser AS recipientType FROM message_threads t JOIN users sender ON sender.idUser = t.senderId JOIN users recipient ON recipient.idUser = t.recipientId WHERE t.id = ? AND ${access.sql}${lock ? ' FOR UPDATE' : ''}`, values: access.values };
}
function belongsToThread(user, thread) {
  if (user.typeUser === 'superadmin') return Boolean(thread?.institutionId);
  if (thread?.senderType === 'superadmin' || thread?.recipientType === 'superadmin') return true;
  return thread && user.spaces.some(space => space.institutionId === thread.institutionId && space.isActive);
}

function createMessageService(db, authService) {
  async function account(token) {
    const user = await authService.profile(token);
    if (!user.hasAccess && !['superadmin', 'admin'].includes(user.typeUser)) throw fail(403, 'Necesitás acceso a un espacio habilitado por tu institución.');
    return user;
  }
  function contentOf(body) {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 5000) throw fail(400, 'El mensaje debe tener entre 1 y 5000 caracteres.');
    return content;
  }
  function validId(id) { if (typeof id !== 'string' || !/^[a-f0-9]{10}$/.test(id)) throw fail(404, 'No se encontró la conversación.'); }
  async function insert(connection, threadId, senderId, recipientId, addressee, content) {
    await connection.execute("INSERT INTO mesages (idMesage, threadId, senderId, recipientId, addressee, content, priorityMesage, dateMesage, sentAt) VALUES (?, ?, ?, ?, ?, ?, 'media', DATE_FORMAT(UTC_TIMESTAMP(), '%Y%m%d'), UTC_TIMESTAMP(3))", [randomBytes(5).toString('hex'), threadId, senderId, recipientId, addressee, content]);
  }
  async function list(token, filter = 'all') {
    const user = await account(token);
    if (!['all', 'sent', 'received', 'starred'].includes(filter)) throw fail(400, 'El filtro de mensajes no es válido.');
    const access = threadAccess(user);
    const values = [];
    let messageKind = '';
    if (filter === 'sent' || filter === 'received') {
      messageKind = ` AND last.${filter === 'sent' ? 'senderId' : 'recipientId'} = ?`;
      values.push(user.idUser);
    }
    values.push(user.idUser, ...access.values);
    const starredFilter = filter === 'starred' ? ' AND favorite.idUser IS NOT NULL' : '';
    const [threads] = await db.execute(`SELECT t.id, t.spaceId, t.institutionId, institution.name AS institutionName, t.subject, t.senderId, t.recipientId, sender.name AS senderName, recipient.name AS recipientName, m.content, m.senderId AS latestSenderId, m.sentAt, favorite.idUser IS NOT NULL AS isStarred FROM message_threads t JOIN users sender ON sender.idUser = t.senderId JOIN users recipient ON recipient.idUser = t.recipientId JOIN institutions institution ON institution.id = t.institutionId JOIN mesages m ON m.sequence = (SELECT MAX(last.sequence) FROM mesages last WHERE last.threadId = t.id${messageKind}) LEFT JOIN message_stars favorite ON favorite.threadId = t.id AND favorite.idUser = ? WHERE ${access.sql}${starredFilter} ORDER BY m.sequence DESC`, values);
    return { threads: threads.map(thread => ({ ...thread, isStarred: Boolean(thread.isStarred) })) };
  }

  async function setStar(token, id, body) {
    const user = await account(token);
    validId(id);
    if (typeof body.starred !== 'boolean') throw fail(400, 'Indicá si querés destacar la conversación.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const query = threadQuery(user, true);
      const [threads] = await connection.execute(query.sql, [id, ...query.values]);
      if (!belongsToThread(user, threads[0])) throw fail(404, 'No se encontró la conversación.');
      if (body.starred) await connection.execute('INSERT IGNORE INTO message_stars (idUser, threadId) VALUES (?, ?)', [user.idUser, id]);
      else await connection.execute('DELETE FROM message_stars WHERE idUser = ? AND threadId = ?', [user.idUser, id]);
      await connection.commit();
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
    return { threadId: id, isStarred: body.starred };
  }
  async function conversation(token, id) {
    const user = await account(token);
    validId(id);
    const query = threadQuery(user);
    const [threads] = await db.execute(query.sql, [id, ...query.values]);
    if (!belongsToThread(user, threads[0])) throw fail(404, 'No se encontró la conversación.');
    const [messages] = await db.execute('SELECT m.idMesage, m.senderId, m.recipientId, m.content, m.sentAt, u.name AS senderName FROM mesages m JOIN users u ON u.idUser = m.senderId WHERE m.threadId = ? ORDER BY m.sequence ASC', [id]);
    return { thread: threads[0], messages };
  }
  async function deleteMessage(token, threadId, messageId) {
    const user = await account(token);
    validId(threadId);
    validId(messageId);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const query = threadQuery(user, true);
      const [threads] = await connection.execute(query.sql, [threadId, ...query.values]);
      if (!belongsToThread(user, threads[0])) throw fail(404, 'No se encontró el mensaje o no tenés permiso para eliminarlo.');
      const [messages] = await connection.execute('SELECT idMesage FROM mesages WHERE idMesage = ? AND threadId = ? AND senderId = ? FOR UPDATE', [messageId, threadId, user.idUser]);
      if (!messages[0]) throw fail(404, 'No se encontró el mensaje o no tenés permiso para eliminarlo.');
      await connection.execute('DELETE FROM mesages WHERE idMesage = ? AND threadId = ? AND senderId = ?', [messageId, threadId, user.idUser]);
      await connection.commit();
      return { messageId, message: 'Mensaje eliminado.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function deleteConversation(token, id) {
    const user = await account(token);
    validId(id);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const query = threadQuery(user, true);
      const [threads] = await connection.execute(query.sql, [id, ...query.values]);
      if (!belongsToThread(user, threads[0])) throw fail(404, 'No se encontró la conversación.');
      await connection.execute('DELETE FROM message_stars WHERE threadId = ?', [id]);
      await connection.execute('DELETE FROM mesages WHERE threadId = ?', [id]);
      await connection.execute('DELETE FROM message_threads WHERE id = ?', [id]);
      await connection.commit();
      return { threadId: id, message: 'Conversación eliminada.' };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function send(token, body) {
    const user = await account(token);
    const content = contentOf(body);
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (!recipient || recipient.length > (user.typeUser === 'superadmin' ? 254 : 30)) throw fail(400, 'Indicá el nombre de usuario o email del destinatario.');
    if (!subject || subject.length > 120) throw fail(400, 'El asunto debe tener entre 1 y 120 caracteres.');
    if (user.typeUser === 'superadmin') {
      const institutionId = typeof body.institutionId === 'string' ? body.institutionId : '';
      if (!/^[a-f0-9]{10}$/.test(institutionId)) throw fail(400, 'Elegí la institución del administrador.');
      const [users] = await db.execute("SELECT admin.idUser, admin.name FROM users admin JOIN institution_administrators manager ON manager.idUser = admin.idUser WHERE manager.institutionId = ? AND admin.typeUser = 'admin' AND admin.isActive = 1 AND (admin.name = ? OR admin.email = ?)", [institutionId, recipient, recipient]);
      if (users.length !== 1) throw fail(400, 'No se encontró un administrador activo de esa institución con ese usuario o email.');
      if (users[0].idUser === user.idUser) throw fail(400, 'Elegí otra cuenta como destinataria.');
      const id = randomBytes(5).toString('hex');
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [institutions] = await connection.execute('SELECT id FROM institutions WHERE id = ? FOR UPDATE', [institutionId]);
        if (!institutions[0]) throw fail(404, 'La institución ya no está disponible.');
        const [administrators] = await connection.execute("SELECT admin.idUser, admin.name FROM users admin JOIN institution_administrators manager ON manager.idUser = admin.idUser WHERE manager.institutionId = ? AND admin.idUser = ? AND admin.typeUser = 'admin' AND admin.isActive = 1 FOR UPDATE", [institutionId, users[0].idUser]);
        if (!administrators[0]) throw fail(404, 'El administrador ya no está disponible en esa institución.');
        await connection.execute('INSERT INTO message_threads (id, spaceId, institutionId, subject, senderId, recipientId, createdAt) VALUES (?, NULL, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [id, institutionId, subject, user.idUser, administrators[0].idUser]);
        await insert(connection, id, user.idUser, administrators[0].idUser, administrators[0].name, content);
        await connection.commit();
        return { threadId: id };
      } catch (err) { await connection.rollback(); throw err; }
      finally { connection.release(); }
    }
    const space = selectActiveSpace(user, body.spaceId);
    const [users] = await db.execute('SELECT idUser, name FROM users WHERE name = ? OR email = ?', [recipient, recipient]);
    if (users.length !== 1) throw fail(400, 'No se encontró un usuario con ese nombre o email.');
    if (users[0].idUser === user.idUser) throw fail(400, 'Elegí otro usuario como destinatario.');
    const [participants] = await db.execute(`SELECT s.id FROM communication_spaces s WHERE s.institutionId = ? AND ${activeCoverage} AND (EXISTS (SELECT 1 FROM space_memberships member WHERE member.spaceId = s.id AND member.idUser = ?) OR EXISTS (SELECT 1 FROM space_administrators manager WHERE manager.spaceId = s.id AND manager.idUser = ?)) LIMIT 1`, [space.institutionId, users[0].idUser, users[0].idUser]);
    if (!participants[0]) throw fail(400, 'Solo podés enviar mensajes a usuarios habilitados de tu misma institución.');
    const id = randomBytes(5).toString('hex');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [institutions] = await connection.execute('SELECT id FROM institutions WHERE id = ? FOR UPDATE', [space.institutionId]);
      if (!institutions[0]) throw fail(404, 'La institución ya no está disponible.');
      const [spaces] = await connection.execute('SELECT id FROM communication_spaces WHERE id = ? FOR UPDATE', [space.id]);
      if (!spaces[0]) throw fail(404, 'El espacio ya no está disponible.');
      await connection.execute('INSERT INTO message_threads (id, spaceId, institutionId, subject, senderId, recipientId, createdAt) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [id, space.id, space.institutionId, subject, user.idUser, users[0].idUser]);
      await insert(connection, id, user.idUser, users[0].idUser, users[0].name, content);
      await connection.commit();
      return { threadId: id };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  async function reply(token, id, body) {
    const user = await account(token);
    validId(id);
    const content = contentOf(body);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const query = threadQuery(user, true);
      const [threads] = await connection.execute(query.sql, [id, ...query.values]);
      if (!belongsToThread(user, threads[0])) throw fail(404, 'No se encontró la conversación.');
      const thread = threads[0];
      const toSender = thread.recipientId === user.idUser;
      await insert(connection, id, user.idUser, toSender ? thread.senderId : thread.recipientId, toSender ? thread.senderName : thread.recipientName, content);
      await connection.commit();
      return { threadId: id };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  return { list, conversation, send, reply, setStar, deleteMessage, deleteConversation };
}
module.exports = { createMessageService };
