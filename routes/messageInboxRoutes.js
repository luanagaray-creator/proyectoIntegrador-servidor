const express = require('express');
const { readSession } = require('./authRoutes');
function createMessageRouter(service) {
  const router = express.Router();
  router.use('/messages', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/messages', async (req, res) => res.json(await service.list(readSession(req), req.query.filter)));
  router.get('/messages/:id', async (req, res) => res.json(await service.conversation(readSession(req), req.params.id)));
  router.post('/messages', async (req, res) => res.status(201).json(await service.send(readSession(req), req.body || {})));
  router.post('/messages/:id/replies', async (req, res) => res.status(201).json(await service.reply(readSession(req), req.params.id, req.body || {})));
  router.post('/messages/:id/star', async (req, res) => res.json(await service.setStar(readSession(req), req.params.id, req.body || {})));
  return router;
}
module.exports = { createMessageRouter };
