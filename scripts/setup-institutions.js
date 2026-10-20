require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
async function setup() {
  const db = createDatabase();
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('La base debe ser proyectoIntegrador.');
    await db.query('ALTER TABLE users MODIFY COLUMN typeUser VARCHAR(12)');
    const [userColumns] = await db.query('SHOW COLUMNS FROM users');
    if (!userColumns.some(column => column.Field === 'isActive')) await db.query('ALTER TABLE users ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1');
    await db.query('CREATE TABLE IF NOT EXISTS institutions (id CHAR(10) PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE)');
    await db.query('CREATE TABLE IF NOT EXISTS communication_spaces (id CHAR(10) PRIMARY KEY, institutionId CHAR(10) NOT NULL, name VARCHAR(30) NOT NULL, UNIQUE KEY institution_space (institutionId, name))');
    await db.query('CREATE TABLE IF NOT EXISTS space_administrators (spaceId CHAR(10) NOT NULL, idUser VARCHAR(10) NOT NULL, PRIMARY KEY (spaceId, idUser), INDEX space_admin_user (idUser))');
    await db.query('CREATE TABLE IF NOT EXISTS institution_administrators (institutionId CHAR(10) NOT NULL, idUser VARCHAR(10) NOT NULL, PRIMARY KEY (institutionId, idUser), INDEX institution_admin_user (idUser))');
    await db.query('INSERT IGNORE INTO institution_administrators (institutionId, idUser) SELECT DISTINCT s.institutionId, manager.idUser FROM space_administrators manager JOIN communication_spaces s ON s.id = manager.spaceId JOIN users u ON u.idUser = manager.idUser AND u.typeUser = \'admin\'');
    const [purchaseColumns] = await db.query('SHOW COLUMNS FROM simulated_purchases');
    if (!purchaseColumns.some(column => column.Field === 'institutionId')) await db.query('ALTER TABLE simulated_purchases ADD COLUMN institutionId CHAR(10) NULL, ADD INDEX purchase_institution (institutionId)');
    await db.query('UPDATE simulated_purchases payment JOIN (SELECT covered.adminId, MIN(s.institutionId) AS institutionId FROM admin_plan_spaces covered JOIN communication_spaces s ON s.id = covered.spaceId GROUP BY covered.adminId HAVING COUNT(DISTINCT s.institutionId) = 1) covered ON covered.adminId = payment.idUser SET payment.institutionId = covered.institutionId WHERE payment.institutionId IS NULL');
    await db.query('CREATE TABLE IF NOT EXISTS space_memberships (spaceId CHAR(10) NOT NULL, idUser VARCHAR(10) NOT NULL, grantedBy VARCHAR(10) NOT NULL, PRIMARY KEY (spaceId, idUser), INDEX space_member_user (idUser))');
    const [membershipIndexes] = await db.query('SHOW INDEX FROM space_memberships');
    if (!membershipIndexes.some(index => index.Key_name === 'space_member_single_chat')) {
      await db.query('ALTER TABLE space_memberships ADD UNIQUE KEY space_member_single_chat (idUser)');
    }
    await db.query('CREATE TABLE IF NOT EXISTS admin_plan_spaces (adminId VARCHAR(10) NOT NULL, spaceId CHAR(10) NOT NULL, PRIMARY KEY (adminId, spaceId), INDEX plan_space (spaceId))');
    const [groupColumns] = await db.query('SHOW COLUMNS FROM group_chat_messages');
    if (groupColumns.find(column => column.Field === 'groupCode')?.Type === 'varchar(7)') await db.query('ALTER TABLE group_chat_messages MODIFY COLUMN groupCode VARCHAR(30) NOT NULL');
    if (!groupColumns.some(column => column.Field === 'spaceId')) await db.query('ALTER TABLE group_chat_messages ADD COLUMN spaceId CHAR(10) NULL, ADD INDEX group_chat_space_id (spaceId, id)');
    const [threadColumns] = await db.query('SHOW COLUMNS FROM message_threads');
    if (!threadColumns.some(column => column.Field === 'spaceId')) await db.query('ALTER TABLE message_threads ADD COLUMN spaceId CHAR(10) NULL, ADD INDEX message_thread_space (spaceId)');
    if (!threadColumns.some(column => column.Field === 'institutionId')) await db.query('ALTER TABLE message_threads ADD COLUMN institutionId CHAR(10) NULL, ADD INDEX message_thread_institution (institutionId)');
    await db.query('UPDATE message_threads t JOIN communication_spaces s ON s.id = t.spaceId SET t.institutionId = s.institutionId WHERE t.institutionId IS NULL');
    console.log('Instituciones y espacios preparados. Los datos anteriores se conservaron sin asignarlos a una institución arbitraria.');
  } finally { await db.end(); }
}
setup().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
