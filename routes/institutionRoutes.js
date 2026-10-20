const express = require('express');
const { readSession } = require('./authRoutes');
function createInstitutionRouter(service) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/platform/institutions', async (req, res) => res.json(await service.dashboard(readSession(req))));
  router.post('/platform/institutions', async (req, res) => res.status(201).json(await service.createInstitution(readSession(req), req.body || {})));
  router.delete('/platform/institutions/:institutionId', async (req, res) => res.json(await service.deleteInstitution(readSession(req), req.params.institutionId)));
  router.delete('/platform/institutions/:institutionId/administrators/:userId', async (req, res) => res.json(await service.revokeInstitutionAdministrator(readSession(req), req.params.institutionId, req.params.userId)));
  router.post('/platform/administrators', async (req, res) => res.json(await service.grantAdministrator(readSession(req), req.body || {})));
  router.patch('/platform/administrators/:userId', async (req, res) => res.json(await service.setAdministratorStatus(readSession(req), req.params.userId, req.body || {})));
  router.delete('/platform/spaces/:spaceId/administrators/:userId', async (req, res) => res.json(await service.revokeAdministrator(readSession(req), req.params.spaceId, req.params.userId)));
  router.get('/admin/spaces/:spaceId/members', async (req, res) => res.json(await service.members(readSession(req), req.params.spaceId)));
  router.post('/admin/spaces', async (req, res) => res.status(201).json(await service.createSpace(readSession(req), req.body || {})));
  router.patch('/admin/spaces/:spaceId', async (req, res) => res.json(await service.renameSpace(readSession(req), req.params.spaceId, req.body || {})));
  router.delete('/admin/spaces/:spaceId', async (req, res) => res.json(await service.deleteSpace(readSession(req), req.params.spaceId)));
  router.post('/admin/spaces/:spaceId/members', async (req, res) => res.json(await service.grantMember(readSession(req), req.params.spaceId, req.body || {})));
  router.delete('/admin/spaces/:spaceId/members/:userId', async (req, res) => res.json(await service.revokeMember(readSession(req), req.params.spaceId, req.params.userId)));
  return router;
}
module.exports = { createInstitutionRouter };
