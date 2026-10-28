import { Router } from 'express';
import { parseTaskCreateInput, parseTaskUpdateInput } from '@team-plan/shared';
import type { TaskService } from '../../modules/tasks/service';
import { AppError } from '../errors';
import { writeRoute } from '../middleware/json-body';
import { assertAllowedKeys, assertUuidParam, parseQuery, pathParam } from '../validation';
import type Database from 'better-sqlite3';
import type { ProjectService } from '../../modules/projects/service';
import { currentUser } from './accounts';

export interface TasksRouterDeps {
  service: TaskService;
  projects?: ProjectService;
  db: Database.Database;
}

const TASK_FIELDS = ['title', 'description', 'dueDate', 'assigneeId', 'status'] as const;

/** Task routes: every single-task operation is scoped to boardId + taskId. */
export function tasksRouter(deps: TasksRouterDeps): Router {
  const router = Router();

  router.get('/boards/:boardId/tasks', (req, res) => {
    // P0 takes no filter parameters at all.
    parseQuery(req.query as Record<string, unknown>, []);
    const boardId = assertUuidParam(pathParam(req.params.boardId));
    const tasks = deps.service.listTasks(boardId);
    res.status(200).json({ data: deps.projects ? tasks.map((task) => deps.projects!.task(task)) : tasks });
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

      const task = deps.db.transaction(() => {
        deps.projects?.assignee(boardId, parsed.value.assigneeId);
        const created = deps.service.createTask(boardId, parsed.value);
        if (deps.projects) deps.projects.attachTask(created, currentUser(res).id);
        return created;
      })();
      res.status(201).json({ data: deps.projects ? deps.projects.task(task) : task });
    }),
  );

  router.get('/boards/:boardId/tasks/:taskId', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    const boardId = assertUuidParam(pathParam(req.params.boardId));
    const taskId = assertUuidParam(pathParam(req.params.taskId));
    const task = deps.service.getTask(boardId, taskId);
    res.status(200).json({ data: deps.projects ? deps.projects.task(task) : task });
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

      const task = deps.db.transaction(() => {
        const existing = deps.service.getTask(boardId, taskId);
        deps.projects?.assignee(boardId, parsed.value.assigneeId, existing.assigneeId);
        const updated = deps.service.updateTask(boardId, taskId, parsed.value);
        deps.projects?.log(boardId, currentUser(res).id, 'task.updated', updated.title);
        return updated;
      })();
      res.status(200).json({ data: deps.projects ? deps.projects.task(task) : task });
    }),
  );

  router.delete(
    '/boards/:boardId/tasks/:taskId',
    // A JSON body is parsed and ignored: it must not influence the operation.
    ...writeRoute((req, res) => {
      parseQuery(req.query as Record<string, unknown>, []);
      const boardId = assertUuidParam(pathParam(req.params.boardId));
      const taskId = assertUuidParam(pathParam(req.params.taskId));

      deps.db.transaction(() => {
        const task = deps.service.getTask(boardId, taskId);
        deps.service.deleteTask(boardId, taskId);
        deps.projects?.log(boardId, currentUser(res).id, 'task.deleted', task.title);
      })();
      res.status(204).end();
    }),
  );

  return router;
}
