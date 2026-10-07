const WELCOME_SUBJECT = '¡Registro completado!';
const WELCOME_TEXT = `¡Registro completado!

Quedo registrada tu cuenta en Thotem, ¡nos encanta tenerte abordo!

Saludos cordiales,
El equipo de Thotem`;

function createWelcomeMailer({ env = process.env, transport } = {}) {
  let smtp = transport;

  function getTransport() {
    if (smtp) return smtp;
    if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
      throw Object.assign(new Error('Configurá SMTP_USER y SMTP_PASSWORD en .env para enviar los correos.'), { code: 'MAIL_NOT_CONFIGURED' });
    }
    const port = Number(env.SMTP_PORT || 465);
    const host = env.SMTP_HOST || 'smtp.gmail.com';
    const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
    smtp = require('nodemailer').createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      authMethod: env.SMTP_AUTH_METHOD || undefined,
      auth: { user: env.SMTP_USER, pass: host === 'smtp.gmail.com' ? env.SMTP_PASSWORD.replace(/\s/g, '') : env.SMTP_PASSWORD },
      connectionTimeout: 10000,
      dnsTimeout: 5000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return smtp;
  }

  async function sendWelcomeEmail(user) {
    const result = await getTransport().sendMail({
      from: { name: 'El equipo de Thotem', address: env.SMTP_USER },
      to: user.email,
      subject: WELCOME_SUBJECT,
      text: WELCOME_TEXT,
    });
    if (result.rejected?.length || !result.accepted?.length) {
      throw Object.assign(new Error('El servidor de correo no aceptó el destinatario.'), { code: 'MAIL_RECIPIENT_REJECTED' });
    }
    return result.messageId;
  }

  return { sendWelcomeEmail, verify: async () => getTransport().verify() };
}

module.exports = { createWelcomeMailer, WELCOME_SUBJECT, WELCOME_TEXT };
