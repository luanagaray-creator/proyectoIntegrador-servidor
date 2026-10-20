const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageService } = require('../services/messageService');
const { createGroupChatService } = require('../services/groupChatService');

const owner = { idUser: 'owner00001', hasAccess: true, spaces: [{ id: 'space00001', institutionId: 'institution', name: 'Grupo', isActive: true }] };
const thread = { id: '0123456789', institutionId: 'institution', senderId: owner.idUser, recipientId: 'recipient01' };

function inboxDatabase(messages) {
  const queries = {
    async execute(sql, values) {
      if (sql.startsWith('SELECT t.*')) {
        const visible = thread.id === values[0] && [thread.senderId, thread.recipientId].includes(values[1]) && values[1] === values[2];
        return [visible ? [thread] : []];
      }
      if (sql.startsWith('SELECT idMesage FROM mesages')) {
        return [messages.filter(message => message.idMesage === values[0] && message.threadId === values[1] && message.senderId === values[2])];
      }
      if (sql.startsWith('DELETE FROM mesages')) {
        const index = messages.findIndex(message => message.idMesage === values[0] && message.threadId === values[1] && message.senderId === values[2]);
        if (index >= 0) messages.splice(index, 1);
        return [{ affectedRows: index >= 0 ? 1 : 0 }];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };
  return { getConnection: async () => queries };
}

function groupDatabase(messages) {
  return {
    messages,
    async execute(sql, values) {
      if (sql.startsWith('SELECT id FROM group_chat_messages')) {
        return [messages.filter(message => String(message.id) === values[0] && message.spaceId === values[1] && message.senderId === values[2])];
      }
      if (sql.startsWith('DELETE FROM group_chat_messages')) {
        const index = messages.findIndex(message => String(message.id) === values[0] && message.spaceId === values[1] && message.senderId === values[2]);
        if (index >= 0) messages.splice(index, 1);
        return [{ affectedRows: index >= 0 ? 1 : 0 }];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
}

test('elimina un mensaje privado propio de la conversación autorizada', async () => {
  const messages = [{ idMesage: 'abcdef0123', threadId: thread.id, senderId: owner.idUser }];
  const service = createMessageService(inboxDatabase(messages), { profile: async () => owner });

  const result = await service.deleteMessage('session', thread.id, messages[0].idMesage);

  assert.equal(result.messageId, 'abcdef0123');
  assert.equal(messages.length, 0);
});

test('no permite eliminar un mensaje privado de otro participante', async () => {
  const messages = [{ idMesage: 'abcdef0123', threadId: thread.id, senderId: thread.recipientId }];
  const service = createMessageService(inboxDatabase(messages), { profile: async () => owner });

  await assert.rejects(service.deleteMessage('session', thread.id, messages[0].idMesage), error => error.status === 404);
  assert.equal(messages.length, 1);
});

test('elimina un mensaje propio del chat del espacio activo', async () => {
  const messages = [{ id: 17, spaceId: 'space00001', senderId: owner.idUser }];
  const service = createGroupChatService(groupDatabase(messages), { profile: async () => owner });

  const result = await service.deleteMessage('session', 'space00001', '17');

  assert.equal(result.messageId, '17');
  assert.equal(messages.length, 0);
});

test('no permite eliminar mensajes de otro miembro del chat', async () => {
  const messages = [{ id: 17, spaceId: 'space00001', senderId: 'recipient01' }];
  const service = createGroupChatService(groupDatabase(messages), { profile: async () => owner });

  await assert.rejects(service.deleteMessage('session', 'space00001', '17'), error => error.status === 404);
  assert.equal(messages.length, 1);
});
