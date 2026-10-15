const express = require('express');
const { readSession } = require('./authRoutes');
function createGroupChatRouter(service) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/users/group', async (req, res) => res.json(await service.join(readSession(req), req.body || {})));
  router.get('/group-chat', async (req, res) => res.json(await service.history(readSession(req), req.query.spaceId)));
  router.post('/group-chat/messages', async (req, res) => res.status(201).json(await service.send(readSession(req), req.body || {})));
  return router;
}
module.exports = { createGroupChatRouter };
