import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSequentialUuid, createTestClock } from './helpers/determinism';
import { makeTestApp, type TestApp } from './helpers/test-app';

describe('database unavailability', () => {
  let ctx: TestApp;

  beforeEach(() => {
    ctx = makeTestApp({ now: createTestClock(), generateId: createSequentialUuid() });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it(
    'maps a write-lock timeout to 503 without pretending the write succeeded',
    async () => {
      const locker = new Database(ctx.config.databasePath);
      locker.pragma('busy_timeout = 100');
      locker.exec('BEGIN IMMEDIATE');

      try {
        const response = await request(ctx.app)
          .post('/api/v1/boards')
          .send({ name: '锁等待测试' });

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: '服务暂不可用，请稍后重试',
          },
        });
      } finally {
        locker.exec('ROLLBACK');
        locker.close();
      }

      // After the lock is released the same request succeeds, and the failed
      // attempt left no partial row behind.
      const retry = await request(ctx.app).post('/api/v1/boards').send({ name: '锁等待测试' });
      expect(retry.status).toBe(201);

      const list = await request(ctx.app).get('/api/v1/boards');
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].name).toBe('锁等待测试');
    },
    20_000,
  );
});