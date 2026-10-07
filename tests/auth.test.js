const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createAuthService } = require('../services/authService');
const { createApp } = require('../index');

// Sustituto de MySQL para comprobar HTTP, cookies y autenticación sin tocar cuentas reales.
function memoryDatabase() {
  const users = [];
  const sessions = new Map();
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  return {
    users, sessions,
    async execute(sql, values) {
      if (sql.startsWith('SELECT idUser FROM users')) return [users.filter(u => same(u.name, values[0]) || same(u.email, values[1]))];
      if (sql.startsWith('INSERT INTO users')) {
        const [idUser, name, email, password, typeUser, cellPhone] = values;
        if (users.some(u => same(u.name, name) || same(u.email, email))) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        users.push({ idUser, name, email, password, typeUser, cellPhone });
        return [{}];
      }
      if (sql.startsWith('SELECT * FROM users')) return [users.filter(u => same(u.name, values[0]) || same(u.email, values[1]))];
      if (sql.startsWith('UPDATE users SET password')) { users.find(u => u.idUser === values[1]).password = values[0]; return [{}]; }
      if (sql.startsWith('DELETE FROM auth_sessions WHERE expiresAt')) {
        for (const [key, s] of sessions) if (s.expiresAt <= new Date()) sessions.delete(key);
        return [{}];
      }
      if (sql.startsWith('INSERT INTO auth_sessions')) { sessions.set(values[0], { idUser: values[1], expiresAt: values[2] }); return [{}]; }
      if (sql.startsWith('SELECT u.* FROM auth_sessions')) {
        const session = sessions.get(values[0]);
        return [session && session.expiresAt > new Date() ? users.filter(u => u.idUser === session.idUser) : []];
      }
      if (sql.startsWith('DELETE FROM auth_sessions WHERE tokenHash')) { sessions.delete(values[0]); return [{}]; }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
}

async function withServer(run, sendWelcomeEmail = async () => {}) {
  const db = memoryDatabase();
  const service = createAuthService(db);
  const server = createApp(service, { sendWelcomeEmail }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, body, cookie, origin) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  try { await run({ request, db, service }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const account = { name: 'Ana', email: 'ana@example.com', password: 'clave_segura' };

test('registro guarda contraseña cifrada, genera id válido y no permite elegir rol admin', () => withServer(async ({ request, db }) => {
  const result = await request('/users/register', { ...account, typeUser: 'admin' });
  assert.equal(result.status, 201);
  assert.equal(result.data.user.typeUser, 'user');
  assert.match(result.data.user.idUser, /^[a-f0-9]{10}$/);
  assert.equal(result.data.user.password, undefined);
  assert.match(db.users[0].password, /^scrypt:/);
  assert.notEqual(db.users[0].password, account.password);
  assert.match(result.cookie, /HttpOnly/);
  const profile = await request('/users/profile', undefined, result.cookie.split(';')[0]);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.idUser, result.data.user.idUser);
}));

test('login restaura el perfil con cookie y datos de sesión sin exponer contraseña', () => withServer(async ({ request, db }) => {
  await request('/users/register', account);
  const login = await request('/auth/login', { name: account.name, password: account.password });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Lax/);
  assert.match(login.cookie, /Max-Age=604800/);
  const cookie = login.cookie.split(';')[0];
  const profile = await request('/users/profile', undefined, cookie);
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.data.user, login.data.user);
  assert.equal(profile.data.user.password, undefined);
  // La sesión no depende de la instancia del servicio: se consulta en el repositorio.
  const restored = await createAuthService(db).profile(cookie.split('=')[1]);
  assert.equal(restored.name, account.name);
  assert.ok(!db.sessions.has(cookie.split('=')[1]));
}));

test('login admite email y rechaza contraseña incorrecta sin crear sesión', () => withServer(async ({ request, db }) => {
  await request('/users/register', account);
  const previousSessions = db.sessions.size;
  const invalid = await request('/auth/login', { name: account.name, password: 'equivocada' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.cookie, null);
  assert.equal(db.sessions.size, previousSessions);
  assert.equal((await request('/auth/login', { email: account.email, password: account.password })).status, 200);
}));

test('logout invalida la cookie anterior y puede repetirse', () => withServer(async ({ request }) => {
  await request('/users/register', account);
  const login = await request('/auth/login', account);
  const cookie = login.cookie.split(';')[0];
  const logout = await request('/auth/logout', {}, cookie);
  assert.equal(logout.status, 200);
  assert.match(logout.cookie, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/users/profile', undefined, cookie)).status, 401);
  assert.equal((await request('/auth/logout', {})).status, 200);
}));

test('sesión ausente, alterada o vencida no permite consultar perfil', () => withServer(async ({ request, db }) => {
  assert.equal((await request('/users/profile')).status, 401);
  assert.equal((await request('/users/profile', undefined, 'anima_session=alterada')).status, 401);
  await request('/users/register', account);
  const login = await request('/auth/login', account);
  for (const session of db.sessions.values()) session.expiresAt = new Date(0);
  assert.equal((await request('/users/profile', undefined, login.cookie.split(';')[0])).status, 401);
}));

test('registro valida campos y rechaza nombres o emails duplicados', () => withServer(async ({ request }) => {
  assert.equal((await request('/users/register', { ...account, password: '123' })).status, 400);
  assert.equal((await request('/users/register', { ...account, email: 'invalido' })).status, 400);
  assert.equal((await request('/users/register', { ...account, name: 'a'.repeat(31) })).status, 400);
  await request('/users/register', account);
  assert.equal((await request('/users/register', { ...account, name: 'ANA', email: 'otra@example.com' })).status, 409);
  assert.equal((await request('/users/register', { ...account, name: 'Otro' })).status, 409);
}));

test('cuentas anteriores conservan su tipo y actualizan contraseña al iniciar sesión', () => withServer(async ({ request, db }) => {
  db.users.push({ idUser: 'admin00001', name: 'Admin', email: 'admin@example.com', typeUser: 'admin', password: 'clave123', cellPhone: '99123456' });
  const login = await request('/auth/login', { name: 'Admin', password: 'clave123' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.typeUser, 'admin');
  assert.match(db.users[0].password, /^scrypt:/);
}));

test('rechaza solicitudes desde otros sitios y limita intentos repetidos', () => withServer(async ({ request }) => {
  assert.equal((await request('/auth/login', account, undefined, 'https://otro-sitio.example')).status, 403);
  for (let i = 0; i < 20; i++) await request('/auth/login', { name: 'inexistente', password: 'clave123' });
  assert.equal((await request('/auth/login', account)).status, 429);
}));

test('envía bienvenida al email registrado una vez, sin reenviarla en login ni duplicados', async () => {
  const delivered = [];
  await withServer(async ({ request }) => {
    await request('/users/register', account);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].email, account.email);
    await request('/users/register', account);
    await request('/auth/login', account);
    assert.equal(delivered.length, 1);
  }, async user => { delivered.push(user); });
});

test('un fallo de SMTP conserva la cuenta y la sesión del registro', () => withServer(async ({ request }) => {
  const registered = await request('/users/register', account);
  assert.equal(registered.status, 201);
  const profile = await request('/users/profile', undefined, registered.cookie.split(';')[0]);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.name, account.name);
}, async () => { throw Object.assign(new Error('SMTP no disponible'), { code: 'SMTP_TEST_FAILURE' }); }));
