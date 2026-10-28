import { Router } from 'express';
import type { ProjectService } from '../../modules/projects/service';
import { currentUser } from './accounts';
import { AppError } from '../errors';
import { writeRoute } from '../middleware/json-body';
import { assertAllowedKeys, assertUuidParam, parseQuery, pathParam } from '../validation';

export function projectsRouter(service: ProjectService): Router {
  const router = Router();
  router.use('/boards/:boardId', (req, res, next) => {
    service.access(assertUuidParam(pathParam(req.params.boardId)), currentUser(res).id);
    parseQuery(req.query as Record<string, unknown>, []);
    next();
  });
  router.get('/boards/:boardId/members', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    res.json({ data: service.members(pathParam(req.params.boardId)) });
  });
  router.get('/boards/:boardId/activity', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    res.json({ data: service.activity(pathParam(req.params.boardId)) });
  });
  router.post('/boards/:boardId/members', ...writeRoute((req, res) => {
    assertAllowedKeys(req.body, ['username']);
    if (typeof req.body.username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(req.body.username.trim())) {
      throw new AppError(422, 'VALIDATION_ERROR', { fields: { username: '请填写对方注册时的用户名' } });
    }
    const boardId = pathParam(req.params.boardId);
    service.add(boardId, currentUser(res).id, req.body.username.trim().toLowerCase());
    res.json({ data: service.members(boardId) });
  }));
  router.delete('/boards/:boardId/members/:userId', ...writeRoute((req, res) => {
    assertAllowedKeys(req.body, []);
    service.remove(pathParam(req.params.boardId), currentUser(res).id, assertUuidParam(pathParam(req.params.userId)));
    res.status(204).end();
  }));
  router.put('/boards/:boardId/owner', ...writeRoute((req, res) => {
    assertAllowedKeys(req.body, ['userId']);
    service.transfer(pathParam(req.params.boardId), currentUser(res).id, assertUuidParam(typeof req.body.userId === 'string' ? req.body.userId : ''));
    res.status(204).end();
  }));
  return router;
}
