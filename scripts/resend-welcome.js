const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../config/db');
const { createWelcomeMailer } = require('../services/mailService');

async function resend() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('Indicá el email de una cuenta registrada.');
  const db = createDatabase();
  try {
    const [users] = await db.execute('SELECT email FROM users WHERE email = ?', [email]);
    if (users.length !== 1) throw new Error('No se encontró una cuenta registrada con ese email.');
    await createWelcomeMailer().sendWelcomeEmail(users[0]);
    console.log('Gmail aceptó el correo de bienvenida para su envío.');
  } finally {
    await db.end();
  }
}

const deadline = setTimeout(() => {
  console.error('Correo: CONNECTION_TIMEOUT');
  process.exit(1);
}, 35000);
resend().catch(err => {
  console.error('No se pudo reenviar el correo:', err.code || err.message);
  process.exitCode = 1;
}).finally(() => clearTimeout(deadline));
