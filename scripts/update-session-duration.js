require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const db = createDatabase();
(async () => {
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('Base de datos inesperada.');
    // Las sesiones anteriores duraban 168 horas; se conservan sus primeras 3 horas.
    const [result] = await db.query('UPDATE auth_sessions SET expiresAt = DATE_SUB(expiresAt, INTERVAL 165 HOUR) WHERE expiresAt > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)');
    console.log('Sesiones anteriores ajustadas a 3 horas:', result.affectedRows);
  } finally { await db.end(); }
})().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
