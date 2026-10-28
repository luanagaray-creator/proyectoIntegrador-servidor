const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageService } = require('../services/messageService');

const id = '0123456789';
const institutionId = 'institution';
const participant = idUser => ({ idUser, hasAccess: true, spaces: [{ institutionId, isActive: true }] });

function fixture(user, failOnMessages = false) {
  const state = {
    threads: [{ id, institutionId, senderId: 'sender', recipientId: 'recipient' }],
    messages: [{ threadId: id, senderId: 'sender' }, { threadId: id, senderId: 'recipient' }, { threadId: 'other' }],
    stars: [{ threadId: id, idUser: 'sender' }, { threadId: id, idUser: 'recipient' }, { threadId: 'other' }],
  };
  let snapshot;
  let released = false;
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() {},
    async rollback() { Object.assign(state, snapshot); },
    release() { released = true; },
    async execute(sql, values) {
      if (sql.startsWith('SELECT t.*')) {
        assert.match(sql, /FOR UPDATE$/);
        assert.match(sql, /t.senderId = \? OR t.recipientId = \?/);
        return [state.threads.filter(thread => thread.id === values[0] && (thread.senderId === values[1] || thread.recipientId === values[2]))];
      }
      if (sql === 'DELETE FROM message_stars WHERE threadId = ?') state.stars = state.stars.filter(row => row.threadId !== values[0]);
      else if (sql === 'DELETE FROM mesages WHERE threadId = ?') {
        if (failOnMessages) throw new Error('Database unavailable');
        state.messages = state.messages.filter(row => row.threadId !== values[0]);
      } else if (sql === 'DELETE FROM message_threads WHERE id = ?') state.threads = state.threads.filter(row => row.id !== values[0]);
      else throw new Error(`Consulta inesperada: ${sql}`);
      return [{ affectedRows: 1 }];
    },
  };
  const service = createMessageService({ getConnection: async () => connection }, { profile: async () => user });
  return { service, state, released: () => released };
}

for (const idUser of ['sender', 'recipient']) {
  test(`${idUser} puede eliminar la conversación, sus mensajes y destacados`, async () => {
    const { service, state, released } = fixture(participant(idUser));
    assert.equal((await service.deleteConversation('session', id)).threadId, id);
    assert.deepEqual(state, { threads: [], messages: [{ threadId: 'other' }], stars: [{ threadId: 'other' }] });
    assert.equal(released(), true);
  });
}

test('rechaza terceros, instituciones sin acceso e identificadores inexistentes', async () => {
  for (const [user, threadId] of [[participant('outsider'), id], [{ ...participant('sender'), spaces: [] }, id], [participant('sender'), 'aaaaaaaaaa'], [participant('sender'), 'invalid']]) {
    const { service, state } = fixture(user);
    const before = structuredClone(state);
    await assert.rejects(service.deleteConversation('session', threadId), error => error.status === 404);
    assert.deepEqual(state, before);
  }
});

test('revierte toda la eliminación si falla la base de datos y libera la conexión', async () => {
  const { service, state, released } = fixture(participant('sender'), true);
  const before = structuredClone(state);
  await assert.rejects(service.deleteConversation('session', id), /Database unavailable/);
  assert.deepEqual(state, before);
  assert.equal(released(), true);
});
