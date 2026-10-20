const { selectActiveSpace } = require('./spaceAccess');
const fail = (status, message) => Object.assign(new Error(message), { status });
function createGroupChatService(db, authService) {
  async function member(token, requestedSpace) {
    const user = await authService.profile(token);
    const space = selectActiveSpace(user, requestedSpace);
    return { user, space };
  }
  async function join(token) { await authService.profile(token); throw fail(403, 'El administrador de tu institución debe habilitarte en el espacio.'); }
  async function history(token, requestedSpace) {
    const { space } = await member(token, requestedSpace);
    const [messages] = await db.execute('SELECT m.id, m.senderId, m.content, m.sentAt, u.name AS senderName FROM group_chat_messages m JOIN users u ON u.idUser = m.senderId WHERE m.spaceId = ? ORDER BY m.id ASC', [space.id]);
    return { space, group: { code: space.name }, messages };
  }
  async function send(token, body) {
    const { user, space } = await member(token, body.spaceId);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 5000) throw fail(400, 'El mensaje debe tener entre 1 y 5000 caracteres.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [spaces] = await connection.execute('SELECT id FROM communication_spaces WHERE id = ? FOR UPDATE', [space.id]);
      if (!spaces[0]) throw fail(404, 'El espacio ya no está disponible.');
      await connection.execute('INSERT INTO group_chat_messages (groupCode, spaceId, senderId, content, sentAt) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))', [space.name, space.id, user.idUser, content]);
      await connection.commit();
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
    return { message: 'Mensaje enviado.' };
  }
  async function deleteMessage(token, requestedSpace, id) {
    const { user, space } = await member(token, requestedSpace);
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) throw fail(404, 'No se encontró el mensaje o no tenés permiso para eliminarlo.');
    const [messages] = await db.execute('SELECT id FROM group_chat_messages WHERE id = ? AND spaceId = ? AND senderId = ?', [id, space.id, user.idUser]);
    if (!messages[0]) throw fail(404, 'No se encontró el mensaje o no tenés permiso para eliminarlo.');
    await db.execute('DELETE FROM group_chat_messages WHERE id = ? AND spaceId = ? AND senderId = ?', [id, space.id, user.idUser]);
    return { messageId: id, message: 'Mensaje eliminado.' };
  }
  return { join, history, send, deleteMessage };
}
module.exports = { createGroupChatService };
