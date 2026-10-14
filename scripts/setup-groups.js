require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const groups = require('../config/groups.json');
async function setup() {
  const db = createDatabase();
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('La base debe ser proyectoIntegrador.');
    const [columns] = await db.query('SHOW COLUMNS FROM users');
    if (!columns.some(column => column.Field === 'groupCode')) await db.query('ALTER TABLE users ADD COLUMN groupCode VARCHAR(7) NULL');
    await db.query('CREATE TABLE IF NOT EXISTS school_groups (code VARCHAR(7) PRIMARY KEY)');
    for (const group of groups) await db.execute('INSERT IGNORE INTO school_groups (code) VALUES (?)', [group]);
    await db.query('CREATE TABLE IF NOT EXISTS group_chat_messages (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, groupCode VARCHAR(7) NOT NULL, senderId VARCHAR(10) NOT NULL, content TEXT NOT NULL, sentAt DATETIME(3) NOT NULL, INDEX group_chat_group_id (groupCode, id))');
    console.log('Seis grupos preparados. Las cuentas anteriores conservan sus datos y podrán elegir su grupo al entrar al chat.');
  } finally { await db.end(); }
}
setup().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
