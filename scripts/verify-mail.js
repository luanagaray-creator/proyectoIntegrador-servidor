const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { createWelcomeMailer } = require('../services/mailService');

function networkReason(err) {
  const message = err.message || '';
  if (/certificate.*expired/i.test(message)) return 'El certificado TLS está vencido según la fecha del equipo.';
  if (/self.signed|unable to verify|certificate chain|local issuer/i.test(message)) return 'No se pudo validar el certificado TLS de la conexión.';
  if (/ECONNRESET|socket.*closed|connection.*closed|socket.*end/i.test(message)) return 'La conexión SMTP se cerró antes de completarse.';
  if (/timed? ?out|timeout/i.test(message)) return 'La conexión SMTP no respondió dentro del plazo.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return 'No se pudo resolver el servidor SMTP.';
  if (/EPERM|EACCES|not permitted/i.test(message)) return 'El entorno está bloqueando la conexión SMTP por permisos.';
  if (/ECONNREFUSED/i.test(message)) return 'El acceso al puerto SMTP fue rechazado.';
  return '';
}

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
      if (networkReason(err)) console.error(networkReason(err));
    }
  }
  process.exitCode = 1;
}

async function inspectNetwork() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const addresses = await require('node:dns').promises.lookup(host, { all: true });
  console.log('Resolución DNS:', addresses.map(value => `IPv${value.family}`).join(', '));
  const ipv4 = addresses.find(value => value.family === 4)?.address;
  const cases = [{ host, port: 465, secure: true, label: 'TLS por DNS' }, { host: ipv4, port: 465, secure: true, label: 'TLS por IPv4' }, { host: ipv4, port: 587, secure: false, label: 'SMTP por IPv4' }].filter(value => value.host);
  await Promise.all(cases.map(config => new Promise(resolve => {
    const socket = config.secure ? require('node:tls').connect({ host: config.host, port: config.port, servername: host }) : require('node:net').connect({ host: config.host, port: config.port });
    let finished = false;
    function finish(message) {
      if (finished) return;
      finished = true;
      console.log(`${config.label}: ${message}`);
      socket.destroy();
      resolve();
    }
    socket.setTimeout(8000, () => finish('sin respuesta en 8 segundos'));
    socket.on('data', () => finish('conexión y saludo SMTP recibidos'));
    // Esta conexión no envía credenciales; solo comprueba TLS y el saludo del servidor.
    socket.on('error', err => finish(`${err.code || err.name}: ${err.message}`));
  })));
}

// Comprueba conexión y credenciales SMTP sin enviar mensajes.
const deadline = setTimeout(() => {
  console.error('SMTP: CONNECTION_TIMEOUT');
  process.exit(1);
}, process.argv.includes('--diagnose') ? 45000 : 25000);
(process.argv.includes('--network') ? inspectNetwork() : process.argv.includes('--diagnose') ? diagnose() : createWelcomeMailer().verify().then(() => {
  console.log('SMTP conectado: el envío de correos está configurado.');
})).catch(err => {
  console.error('SMTP:', err.code || err.name);
  if (networkReason(err)) console.error(networkReason(err));
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
