import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Board, Member, Task } from '@team-plan/shared';
import { createApp } from '../src/app';
import { openDatabase, type DatabaseHandle } from '../src/db/connection';
import { initializeDatabase } from '../src/db/initialize';
import { assertSchemaCompatible } from '../src/db/migrations';
import { createMemoryLogger } from './helpers/logger';
import { makeTestApp, type TestApp } from './helpers/test-app';

/** S1 acceptance: read the same HTTP DTOs through a fresh connection/app. */
describe('S1 persistence through application recreation', () => {
  let ctx: TestApp;
  let reopened: DatabaseHandle | undefined;

  beforeEach(() => { ctx = makeTestApp(); });
  afterEach(() => { reopened?.close(); reopened = undefined; ctx.cleanup(); });

  function restartAndInitializeTwice(): Express {
    ctx.db.close();
    for (let i = 0; i < 2; i++) {
      const result = initializeDatabase({ databasePath: ctx.temp.path, migrationsDir: ctx.migrationsDir });
      expect(result.applied).toEqual([]);
      expect(result.memberCount).toBe(4);
    }
    reopened = openDatabase(ctx.temp.path);
    const active = reopened;
    return createApp({
      config: ctx.config, db: active, logger: createMemoryLogger().logger,
      schema: { assertCompatible: () => assertSchemaCompatible(active.raw, ctx.migrationsDir) },
    });
  }

  it('preserves boards, all five task fields, timestamps, member IDs and board isolation', async () => {
    const membersResponse = await request(ctx.app).get('/api/v1/members').expect(200);
    const members = membersResponse.body.data as Member[];
    const board = (await request(ctx.app).post('/api/v1/boards').send({ name: '  S1 持久化验收  ' }).expect(201)).body.data as Board;
    const other = (await request(ctx.app).post('/api/v1/boards').send({ name: 'S1 持久化验收' }).expect(201)).body.data as Board;
    expect(board.name).toBe(other.name);
    expect(board.id).not.toBe(other.id);
    for (const [index, status] of ['todo', 'doing', 'done'].entries()) {
      await request(ctx.app).post(`/api/v1/boards/${board.id}/tasks`).send({
        title: `验收任务 ${index + 1}`, description: '第一行\n<script>只作为文字存储</script>',
        dueDate: '2000-02-29', assigneeId: members[index]!.id, status,
      }).expect(201);
    }
    const minimal = (await request(ctx.app).post(`/api/v1/boards/${board.id}/tasks`).send({ title: '仅标题任务' }).expect(201)).body.data as Task;
    expect(minimal).toMatchObject({ description: '', dueDate: null, assigneeId: null, status: 'todo' });
    const before = (await request(ctx.app).get(`/api/v1/boards/${board.id}/tasks`).expect(200)).body;
    expect(before.data).toHaveLength(4);
    const boardListBefore = (await request(ctx.app).get('/api/v1/boards').expect(200)).body;

    const app = restartAndInitializeTwice();
    await request(app).get('/api/v1/health').expect(200);
    expect((await request(app).get('/api/v1/members').expect(200)).body).toEqual(membersResponse.body);
    expect((await request(app).get('/api/v1/boards').expect(200)).body).toEqual(boardListBefore);
    expect((await request(app).get(`/api/v1/boards/${board.id}`).expect(200)).body.data).toEqual(board);
    expect((await request(app).get(`/api/v1/boards/${board.id}/tasks`).expect(200)).body).toEqual(before);
    for (const task of before.data as Task[]) {
      expect((await request(app).get(`/api/v1/boards/${board.id}/tasks/${task.id}`).expect(200)).body.data).toEqual(task);
      await request(app).get(`/api/v1/boards/${other.id}/tasks/${task.id}`).expect(404);
    }
    expect((await request(app).get(`/api/v1/boards/${other.id}/tasks`).expect(200)).body).toEqual({ data: [] });
  });

  it('keeps rejected creation out of the database after a new app reads it', async () => {
    const board = (await request(ctx.app).post('/api/v1/boards').send({ name: '校验失败持久化边界' }).expect(201)).body.data as Board;
    for (const input of [{ dueDate: '1900-02-29' }, { assigneeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { status: 'Doing' }]) {
      await request(ctx.app).post(`/api/v1/boards/${board.id}/tasks`).send({ title: '不得落库', ...input }).expect(422);
    }
    await request(ctx.app).post(`/api/v1/boards/${board.id}/tasks`).send({ title: '不得改归属', boardId: board.id }).expect(400);
    const app = restartAndInitializeTwice();
    expect((await request(app).get(`/api/v1/boards/${board.id}/tasks`).expect(200)).body).toEqual({ data: [] });
  });
});
