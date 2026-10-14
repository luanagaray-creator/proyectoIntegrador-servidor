const express = require('express');

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Correo sin respuesta'), { code: 'SMTP_TIMEOUT' })), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function createPasswordResetRouter(service, sendRecoveryEmail, verifyRecoveryMail) {
  const router = express.Router();
  const attempts = new Map();
  router.use('/auth/password-reset', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = `${req.ip}:${req.path}`;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > (req.path === '/request' ? 5 : 20)) return res.status(429).json({ error: 'Demasiados intentos. Probá nuevamente en unos minutos.' });
    next();
  });
  router.post('/auth/password-reset/request', async (req, res) => {
    // Comprobar SMTP para todas las solicitudes mantiene la misma respuesta
    // ante una caída del correo, exista o no la cuenta indicada.
    try { await within(verifyRecoveryMail(), 12000); }
    catch (err) {
      console.error('Correo de recuperación no disponible:', err.code || err.name);
      return res.status(503).json({ error: 'No pudimos conectar con el servicio de correo. Intentá nuevamente cuando la conexión con Gmail esté disponible.' });
    }
    const { requestId, delivery } = await service.request(req.body || {});
    if (delivery) {
      try { await within(sendRecoveryEmail(delivery), 20000); }
      catch (err) {
        console.error('No se pudo enviar el código de recuperación:', err.code || err.name);
        return res.status(503).json({ error: 'No se pudo enviar el código de recuperación. Probá nuevamente en unos minutos.' });
      }
    }
    res.json({ requestId, message: 'Si el email está registrado, recibirás un código de recuperación. Revisá también Spam.' });
  });
  router.post('/auth/password-reset/verify', async (req, res) => res.json(await service.verify(req.body || {})));
  router.post('/auth/password-reset/confirm', async (req, res) => {
    await service.confirm(req.body || {});
    res.json({ message: 'Contraseña actualizada. Iniciá sesión con tu nueva contraseña.' });
  });
  return router;
}
module.exports = { createPasswordResetRouter };
