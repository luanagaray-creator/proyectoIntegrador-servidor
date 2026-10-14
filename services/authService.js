const { randomBytes, createHash, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 3 * 60 * 60;
const planPrices = require('../config/plans.json');
const groups = require('../config/groups.json');

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

function publicUser(user) {
  return { idUser: user.idUser, name: user.name, typeUser: user.typeUser, groupCode: user.groupCode || null, email: user.email, cellPhone: user.cellPhone, ...(user.sessionExpiresAt ? { sessionExpiresAt: new Date(user.sessionExpiresAt).toISOString() } : {}) };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (!stored.startsWith('scrypt:')) {
    // Compatibilidad con cuentas del SQL original; se actualizan al iniciar sesión.
    const input = Buffer.from(password);
    const original = Buffer.from(stored);
    return input.length === original.length && timingSafeEqual(input, original);
  }
  const [, salt, hash] = stored.split(':');
  if (!salt || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');

function createAuthService(db) {
  async function withPurchase(user) {
    const [purchases] = await db.execute('SELECT plan, method, paidAt, amount FROM simulated_purchases WHERE idUser = ?', [user.idUser]);
    return { ...publicUser(user), purchase: purchases[0] ? { ...purchases[0], amount: purchases[0].amount == null ? null : Number(purchases[0].amount), simulated: true } : null };
  }

  async function createSession(user) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    await db.execute('DELETE FROM auth_sessions WHERE expiresAt <= UTC_TIMESTAMP()', []);
    await db.execute('INSERT INTO auth_sessions (tokenHash, idUser, expiresAt) VALUES (?, ?, ?)', [tokenHash(token), user.idUser, expiresAt]);
    return { token, user: await withPurchase({ ...user, sessionExpiresAt: expiresAt }) };
  }

  async function register(body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;
    if (!name || name.length > 30 || name.includes('@')) throw error(400, 'El nombre debe tener entre 1 y 30 caracteres y no incluir @.');
    if (email.length > 30 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw error(400, 'Ingresá un email válido de hasta 30 caracteres.');
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw error(400, 'La contraseña debe tener entre 6 y 128 caracteres.');
    if (!groups.includes(body.groupCode)) throw error(400, 'Seleccioná uno de los seis grupos disponibles.');
    const [existing] = await db.execute('SELECT idUser FROM users WHERE name = ? OR email = ?', [name, email]);
    if (existing.length) throw error(409, 'El nombre de usuario o el email ya están registrados.');
    const user = { idUser: randomBytes(5).toString('hex'), name, email, typeUser: 'user', groupCode: body.groupCode, cellPhone: null };
    const passwordHash = await hashPassword(password);
    try {
      await db.execute('INSERT INTO users (idUser, name, email, password, typeUser, cellPhone, groupCode) VALUES (?, ?, ?, ?, ?, ?, ?)', [user.idUser, name, email, passwordHash, user.typeUser, null, user.groupCode]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw error(409, 'El nombre de usuario o el email ya están registrados.');
      throw err;
    }
    return createSession(user);
  }

  async function login(body) {
    const identifier = typeof (body.name ?? body.email) === 'string' ? (body.name ?? body.email).trim() : '';
    if (!identifier || typeof body.password !== 'string' || !body.password || body.password.length > 128) throw error(400, 'Completá el usuario y la contraseña.');
    const [users] = await db.execute('SELECT * FROM users WHERE name = ? OR email = ?', [identifier, identifier]);
    const user = users[0];
    if (users.length !== 1 || !await verifyPassword(body.password, user.password)) throw error(401, 'Usuario o contraseña incorrectos.');
    if (!user.password.startsWith('scrypt:')) {
      await db.execute('UPDATE users SET password = ? WHERE idUser = ?', [await hashPassword(body.password), user.idUser]);
    }
    return createSession(user);
  }

  async function profile(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw error(401, 'No hay una sesión activa.');
    const [users] = await db.execute('SELECT u.*, s.expiresAt AS sessionExpiresAt FROM auth_sessions s JOIN users u ON u.idUser = s.idUser WHERE s.tokenHash = ? AND s.expiresAt > UTC_TIMESTAMP()', [tokenHash(token)]);
    if (!users[0]) throw error(401, 'La sesión venció. Iniciá sesión nuevamente.');
    return withPurchase(users[0]);
  }

  async function simulatePurchase(token, body) {
    const user = await profile(token);
    if (!Object.hasOwn(planPrices, body.plan)) throw error(400, 'Seleccioná un paquete válido.');
    if (!['Visa', 'Mercado Pago', 'Mastercard'].includes(body.method)) throw error(400, 'Seleccioná un método de pago válido.');
    // Simulación: no se reciben, almacenan ni cobran datos de tarjetas.
    await db.execute('INSERT INTO simulated_purchases (idUser, plan, method, amount, paidAt) VALUES (?, ?, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE plan = VALUES(plan), method = VALUES(method), amount = VALUES(amount), paidAt = UTC_TIMESTAMP()', [user.idUser, body.plan, body.method, planPrices[body.plan]]);
    return withPurchase(user);
  }

  async function logout(token) {
    if (token && /^[a-f0-9]{64}$/.test(token)) await db.execute('DELETE FROM auth_sessions WHERE tokenHash = ?', [tokenHash(token)]);
  }

  return { register, login, profile, logout, simulatePurchase };
}

module.exports = { createAuthService, hashPassword, verifyPassword, SESSION_SECONDS };
