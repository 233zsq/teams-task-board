import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SEED_MEMBER_IDS,
  createSequentialUuid,
  createTestClock,
} from './helpers/determinism';
import { makeTestApp, type TestApp } from './helpers/test-app';

describe('business route security boundaries', () => {
  let ctx: TestApp;
  let boardId: string;

  beforeEach(async () => {
    ctx = makeTestApp({ now: createTestClock(), generateId: createSequentialUuid() });
    const created = await request(ctx.app).post('/api/v1/boards').send({ name: '课程作业' });
    boardId = created.body.data.id as string;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('rejects a Host outside the allowlist with 403 before touching business data', async () => {
    const response = await request(ctx.app)
      .get('/api/v1/boards')
      .set('Host', 'evil.example');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('sets the baseline security headers on business responses', async () => {
    const responses = [
      await request(ctx.app).get('/api/v1/boards'),
      await request(ctx.app).get('/api/v1/members'),
      await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`),
    ];

    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('enforces 32 KiB on a real task write and creates nothing', async () => {
    const response = await request(ctx.app)
      .post(`/api/v1/boards/${boardId}/tasks`)
      .send({ title: '任务', description: 'x'.repeat(33 * 1024) });

    expect(response.status).toBe(413);

    const list = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`);
    expect(list.body.data).toEqual([]);
  });

  it('keeps unknown API paths JSON with Connection: close when a body is present', async () => {
    const response = await request(ctx.app)
      .post('/api/v1/not-a-route')
      .send({ payload: 'x'.repeat(33 * 1024) });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.headers.connection).toBe('close');
  });

  it('returns 400 for protected fields, never silently ignoring them', async () => {
    const cases = [
      { title: '任务', id: '33333333-3333-4333-8333-000000000001' },
      { title: '任务', boardId: '22222222-2222-4222-8222-222222222222' },
      { title: '任务', createdAt: '2026-10-20T02:00:00.000Z' },
      { title: '任务', updatedAt: '2026-10-20T02:00:00.000Z' },
      { title: '任务', sortOrder: 0 },
    ];

    for (const body of cases) {
      const response = await request(ctx.app)
        .post(`/api/v1/boards/${boardId}/tasks`)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    }
  });

  it('accepts only real UUID path segments for private routes', async () => {
    const malformedBoard = await request(ctx.app).get('/api/v1/boards/123');
    expect(malformedBoard.status).toBe(400);

    const malformedTask = await request(ctx.app).get(
      `/api/v1/boards/${boardId}/tasks/123`,
    );
    expect(malformedTask.status).toBe(400);
  });

  it('never echoes user input in validation messages', async () => {
    const marker = '<script>alert("leak")</script>';
    const response = await request(ctx.app)
      .post(`/api/v1/boards/${boardId}/tasks`)
      .send({ title: marker.repeat(20) });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).not.toContain('script');
  });

  it('treats SQL-injection-shaped text as plain data', async () => {
    const response = await request(ctx.app)
      .post(`/api/v1/boards/${boardId}/tasks`)
      .send({ title: "' OR 1=1 --" });

    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe("' OR 1=1 --");

    const list = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`);
    expect(list.body.data).toHaveLength(1);
  });

  it('keeps a three-member full PUT intact and does not accept a board move', async () => {
    const created = await request(ctx.app)
      .post(`/api/v1/boards/${boardId}/tasks`)
      .send({ title: '任务', assigneeId: SEED_MEMBER_IDS[0] });
    const taskId = created.body.data.id as string;

    const moved = await request(ctx.app)
      .put(`/api/v1/boards/${boardId}/tasks/${taskId}`)
      .send({
        title: '任务',
        description: '',
        dueDate: null,
        assigneeId: SEED_MEMBER_IDS[3],
        status: 'done',
        boardId: '22222222-2222-4222-8222-222222222222',
      });

    expect(moved.status).toBe(400);
    const reread = await request(ctx.app).get(
      `/api/v1/boards/${boardId}/tasks/${taskId}`,
    );
    expect(reread.body.data.assigneeId).toBe(SEED_MEMBER_IDS[0]);
    expect(reread.body.data.status).toBe('todo');
  });
});