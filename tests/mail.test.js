const test = require('node:test');
const assert = require('node:assert/strict');
const { createWelcomeMailer } = require('../services/mailService');

test('correo de bienvenida usa destinatario, remitente y texto exacto solicitado', async () => {
  let message;
  const mailer = createWelcomeMailer({
    env: { SMTP_USER: 'thotem@example.com' },
    transport: { sendMail: async value => { message = value; return { accepted: [value.to], messageId: 'test' }; } },
  });
  await mailer.sendWelcomeEmail({ email: 'persona@gmail.com' });
  assert.equal(message.to, 'persona@gmail.com');
  assert.deepEqual(message.from, { name: 'El equipo de Thotem', address: 'thotem@example.com' });
  assert.equal(message.subject, '¡Registro completado!');
  assert.equal(message.text, '¡Registro completado!\n\nQuedo registrada tu cuenta en Thotem, ¡nos encanta tenerte abordo!\n\nSaludos cordiales,\nEl equipo de Thotem');
});

test('avisa cuando faltan credenciales de envío', async () => {
  await assert.rejects(createWelcomeMailer({ env: {} }).sendWelcomeEmail({ email: 'persona@gmail.com' }), { code: 'MAIL_NOT_CONFIGURED' });
  await assert.rejects(createWelcomeMailer({ env: {} }).verify(), { code: 'MAIL_NOT_CONFIGURED' });
});

test('no presenta como enviado un correo rechazado por SMTP', async () => {
  const mailer = createWelcomeMailer({ env: { SMTP_USER: 'thotem@example.com' }, transport: {
    sendMail: async () => ({ accepted: [], rejected: ['persona@gmail.com'] }),
  } });
  await assert.rejects(mailer.sendWelcomeEmail({ email: 'persona@gmail.com' }), { code: 'MAIL_RECIPIENT_REJECTED' });
});
