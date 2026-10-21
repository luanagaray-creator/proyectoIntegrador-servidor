const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstitutionService } = require('../services/institutionService');

for (const [plan, limit] of [['Small Plan', 250], ['Medium Plan', 500], ['Large Plan', 750]]) {
  test(`${plan}: admite el último usuario, rechaza el excedente y conserva asignaciones existentes`, async () => {
    const occupants = Array.from({ length: limit - 1 }, (_, index) => ({ idUser: `user${index}` }));
    let commits = 0;
    let rollbacks = 0;
    const db = {
      async execute(sql, values) {
        if (sql.startsWith('SELECT idUser, name, email, typeUser FROM users')) return [[{ idUser: values[0], typeUser: 'user' }]];
        if (sql.startsWith('SELECT typeUser FROM users')) return [[{ typeUser: 'user' }]];
        if (sql.startsWith('SELECT i.id FROM institutions') || sql.startsWith('SELECT id FROM communication_spaces')) return [[{ id: 'space' }]];
        if (sql.startsWith('SELECT spaceId FROM space_administrators')) return [[{ spaceId: 'space' }]];
        if (sql.startsWith('SELECT spaceId FROM space_memberships')) return [occupants.some(row => row.idUser === values[0]) ? [{ spaceId: 'space' }] : []];
        if (sql.startsWith('SELECT idUser FROM space_memberships') || sql.startsWith('SELECT u.idUser, u.name, u.email FROM space_memberships')) return [[...occupants]];
        if (sql.startsWith('SELECT payment.plan')) return [[{ plan }]];
        if (sql.startsWith('INSERT IGNORE INTO space_memberships')) {
          if (!occupants.some(row => row.idUser === values[1])) occupants.push({ idUser: values[1] });
          return [{}];
        }
        throw new Error(`Consulta inesperada: ${sql}`);
      },
      async getConnection() { return this; },
      async beginTransaction() {},
      async commit() { commits++; },
      async rollback() { rollbacks++; },
      release() {},
    };
    const auth = { async profile() { return { idUser: 'admin', typeUser: 'admin', managedSpaces: [{ id: 'space' }] }; } };
    const service = createInstitutionService(db, auth);
    assert.equal((await service.members('token', 'space')).available, 1);
    await service.grantMember('token', 'space', { user: 'last' });
    await assert.rejects(service.grantMember('token', 'space', { user: 'extra' }), err => err.status === 409 && err.message.includes(String(limit)));
    await service.grantMember('token', 'space', { user: 'last' });
    const result = await service.members('token', 'space');
    assert.equal(result.capacity, limit);
    assert.equal(result.members.length, limit);
    assert.equal(result.available, 0);
    assert.equal(commits, 2);
    assert.equal(rollbacks, 1);
  });
}
