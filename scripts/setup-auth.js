const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');

async function setup() {
  const db = createDatabase();
  try {
    // Evita modificar una base accidentalmente distinta a la indicada por el usuario.
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('DATABASE_URL debe apuntar a proyectoIntegrador antes de ejecutar esta preparación.');
    const [duplicates] = await db.query('SELECT name FROM users WHERE name IS NOT NULL GROUP BY name HAVING COUNT(*) > 1 UNION ALL SELECT email FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1');
    if (duplicates.length) throw new Error('Hay nombres o emails duplicados; corregilos antes de preparar autenticación. No se modificó la base.');
    await db.query('ALTER TABLE users MODIFY COLUMN password VARCHAR(255)');
    const [indexes] = await db.query('SHOW INDEX FROM users');
    for (const column of ['name', 'email']) {
      const unique = indexes.some(index => index.Column_name === column && index.Non_unique === 0 && indexes.filter(other => other.Key_name === index.Key_name).length === 1);
      if (!unique) await db.query(`ALTER TABLE users ADD UNIQUE KEY users_${column}_unique (${column})`);
    }
    await db.query('CREATE TABLE IF NOT EXISTS auth_sessions (tokenHash CHAR(64) PRIMARY KEY, idUser VARCHAR(10) NOT NULL, expiresAt DATETIME NOT NULL, INDEX auth_sessions_user (idUser), INDEX auth_sessions_expiration (expiresAt))');
    console.log('Autenticación preparada en proyectoIntegrador. Los usuarios existentes se conservaron.');
  } finally {
    await db.end();
  }
}
setup().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
