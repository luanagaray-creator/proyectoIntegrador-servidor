require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
async function setup() {
  const db = createDatabase();
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('La base debe ser proyectoIntegrador.');
    await db.query('CREATE TABLE IF NOT EXISTS message_threads (id CHAR(10) PRIMARY KEY, subject VARCHAR(120) NOT NULL, senderId VARCHAR(10) NOT NULL, recipientId VARCHAR(10) NOT NULL, createdAt DATETIME(3) NOT NULL, INDEX message_threads_sender (senderId), INDEX message_threads_recipient (recipientId))');
    await db.query('CREATE TABLE IF NOT EXISTS message_stars (idUser VARCHAR(10) NOT NULL, threadId CHAR(10) NOT NULL, PRIMARY KEY (idUser, threadId), INDEX message_stars_thread (threadId))');
    const [columns] = await db.query('SHOW COLUMNS FROM mesages');
    await db.query('ALTER TABLE mesages MODIFY COLUMN content TEXT');
    for (const [name, definition] of [
      ['threadId', 'CHAR(10) NULL'], ['senderId', 'VARCHAR(10) NULL'], ['recipientId', 'VARCHAR(10) NULL'], ['sentAt', 'DATETIME(3) NULL'], ['sequence', 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE'],
    ]) {
      if (!columns.some(column => column.Field === name)) await db.query(`ALTER TABLE mesages ADD COLUMN ${name} ${definition}`);
    }
    const [indexes] = await db.query('SHOW INDEX FROM mesages');
    if (!indexes.some(index => index.Key_name === 'mesages_thread_sequence')) await db.query('ALTER TABLE mesages ADD INDEX mesages_thread_sequence (threadId, sequence)');
    console.log('Mensajería preparada. Se conservaron los mensajes anteriores sin asignarles usuarios inventados.');
  } finally { await db.end(); }
}
setup().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
