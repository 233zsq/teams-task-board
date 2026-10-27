import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers/test-app';
import { createSequentialUuid, createTestClock } from './helpers/determinism';

describe('board API', () => {
  let ctx: TestApp;

  beforeEach(() => {
    ctx = makeTestApp({ now: createTestClock(), generateId: createSequentialUuid() });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  async function createBoard(name: unknown): Promise<request.Response> {
    return request(ctx.app).post('/api/v1/boards').send({ name });
  }

  it('creates a board with a server-generated id and timestamp', async () => {
    const response = await createBoard('  课程作业  ');

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      id: '33333333-3333-4333-8333-000000000001',
      name: '课程作业',
      createdAt: '2026-10-20T02:00:00.000Z',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('lists boards by createdAt then id, ascending', async () => {
    const first = await createBoard('答辩准备');
    const second = await createBoard('课程作业');
    const third = await createBoard('课程作业');

    const response = await request(ctx.app).get('/api/v1/boards');

    expect(response.status).toBe(200);
    expect(response.body.data.map((board: { id: string }) => board.id)).toEqual([
      first.body.data.id,
      second.body.data.id,
      third.body.data.id,
    ]);
  });

  it('returns an empty list on an empty database', async () => {
    const response = await request(ctx.app).get('/api/v1/boards');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [] });
  });

  it('allows duplicate names with different ids', async () => {
    const first = await createBoard('课程作业');
    const second = await createBoard('课程作业');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it('accepts a 50-character name and rejects 51 characters', async () => {
    const ok = await createBoard('名'.repeat(50));
    expect(ok.status).toBe(201);

    const tooLong = await createBoard('名'.repeat(51));
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '请检查输入内容',
      fields: { name: '看板名称不能超过 50 个字符' },
    });
  });

  it('rejects empty, whitespace-only and non-string names', async () => {
    for (const bad of ['', '   ', ' \u3000 ', null, 42, ['x']]) {
      const response = await createBoard(bad);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects unknown and protected fields in the body', async () => {
    for (const body of [
      { name: '看板', extra: 1 },
      { name: '看板', id: '22222222-2222-4222-8222-222222222222' },
      { name: '看板', createdAt: '2026-10-20T02:00:00.000Z' },
    ]) {
      const response = await request(ctx.app).post('/api/v1/boards').send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    }
  });

  it('rejects prototype-polluting keys', async () => {
    for (const raw of [
      '{"name":"看板","__proto__":{"polluted":true}}',
      '{"name":"看板","constructor":{"x":1}}',
      '{"name":"看板","prototype":{"x":1}}',
    ]) {
      const response = await request(ctx.app)
        .post('/api/v1/boards')
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(response.status).toBe(400);
    }

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects non-object top-level JSON', async () => {
    for (const raw of ['[]', '"name"', 'null', '123']) {
      const response = await request(ctx.app)
        .post('/api/v1/boards')
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    }
  });

  it('returns 422 for an empty POST body (D-04) and never 415', async () => {
    const response = await request(ctx.app).post('/api/v1/boards');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-JSON body with 415', async () => {
    const response = await request(ctx.app)
      .post('/api/v1/boards')
      .set('Content-Type', 'text/plain')
      .send('name=看板');

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 413 above 32 KiB and does not create the board', async () => {
    const response = await request(ctx.app)
      .post('/api/v1/boards')
      .send({ name: 'x'.repeat(33 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    const list = await request(ctx.app).get('/api/v1/boards');
    expect(list.body.data).toEqual([]);
  });

  it('rejects unknown query parameters', async () => {
    const response = await request(ctx.app).get('/api/v1/boards?page=1');
    expect(response.status).toBe(400);
  });

  it('reads one board and separates 400 from 404', async () => {
    const created = await createBoard('课程作业');
    const boardId = created.body.data.id as string;

    const found = await request(ctx.app).get(`/api/v1/boards/${boardId}`);
    expect(found.status).toBe(200);
    expect(found.body.data.name).toBe('课程作业');

    const missing = await request(ctx.app).get(
      '/api/v1/boards/22222222-2222-4222-8222-222222222222',
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const malformed = await request(ctx.app).get('/api/v1/boards/not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('BAD_REQUEST');
  });

  it('keeps unknown methods on known paths as JSON 404', async () => {
    const response = await request(ctx.app).delete('/api/v1/boards');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});