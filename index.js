const express = require('express');
const cors = require('cors');
const { createDatabase } = require('./config/db');
const { createAuthService } = require('./services/authService');
const { createAuthRouter } = require('./routes/authRoutes');
const { createWelcomeMailer } = require('./services/mailService');
const { createPasswordResetService } = require('./services/passwordResetService');
const { createPasswordResetRouter } = require('./routes/passwordResetRoutes');
const { createMessageService } = require('./services/messageService');
const { createMessageRouter } = require('./routes/messageInboxRoutes');
const { createGroupChatService } = require('./services/groupChatService');
const { createGroupChatRouter } = require('./routes/groupChatRoutes');
const { createInstitutionService } = require('./services/institutionService');
const { createInstitutionRouter } = require('./routes/institutionRoutes');

function createApp(authService, { sendWelcomeEmail = createWelcomeMailer().sendWelcomeEmail, resetService, messageService, groupChatService, institutionService, sendRecoveryEmail = createWelcomeMailer().sendRecoveryEmail, verifyRecoveryMail = createWelcomeMailer().verify } = {}) {
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
if (resetService) app.use('/api', createPasswordResetRouter(resetService, sendRecoveryEmail, verifyRecoveryMail));
if (messageService) app.use('/api', createMessageRouter(messageService));
if (groupChatService) app.use('/api', createGroupChatRouter(groupChatService));
if (institutionService) app.use('/api', createInstitutionRouter(institutionService));

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
  db.query('SELECT idUser FROM users LIMIT 0').then(() => db.query('SELECT tokenHash FROM auth_sessions LIMIT 0')).then(() => db.query('SELECT idUser FROM simulated_purchases LIMIT 0')).then(() => db.query('SELECT id FROM password_resets LIMIT 0')).then(() => db.query('SELECT spaceId FROM admin_plan_spaces LIMIT 0')).then(() => db.query('SELECT groupCode FROM users LIMIT 0')).then(() => db.query('SELECT spaceId FROM group_chat_messages LIMIT 0')).then(() => db.query('SELECT spaceId, institutionId FROM message_threads LIMIT 0')).then(() => db.query('SELECT threadId FROM message_stars LIMIT 0')).then(() => db.query('SELECT threadId, sequence FROM mesages LIMIT 0')).then(() => {
    const port = Number(process.env.PORT || 3001);
    const authService = createAuthService(db);
    createApp(authService, { resetService: createPasswordResetService(db), messageService: createMessageService(db, authService), groupChatService: createGroupChatService(db, authService), institutionService: createInstitutionService(db, authService) }).listen(port, () => console.log(`Servidor en http://localhost:${port}`));
  }).catch(async err => {
    console.error('No se pudo iniciar el servidor MySQL:', err.code || err.name, 'Revisá .env y ejecutá npm run db:auth, npm run db:messages y npm run db:groups y npm run db:institutions.');
    await db.end();
    process.exitCode = 1;
  });
}

module.exports = { createApp };

