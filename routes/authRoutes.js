const express = require('express');
const { SESSION_SECONDS } = require('../services/authService');
const COOKIE_NAME = 'anima_session';

function readSession(req) {
  return (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}

function createAuthRouter(service, sendWelcomeEmail) {
  const router = express.Router();
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
  const attempts = new Map();
  function limitAttempts(req, res, next) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const entry = attempts.get(req.ip) || { count: 0, until: now + 15 * 60 * 1000 };
    entry.count++;
    attempts.set(req.ip, entry);
    if (entry.count > 20) return res.status(429).json({ error: 'Demasiados intentos. Probá nuevamente en unos minutos.' });
    next();
  }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/users/register', limitAttempts, async (req, res) => {
    const { token, user } = await service.register(req.body || {});
    // El correo se envía después de responder; SMTP no retrasa ni revierte el registro.
    res.once('finish', () => {
      Promise.resolve().then(() => sendWelcomeEmail(user)).catch(err => {
        console.error('No se pudo enviar el correo de registro:', err.code || err.name);
      });
    });
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
    res.status(201).json({ message: 'Usuario registrado', user });
  });
  router.post('/auth/login', limitAttempts, async (req, res) => {
    const { token, user } = await service.login(req.body || {});
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
    res.json({ user });
  });
  router.get('/users/profile', async (req, res) => {
    res.json({ user: await service.profile(readSession(req)) });
  });
  router.post('/auth/logout', async (req, res) => {
    await service.logout(readSession(req));
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.json({ message: 'Sesión cerrada' });
  });
  return router;
}

module.exports = { createAuthRouter };
