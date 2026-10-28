import { Router } from 'express';
import { parseTaskCreateInput, parseTaskUpdateInput, parseTaskFilters } from '@team-plan/shared';
import type { FeatureFlags } from '../../config';
import { memberExists } from '../../db/members';
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
  features: FeatureFlags;
}

const TASK_FIELDS = ['title', 'description', 'dueDate', 'assigneeId', 'status'] as const;

/** Task routes: every single-task operation is scoped to boardId + taskId. */
export function tasksRouter(deps: TasksRouterDeps): Router {
  const router = Router();

  router.get('/boards/:boardId/tasks', (req, res) => {
    const query = parseQuery(req.query as Record<string, unknown>, deps.features.filters ? ['q', 'assigneeId', 'priority', 'dueFrom', 'dueTo'] : []);
    const boardId = assertUuidParam(pathParam(req.params.boardId));
    const filters = parseTaskFilters(query);
    if (!filters.ok) throw new AppError(422, 'VALIDATION_ERROR', { fields: filters.fields });
    const assigneeId = filters.value.assigneeId;
    if (assigneeId && assigneeId !== 'unassigned' && (deps.projects
      ? !deps.projects.assignable(boardId).some((member) => member.id === assigneeId)
      : !memberExists(deps.db, assigneeId))) {
      throw new AppError(422, 'VALIDATION_ERROR', { fields: { assigneeId: '请选择当前项目成员' } });
    }
    const tasks = deps.service.listTasks(boardId, filters.value);
    res.status(200).json({ data: deps.projects ? tasks.map((task) => deps.projects!.task(task)) : tasks });
  });

  router.post(
    '/boards/:boardId/tasks',
    ...writeRoute((req, res) => {
      parseQuery(req.query as Record<string, unknown>, []);
      const boardId = assertUuidParam(pathParam(req.params.boardId));
      const body = req.body as Record<string, unknown>;
      assertAllowedKeys(body, deps.features.priority ? [...TASK_FIELDS, 'priority'] : TASK_FIELDS);

      const parsed = parseTaskCreateInput(body, deps.features.priority);
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
      assertAllowedKeys(body, deps.features.priority ? [...TASK_FIELDS, 'priority'] : TASK_FIELDS);

      const parsed = parseTaskUpdateInput(body, deps.features.priority);
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
