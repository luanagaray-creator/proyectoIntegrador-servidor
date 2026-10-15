require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
async function setup() {
  const db = createDatabase();
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('La base debe ser proyectoIntegrador.');
    await db.query('ALTER TABLE users MODIFY COLUMN typeUser VARCHAR(12)');
    await db.query('CREATE TABLE IF NOT EXISTS institutions (id CHAR(10) PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE)');
    await db.query('CREATE TABLE IF NOT EXISTS communication_spaces (id CHAR(10) PRIMARY KEY, institutionId CHAR(10) NOT NULL, name VARCHAR(30) NOT NULL, UNIQUE KEY institution_space (institutionId, name))');
    await db.query('CREATE TABLE IF NOT EXISTS space_administrators (spaceId CHAR(10) NOT NULL, idUser VARCHAR(10) NOT NULL, PRIMARY KEY (spaceId, idUser), INDEX space_admin_user (idUser))');
    await db.query('CREATE TABLE IF NOT EXISTS space_memberships (spaceId CHAR(10) NOT NULL, idUser VARCHAR(10) NOT NULL, grantedBy VARCHAR(10) NOT NULL, PRIMARY KEY (spaceId, idUser), INDEX space_member_user (idUser))');
    await db.query('CREATE TABLE IF NOT EXISTS admin_plan_spaces (adminId VARCHAR(10) NOT NULL, spaceId CHAR(10) NOT NULL, PRIMARY KEY (adminId, spaceId), INDEX plan_space (spaceId))');
    const [groupColumns] = await db.query('SHOW COLUMNS FROM group_chat_messages');
    if (!groupColumns.some(column => column.Field === 'spaceId')) await db.query('ALTER TABLE group_chat_messages ADD COLUMN spaceId CHAR(10) NULL, ADD INDEX group_chat_space_id (spaceId, id)');
    const [threadColumns] = await db.query('SHOW COLUMNS FROM message_threads');
    if (!threadColumns.some(column => column.Field === 'spaceId')) await db.query('ALTER TABLE message_threads ADD COLUMN spaceId CHAR(10) NULL, ADD INDEX message_thread_space (spaceId)');
    console.log('Instituciones y espacios preparados. Los datos anteriores se conservaron sin asignarlos a una institución arbitraria.');
  } finally { await db.end(); }
}
setup().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
