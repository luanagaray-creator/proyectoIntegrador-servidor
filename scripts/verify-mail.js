const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { createWelcomeMailer } = require('../services/mailService');

async function diagnose() {
  const modes = [
    { SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_AUTH_METHOD: 'LOGIN' },
    { SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_AUTH_METHOD: 'LOGIN' },
  ];
  for (const mode of modes) {
    try {
      await createWelcomeMailer({ env: { ...process.env, ...mode } }).verify();
      console.log(`SMTP conectado: puerto ${mode.SMTP_PORT}, método ${mode.SMTP_AUTH_METHOD}.`);
      return;
    } catch (err) {
      console.error(`Puerto ${mode.SMTP_PORT}, ${mode.SMTP_AUTH_METHOD}: ${err.code || err.name}; respuesta ${err.responseCode || 'sin código SMTP'}.`);
    }
  }
  process.exitCode = 1;
}

// Comprueba conexión y credenciales SMTP sin enviar mensajes.
const deadline = setTimeout(() => {
  console.error('SMTP: CONNECTION_TIMEOUT');
  process.exit(1);
}, process.argv.includes('--diagnose') ? 45000 : 25000);
(process.argv.includes('--diagnose') ? diagnose() : createWelcomeMailer().verify().then(() => {
  console.log('SMTP conectado: el envío de correos está configurado.');
})).catch(err => {
  console.error('SMTP:', err.code || err.name);
  if (err.code === 'EAUTH') {
    const response = err.response || '';
    const reason = /Application-specific password required/i.test(response)
      ? 'Google exige una contraseña de aplicación.'
      : /Username and Password not accepted|BadCredentials|Invalid credentials/i.test(response)
        ? 'Google no acepta la combinación de cuenta y contraseña.'
        : /WebLoginRequired|Please log in via your web browser/i.test(response)
          ? 'Google pide revisar el acceso desde la cuenta en el navegador.'
          : 'Google rechazó la autenticación SMTP.';
    console.error(reason);
  }
  process.exitCode = 1;
}).finally(() => clearTimeout(deadline));
