import { Router, type Request } from 'express';
import { UUID_PATTERN } from '@team-plan/shared';
import type { DatabaseHandle } from '../../db/connection';
import { createBoardService } from '../../business/boards';
import { AppError } from '../errors';
import { assertAllowedKeys, parseQuery } from '../validation';
import { writeRoute } from '../middleware/json-body';

export function boardsRouter(db: DatabaseHandle): Router {
  const router = Router();
  const service = createBoardService(db);
  function read(req: Request): void { parseQuery(req.query, []); }
  function id(req: Request, key: string): string {
    const value = req.params[key];
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new AppError(400, 'BAD_REQUEST');
    return value.toLowerCase();
  }
  router.get('/members', (req, res) => { read(req); res.json({ data: service.listMembers() }); });
  router.get('/boards', (req, res) => { read(req); res.json({ data: service.listBoards() }); });
  router.post('/boards', ...writeRoute((req, res) => {
    read(req); assertAllowedKeys(req.body, ['name']);
    res.status(201).json({ data: service.createBoard(req.body) });
  }));
  router.get('/boards/:boardId', (req, res) => {
    read(req); res.json({ data: service.getBoard(id(req, 'boardId')) });
  });
  router.get('/boards/:boardId/tasks', (req, res) => {
    read(req); res.json({ data: service.listTasks(id(req, 'boardId')) });
  });
  router.post('/boards/:boardId/tasks', ...writeRoute((req, res) => {
    read(req); assertAllowedKeys(req.body, ['title', 'description', 'dueDate', 'assigneeId', 'status']);
    res.status(201).json({ data: service.createTask(id(req, 'boardId'), req.body) });
  }));
  router.get('/boards/:boardId/tasks/:taskId', (req, res) => {
    read(req); res.json({ data: service.getTask(id(req, 'boardId'), id(req, 'taskId')) });
  });
  return router;
}
