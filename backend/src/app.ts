import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import type { AppConfig } from './config';
import type { DatabaseHandle } from './db/connection';
import type { Logger } from './http/logger';
import { errorHandler } from './http/middleware/error-handler';
import { hostGuard } from './http/middleware/host-guard';
import { apiNotFound } from './http/middleware/not-found';
import { requestLog } from './http/middleware/request-log';
import { securityHeaders } from './http/middleware/security-headers';
import { registerRoutes, type ApiRuntime } from './http/routes';
import type { SchemaGuard } from './http/routes/health';
import { serveFrontendBuild } from './http/static';

const FRONTEND_DIST = path.resolve(__dirname, '..', '..', 'frontend', 'dist');

export interface AppDependencies {
  config: AppConfig;
  db: DatabaseHandle;
  logger: Logger;
  schema?: SchemaGuard;
  /** Injected so tests can drive deterministic timestamps. */
  now?: () => Date;
  /** Injected so tests can drive deterministic IDs. */
  generateId?: () => string;
  /** Legacy P0 contract fixtures only; production cannot disable authentication. */
  authentication?: boolean;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('trust proxy', 'loopback');
  if (deps.authentication === false && deps.config.env !== 'test') {
    throw new Error('仅测试环境可运行历史匿名契约夹具');
  }

  app.use(securityHeaders());
  app.use(requestLog(deps.logger));
  app.use(hostGuard(deps.config.allowedHosts));

  const runtime: ApiRuntime = {
    now: deps.now ?? (() => new Date()),
    generateId: deps.generateId ?? (() => randomUUID()),
    authentication: deps.authentication !== false,
  };
  registerRoutes(app, deps.config, deps.db, deps.schema, runtime);

  // Unknown /api paths and methods stay JSON 404, also in the build demo.
  app.use('/api', apiNotFound());

  if (deps.config.env === 'production') {
    serveFrontendBuild(app, { directory: FRONTEND_DIST });
  }

  app.use(errorHandler(deps.logger));

  return app;
}
