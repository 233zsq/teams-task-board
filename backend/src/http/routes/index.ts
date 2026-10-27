import type { Express } from 'express';
import type { AppConfig } from '../../config';
import type { DatabaseHandle } from '../../db/connection';
import { createBoardService } from '../../modules/boards/service';
import { createMemberService } from '../../modules/members/service';
import { createTaskService } from '../../modules/tasks/service';
import { boardsRouter } from './boards';
import { healthRouter, type SchemaGuard } from './health';
import { membersRouter } from './members';
import { tasksRouter } from './tasks';
import { testOnlyRouter } from './test-only';

export interface ApiRuntime {
  now: () => Date;
  generateId: () => string;
}

export function registerRoutes(
  app: Express,
  config: AppConfig,
  db: DatabaseHandle,
  schema?: SchemaGuard,
  runtime: ApiRuntime = { now: () => new Date(), generateId: () => '' },
): void {
  const members = createMemberService({ db: db.raw });
  const boards = createBoardService({
    db: db.raw,
    now: runtime.now,
    generateId: runtime.generateId,
  });
  const tasks = createTaskService({
    db: db.raw,
    now: runtime.now,
    generateId: runtime.generateId,
  });

  app.use('/api/v1', healthRouter({ config, db, schema }));
  app.use('/api/v1', membersRouter({ service: members }));
  app.use('/api/v1', boardsRouter({ service: boards }));
  app.use('/api/v1', tasksRouter({ service: tasks }));

  if (config.env === 'test') {
    app.use('/api/v1', testOnlyRouter());
  }
}