const groups = require('../config/groups.json');
const fail = (status, message) => Object.assign(new Error(message), { status });

function createGroupChatService(db, authService) {
  async function member(token) {
    const user = await authService.profile(token);
    if (!user.purchase) throw fail(403, 'Completá el pago simulado para acceder al chat.');
    if (!groups.includes(user.groupCode)) throw fail(409, 'Elegí tu grupo para entrar al chat.');
    return user;
  }
  async function join(token, body) {
    const user = await authService.profile(token);
    if (!groups.includes(body.groupCode)) throw fail(400, 'Seleccioná un grupo válido.');
    // La elección es única: no permite cambiar de grupo y leer conversaciones ajenas.
    await db.execute('UPDATE users SET groupCode = ? WHERE idUser = ? AND groupCode IS NULL', [body.groupCode, user.idUser]);
    const updated = await authService.profile(token);
    if (updated.groupCode !== body.groupCode) throw fail(409, 'Ya pertenecés a otro grupo.');
    return { user: updated };
  }
  async function history(token) {
    const user = await member(token);
    const [messages] = await db.execute('SELECT m.id, m.senderId, m.content, m.sentAt, u.name AS senderName FROM group_chat_messages m JOIN users u ON u.idUser = m.senderId WHERE m.groupCode = ? ORDER BY m.id ASC', [user.groupCode]);
    return { group: { code: user.groupCode }, messages };
  }
  async function send(token, body) {
    const user = await member(token);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 5000) throw fail(400, 'El mensaje debe tener entre 1 y 5000 caracteres.');
    // El grupo y el remitente siempre salen de la sesión, nunca del cuerpo de la solicitud.
    await db.execute('INSERT INTO group_chat_messages (groupCode, senderId, content, sentAt) VALUES (?, ?, ?, UTC_TIMESTAMP(3))', [user.groupCode, user.idUser, content]);
    return { message: 'Mensaje enviado.' };
  }
  return { join, history, send };
}
module.exports = { createGroupChatService };
