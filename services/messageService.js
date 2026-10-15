const { randomBytes } = require('node:crypto');
const { selectActiveSpace } = require('./spaceAccess');
const fail = (status, message) => Object.assign(new Error(message), { status });
const threadQuery = 'SELECT t.*, sender.name AS senderName, recipient.name AS recipientName FROM message_threads t JOIN users sender ON sender.idUser = t.senderId JOIN users recipient ON recipient.idUser = t.recipientId WHERE t.id = ? AND (t.senderId = ? OR t.recipientId = ?)';

function createMessageService(db, authService) {
  async function account(token) {
    const user = await authService.profile(token);
    if (!user.hasAccess) throw fail(403, 'Necesitás acceso a un espacio habilitado por tu institución.');
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
    const activeIds = user.spaces.filter(space => space.isActive).map(space => space.id);
    const values = [user.idUser, user.idUser, user.idUser];
    let condition = '';
    let messageKind = '';
    if (filter === 'starred') condition = ' AND favorite.idUser IS NOT NULL';
    if (filter === 'sent' || filter === 'received') {
      messageKind = ` AND last.${filter === 'sent' ? 'senderId' : 'recipientId'} = ?`;
      values.unshift(user.idUser);
    }
    values.push(...activeIds);
    const [threads] = await db.execute(`SELECT t.id, t.spaceId, t.subject, t.senderId, t.recipientId, sender.name AS senderName, recipient.name AS recipientName, m.content, m.senderId AS latestSenderId, m.sentAt, favorite.idUser IS NOT NULL AS isStarred FROM message_threads t JOIN users sender ON sender.idUser = t.senderId JOIN users recipient ON recipient.idUser = t.recipientId JOIN mesages m ON m.sequence = (SELECT MAX(last.sequence) FROM mesages last WHERE last.threadId = t.id${messageKind}) LEFT JOIN message_stars favorite ON favorite.threadId = t.id AND favorite.idUser = ? WHERE (t.senderId = ? OR t.recipientId = ?)${condition} AND t.spaceId IN (${activeIds.map(() => '?').join(',')}) ORDER BY m.sequence DESC`, values);
    return { threads: threads.map(thread => ({ ...thread, isStarred: Boolean(thread.isStarred) })) };
  }

  async function setStar(token, id, body) {
    const user = await account(token);
    validId(id);
    if (typeof body.starred !== 'boolean') throw fail(400, 'Indicá si querés destacar la conversación.');
    const [threads] = await db.execute(threadQuery, [id, user.idUser, user.idUser]);
    if (!threads[0] || !user.spaces.some(space => space.id === threads[0].spaceId && space.isActive)) throw fail(404, 'No se encontró la conversación.');
    if (body.starred) await db.execute('INSERT IGNORE INTO message_stars (idUser, threadId) VALUES (?, ?)', [user.idUser, id]);
    else await db.execute('DELETE FROM message_stars WHERE idUser = ? AND threadId = ?', [user.idUser, id]);
    return { threadId: id, isStarred: body.starred };
  }
  async function conversation(token, id) {
    const user = await account(token);
    validId(id);
    const [threads] = await db.execute(threadQuery, [id, user.idUser, user.idUser]);
    if (!threads[0] || !user.spaces.some(space => space.id === threads[0].spaceId && space.isActive)) throw fail(404, 'No se encontró la conversación.');
    const [messages] = await db.execute('SELECT m.idMesage, m.senderId, m.recipientId, m.content, m.sentAt, u.name AS senderName FROM mesages m JOIN users u ON u.idUser = m.senderId WHERE m.threadId = ? ORDER BY m.sequence ASC', [id]);
    return { thread: threads[0], messages };
  }
  async function send(token, body) {
    const user = await account(token);
    const space = selectActiveSpace(user, body.spaceId);
    const content = contentOf(body);
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (!recipient || recipient.length > 30) throw fail(400, 'Indicá el nombre de usuario o email del destinatario.');
    if (!subject || subject.length > 120) throw fail(400, 'El asunto debe tener entre 1 y 120 caracteres.');
    const [users] = await db.execute('SELECT idUser, name FROM users WHERE name = ? OR email = ?', [recipient, recipient]);
    if (users.length !== 1) throw fail(400, 'No se encontró un usuario con ese nombre o email.');
    if (users[0].idUser === user.idUser) throw fail(400, 'Elegí otro usuario como destinatario.');
    const [participants] = await db.execute('SELECT idUser FROM space_memberships WHERE spaceId = ? AND idUser = ? UNION SELECT idUser FROM space_administrators WHERE spaceId = ? AND idUser = ?', [space.id, users[0].idUser, space.id, users[0].idUser]);
    if (!participants[0]) throw fail(400, 'El destinatario no está habilitado en este espacio.');
    const id = randomBytes(5).toString('hex');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('INSERT INTO message_threads (id, spaceId, subject, senderId, recipientId, createdAt) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [id, space.id, subject, user.idUser, users[0].idUser]);
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
      const [threads] = await connection.execute(`${threadQuery} FOR UPDATE`, [id, user.idUser, user.idUser]);
      if (!threads[0] || !user.spaces.some(space => space.id === threads[0].spaceId && space.isActive)) throw fail(404, 'No se encontró la conversación.');
      const thread = threads[0];
      const toSender = thread.recipientId === user.idUser;
      await insert(connection, id, user.idUser, toSender ? thread.senderId : thread.recipientId, toSender ? thread.senderName : thread.recipientName, content);
      await connection.commit();
      return { threadId: id };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }
  return { list, conversation, send, reply, setStar };
}
module.exports = { createMessageService };
