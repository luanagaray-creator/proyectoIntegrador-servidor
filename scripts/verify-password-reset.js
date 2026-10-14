const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createAuthService } = require('../services/authService');
const { createPasswordResetService } = require('../services/passwordResetService');
const { createApp } = require('../index');

async function verify() {
  const db = createDatabase();
  const suffix = randomBytes(5).toString('hex');
  const account = { name: `reset_${suffix}`, email: `${suffix}@prueba.local`, password: randomBytes(16).toString('hex'), groupCode: '3ro TIC' };
  let server, idUser;
  const codes = [];
  try {
    const [[database]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(database.name.toLowerCase(), 'proyectointegrador');
    server = createApp(createAuthService(db), { resetService: createPasswordResetService(db), verifyRecoveryMail: async () => {}, sendWelcomeEmail: async () => {}, sendRecoveryEmail: async delivery => { codes.push(delivery.code); } }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, body, cookie) {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
    }
    async function issue() {
      const result = await request('/auth/password-reset/request', { email: account.email });
      assert.equal(result.status, 200);
      await new Promise(resolve => setImmediate(resolve));
      return { requestId: result.data.requestId, code: codes.at(-1) };
    }
    const registration = await request('/users/register', account);
    idUser = registration.data.user.idUser;
    const cookie = registration.cookie.split(';')[0];
    await request('/payments/simulate', { plan: 'Small Plan', method: 'Visa' }, cookie);
    const unknown = await request('/auth/password-reset/request', { email: `no_${suffix}@prueba.local` });
    assert.equal(unknown.status, 200);
    assert.equal(codes.length, 0);
    const first = await issue();
    assert.equal(unknown.data.message, 'Si el email está registrado, recibirás un código de recuperación. Revisá también Spam.');
    assert.match(first.code, /^\d{6}$/);
    const [[stored]] = await db.execute('SELECT codeHash FROM password_resets WHERE idUser = ?', [idUser]);
    assert.notEqual(stored.codeHash, first.code);
    const wrong = first.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await request('/auth/password-reset/verify', { ...first, code: wrong })).status, 400);
    assert.equal((await request('/auth/password-reset/verify', first)).status, 400);
    const second = await issue();
    assert.equal((await request('/auth/password-reset/verify', first)).status, 400);
    const verified = await Promise.all([request('/auth/password-reset/verify', second), request('/auth/password-reset/verify', second)]);
    assert.deepEqual(verified.map(result => result.status).sort(), [200, 400]);
    const resetToken = verified.find(result => result.status === 200).data.resetToken;
    assert.equal((await request('/auth/password-reset/confirm', { resetToken, password: '123' })).status, 400);
    const newPassword = randomBytes(16).toString('hex');
    const confirmed = await Promise.all([request('/auth/password-reset/confirm', { resetToken, password: newPassword }), request('/auth/password-reset/confirm', { resetToken, password: newPassword })]);
    assert.deepEqual(confirmed.map(result => result.status).sort(), [200, 400]);
    assert.equal((await request('/users/profile', undefined, cookie)).status, 401);
    assert.equal((await request('/auth/login', account)).status, 401);
    const login = await request('/auth/login', { name: account.name, password: newPassword });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.purchase.amount, 250);
    const expiredCode = await issue();
    await db.execute('UPDATE password_resets SET expiresAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE idUser = ?', [idUser]);
    assert.equal((await request('/auth/password-reset/verify', expiredCode)).status, 400);
    const expiredTokenCode = await issue();
    const tokenResult = await request('/auth/password-reset/verify', expiredTokenCode);
    await db.execute('UPDATE password_resets SET expiresAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE idUser = ?', [idUser]);
    assert.equal((await request('/auth/password-reset/confirm', { resetToken: tokenResult.data.resetToken, password: newPassword })).status, 400);
    assert.equal((await request('/auth/password-reset/request', { email: account.email })).status, 429);
    console.log('Recuperación verificada: email privado, códigos cifrados, límite de intentos, reenvío, vencimiento, uso único concurrente, nueva contraseña, cierre de sesiones y paquete conservado. No se enviaron correos reales.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (idUser) {
      await db.execute('DELETE FROM password_resets WHERE idUser = ?', [idUser]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [idUser]);
      await db.execute('DELETE FROM simulated_purchases WHERE idUser = ?', [idUser]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [idUser, account.name]);
      console.log('Cuenta temporal de recuperación eliminada.');
    }
    await db.end();
  }
}
verify().catch(err => { console.error('Falló la verificación de recuperación:', err.code || err.message); process.exitCode = 1; });
