const { randomBytes, randomInt, createHash } = require('node:crypto');
const { hashPassword, verifyPassword } = require('./authService');
const digest = token => createHash('sha256').update(token).digest('hex');
const invalid = () => Object.assign(new Error('El código es incorrecto, venció o ya fue utilizado. Solicitá uno nuevo.'), { status: 400 });

function createPasswordResetService(db) {
  async function request(body) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 30 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Ingresá un email válido de hasta 30 caracteres.'), { status: 400 });
    const requestId = randomBytes(16).toString('hex');
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = await hashPassword(code);
    const [users] = await db.execute('SELECT idUser, email FROM users WHERE email = ?', [email]);
    if (users.length !== 1) return { requestId };
    await db.execute('INSERT INTO password_resets (id, idUser, codeHash, expiresAt, attempts, tokenHash) VALUES (?, ?, ?, ?, 0, NULL) ON DUPLICATE KEY UPDATE id = VALUES(id), codeHash = VALUES(codeHash), expiresAt = VALUES(expiresAt), attempts = 0, tokenHash = NULL', [requestId, users[0].idUser, codeHash, new Date(Date.now() + 15 * 60 * 1000)]);
    return { requestId, delivery: { email: users[0].email, code } };
  }

  async function verify(body) {
    if (typeof body.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(body.requestId) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw invalid();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM password_resets WHERE id = ? AND expiresAt > UTC_TIMESTAMP() FOR UPDATE', [body.requestId]);
      const reset = rows[0];
      if (!reset || reset.attempts >= 5 || reset.tokenHash) throw invalid();
      if (!await verifyPassword(body.code, reset.codeHash)) {
        await connection.execute('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [reset.id]);
        await connection.commit();
        throw invalid();
      }
      const resetToken = randomBytes(32).toString('hex');
      await connection.execute('UPDATE password_resets SET tokenHash = ?, codeHash = NULL, expiresAt = ? WHERE id = ?', [digest(resetToken), new Date(Date.now() + 10 * 60 * 1000), reset.id]);
      await connection.commit();
      return { resetToken };
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }

  async function confirm(body) {
    if (typeof body.resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.resetToken)) throw invalid();
    if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 128) throw Object.assign(new Error('La contraseña debe tener entre 6 y 128 caracteres.'), { status: 400 });
    const password = await hashPassword(body.password);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM password_resets WHERE tokenHash = ? AND expiresAt > UTC_TIMESTAMP() FOR UPDATE', [digest(body.resetToken)]);
      if (!rows[0]) throw invalid();
      await connection.execute('UPDATE users SET password = ? WHERE idUser = ?', [password, rows[0].idUser]);
      await connection.execute('DELETE FROM auth_sessions WHERE idUser = ?', [rows[0].idUser]);
      await connection.execute('DELETE FROM password_resets WHERE id = ?', [rows[0].id]);
      await connection.commit();
    } catch (err) { await connection.rollback(); throw err; }
    finally { connection.release(); }
  }

  return { request, verify, confirm };
}
module.exports = { createPasswordResetService };
