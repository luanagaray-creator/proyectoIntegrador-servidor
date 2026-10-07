const express = require('express');
const cors = require('cors');
const { createDatabase } = require('./config/db');
const { createAuthService } = require('./services/authService');
const { createAuthRouter } = require('./routes/authRoutes');
const { createWelcomeMailer } = require('./services/mailService');

function createApp(authService, { sendWelcomeEmail = createWelcomeMailer().sendWelcomeEmail } = {}) {
const app = express();
const origins = (process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173').split(',');

app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: '16kb' }));
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.headers.origin && !origins.includes(req.headers.origin)) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  next();
}, createAuthRouter(authService, sendWelcomeEmail));

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'API running', users: [] });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500) console.error('Error de API:', err.code || err.name);
  res.status(status).json({ error: status >= 500 ? 'No se pudo completar la operación. Revisá la conexión y la configuración de MySQL.' : err.message });
});
return app;
}

if (require.main === module) {
  const path = require('node:path');
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  const db = createDatabase();
  db.query('SELECT idUser FROM users LIMIT 0').then(() => db.query('SELECT tokenHash FROM auth_sessions LIMIT 0')).then(() => {
    const port = Number(process.env.PORT || 3001);
    createApp(createAuthService(db)).listen(port, () => console.log(`Servidor en http://localhost:${port}`));
  }).catch(async err => {
    console.error('No se pudo iniciar el servidor MySQL:', err.code || err.name, 'Revisá .env y ejecutá npm run db:auth.');
    await db.end();
    process.exitCode = 1;
  });
}

module.exports = { createApp };

