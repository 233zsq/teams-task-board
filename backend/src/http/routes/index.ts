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
import { accountService } from '../../modules/accounts/service';
import { projectService } from '../../modules/projects/service';
import { accountsRouter, requireSession } from './accounts';
import { projectsRouter } from './projects';

export interface ApiRuntime {
  now: () => Date;
  generateId: () => string;
  authentication?: boolean;
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
  const projects = runtime.authentication !== false ? projectService(db.raw, runtime.now) : undefined;
  if (projects) {
    const accounts = accountService(db.raw, runtime.now);
    app.use('/api/v1', accountsRouter(accounts, config));
    const guard = requireSession(accounts);
    app.use('/api/v1', (req, res, next) => {
      if (/^\/(boards|members)(\/|$)/.test(req.path)) guard(req, res, next);
      else next();
    });
    app.use('/api/v1', projectsRouter(projects));
  }
  app.use('/api/v1', membersRouter({ service: members, projects }));
  app.use('/api/v1', boardsRouter({ service: boards, projects, db: db.raw }));
  app.use('/api/v1', tasksRouter({ service: tasks, projects, db: db.raw }));

  if (config.env === 'test') {
    app.use('/api/v1', testOnlyRouter());
  }
}
