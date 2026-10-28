import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { openDatabase, type DatabaseHandle } from '../../src/db/connection';
import { applyMigrations, assertSchemaCompatible } from '../../src/db/migrations';
import { seedMembers } from '../../src/db/seed';
import { createMemoryLogger, type LogRecord } from './logger';
import { createTempDatabase, type TempDatabase } from './temp-db';

export interface TestAppOptions {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  migrate?: boolean;
  migrationsDir?: string;
  now?: () => Date;
  generateId?: () => string;
  authentication?: boolean;
}

export interface TestApp {
  app: Express;
  config: AppConfig;
  db: DatabaseHandle;
  temp: TempDatabase;
  records: LogRecord[];
  migrationsDir: string;
  cleanup(): void;
}

export function makeTestApp(options: TestAppOptions = {}): TestApp {
  const temp = createTempDatabase();
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    DATABASE_PATH: temp.path,
    ALLOWED_HOSTS: '',
    ENABLE_PRIORITY: '0',
    ENABLE_FILTERS: '0',
    ENABLE_ORDERING: '0',
    ENABLE_SHARING: '0',
    ...options.env,
  };

  const migrationsDir = options.migrationsDir ?? path.resolve(process.cwd(), 'migrations');
  const migrate = options.migrate !== false;
  const config = loadConfig(env, options.projectRoot ?? process.cwd());
  const db = openDatabase(config.databasePath);

  if (migrate) {
    applyMigrations(db.raw, migrationsDir);
    seedMembers(db.raw);
  }

  const memory = createMemoryLogger();
  const app = createApp({
    authentication: options.authentication ?? false,
    config,
    db,
    logger: memory.logger,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.generateId === undefined ? {} : { generateId: options.generateId }),
    ...(migrate
      ? { schema: { assertCompatible: () => assertSchemaCompatible(db.raw, migrationsDir) } }
      : {}),
  });

  return {
    app,
    config,
    db,
    temp,
    records: memory.records,
    migrationsDir,
    cleanup(): void {
      try {
        db.close();
      } catch {
        // A test may have deliberately closed the handle.
      }
      temp.cleanup();
    },
  };
}
