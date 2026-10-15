const { randomBytes } = require('node:crypto');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { hashPassword } = require('../services/authService');
async function provision() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { name, email, password } = JSON.parse(input);
  if (!name || !email || typeof password !== 'string' || password.length < 6) throw new Error('Datos incompletos.');
  const db = createDatabase();
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('La base debe ser proyectoIntegrador.');
    const [existing] = await db.execute('SELECT idUser, name, email FROM users WHERE name = ? OR email = ?', [name, email]);
    if (existing.length && (existing.length !== 1 || existing[0].name.toLowerCase() !== name.toLowerCase() || existing[0].email.toLowerCase() !== email.toLowerCase())) throw new Error('El nombre o email pertenece a otra cuenta; no se modificó.');
    const passwordHash = await hashPassword(password);
    if (existing[0]) {
      await db.execute("UPDATE users SET password = ?, typeUser = 'superadmin' WHERE idUser = ?", [passwordHash, existing[0].idUser]);
      await db.execute('DELETE FROM auth_sessions WHERE idUser = ?', [existing[0].idUser]);
    } else await db.execute("INSERT INTO users (idUser, name, email, password, typeUser, cellPhone, groupCode) VALUES (?, ?, ?, ?, 'superadmin', NULL, NULL)", [randomBytes(5).toString('hex'), name, email.toLowerCase(), passwordHash]);
    console.log('Cuenta superadmin preparada:', name, email);
  } finally { await db.end(); }
}
provision().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
