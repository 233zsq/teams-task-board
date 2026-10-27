import { Router } from 'express';
import { parseTaskCreateInput, parseTaskUpdateInput } from '@team-plan/shared';
import type { TaskService } from '../../modules/tasks/service';
import { AppError } from '../errors';
import { writeRoute } from '../middleware/json-body';
import { assertAllowedKeys, assertUuidParam, parseQuery, pathParam } from '../validation';

export interface TasksRouterDeps {
  service: TaskService;
}

const TASK_FIELDS = ['title', 'description', 'dueDate', 'assigneeId', 'status'] as const;

/** Task routes: every single-task operation is scoped to boardId + taskId. */
export function tasksRouter(deps: TasksRouterDeps): Router {
  const router = Router();

  router.get('/boards/:boardId/tasks', (req, res) => {
    // P0 takes no filter parameters at all.
    parseQuery(req.query as Record<string, unknown>, []);
    const boardId = assertUuidParam(pathParam(req.params.boardId));
    res.status(200).json({ data: deps.service.listTasks(boardId) });
  });

  router.post(
    '/boards/:boardId/tasks',
    ...writeRoute((req, res) => {
      parseQuery(req.query as Record<string, unknown>, []);
      const boardId = assertUuidParam(pathParam(req.params.boardId));
      const body = req.body as Record<string, unknown>;
      assertAllowedKeys(body, TASK_FIELDS);

      const parsed = parseTaskCreateInput(body);
      if (!parsed.ok) {
        throw new AppError(422, 'VALIDATION_ERROR', { fields: parsed.fields });
      }

      res.status(201).json({ data: deps.service.createTask(boardId, parsed.value) });
    }),
  );

  router.get('/boards/:boardId/tasks/:taskId', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    const boardId = assertUuidParam(pathParam(req.params.boardId));
    const taskId = assertUuidParam(pathParam(req.params.taskId));
    res.status(200).json({ data: deps.service.getTask(boardId, taskId) });
  });

  router.put(
    '/boards/:boardId/tasks/:taskId',
    ...writeRoute((req, res) => {
      parseQuery(req.query as Record<string, unknown>, []);
      const boardId = assertUuidParam(pathParam(req.params.boardId));
      const taskId = assertUuidParam(pathParam(req.params.taskId));
      const body = req.body as Record<string, unknown>;
      assertAllowedKeys(body, TASK_FIELDS);

      const parsed = parseTaskUpdateInput(body);
      if (!parsed.ok) {
        throw new AppError(422, 'VALIDATION_ERROR', { fields: parsed.fields });
      }

      res
        .status(200)
        .json({ data: deps.service.updateTask(boardId, taskId, parsed.value) });
    }),
  );

  router.delete(
    '/boards/:boardId/tasks/:taskId',
    // A JSON body is parsed and ignored: it must not influence the operation.
    ...writeRoute((req, res) => {
      parseQuery(req.query as Record<string, unknown>, []);
      const boardId = assertUuidParam(pathParam(req.params.boardId));
      const taskId = assertUuidParam(pathParam(req.params.taskId));

      deps.service.deleteTask(boardId, taskId);
      res.status(204).end();
    }),
  );

  return router;
}