const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createAuthService } = require('../services/authService');
const { createApp } = require('../index');

async function verify() {
  const db = createDatabase();
  let server;
  let idUser;
  const suffix = require('node:crypto').randomBytes(5).toString('hex');
  const account = { name: `prueba_${suffix}`, email: `${suffix}@prueba.local`, password: require('node:crypto').randomBytes(16).toString('hex') };
  try {
    const [[database]] = await db.query('SELECT DATABASE() AS name');
    assert.equal(database.name.toLowerCase(), 'proyectointegrador');
    server = createApp(createAuthService(db), { sendWelcomeEmail: async () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(endpoint, body, cookie) {
      const response = await fetch(base + endpoint, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
    }
    const registered = await request('/users/register', account);
    assert.equal(registered.status, 201);
    idUser = registered.data.user.idUser;
    assert.match(registered.cookie, /HttpOnly/);
    assert.equal((await request('/users/profile', undefined, registered.cookie.split(';')[0])).status, 200);
    assert.equal(registered.data.user.password, undefined);
    assert.equal(registered.data.user.typeUser, 'user');
    const [[saved]] = await db.execute('SELECT password FROM users WHERE idUser = ?', [idUser]);
    assert.match(saved.password, /^scrypt:/);
    assert.equal((await request('/users/register', account)).status, 409);
    assert.equal((await request('/auth/login', { name: account.name, password: 'equivocada' })).status, 401);
    const login = await request('/auth/login', account);
    assert.equal(login.status, 200);
    assert.match(login.cookie, /HttpOnly/);
    const cookie = login.cookie.split(';')[0];
    const profile = await request('/users/profile', undefined, cookie);
    assert.equal(profile.status, 200);
    assert.equal(profile.data.user.idUser, idUser);
    assert.equal(profile.data.user.name, account.name);
    const restored = await createAuthService(db).profile(cookie.split('=')[1]);
    assert.equal(restored.idUser, idUser);
    assert.equal((await request('/auth/logout', {}, cookie)).status, 200);
    assert.equal((await request('/users/profile', undefined, cookie)).status, 401);
    console.log('MySQL: registro, contraseña cifrada, duplicados, login, perfil persistente y logout verificados.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (idUser) {
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [idUser]);
      await db.execute('DELETE FROM users WHERE idUser = ? AND name = ?', [idUser, account.name]);
      console.log('Cuenta temporal de prueba eliminada.');
    }
    await db.end();
  }
}
verify().catch(err => { console.error('Falló la verificación:', err.code || err.message); process.exitCode = 1; });
