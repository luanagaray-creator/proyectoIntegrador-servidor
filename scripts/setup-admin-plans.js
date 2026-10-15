require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
async function setup() {
  const db = createDatabase();
  try {
    const [[info]] = await db.query('SELECT DATABASE() AS name');
    if (info.name.toLowerCase() !== 'proyectointegrador') throw new Error('La base debe ser proyectoIntegrador.');
    await db.query('CREATE TABLE IF NOT EXISTS admin_plan_groups (adminId VARCHAR(10) NOT NULL, groupCode VARCHAR(7) NOT NULL, PRIMARY KEY (adminId, groupCode), INDEX admin_plan_groups_group (groupCode))');
    console.log('Planes de administradores preparados. Los pagos anteriores se conservaron; las cuentas comunes ya no se habilitan por un pago individual.');
  } finally { await db.end(); }
}
setup().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
