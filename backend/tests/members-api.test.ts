import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers/test-app';
import { SEED_MEMBER_IDS } from './helpers/determinism';

describe('GET /api/v1/members', () => {
  let ctx: TestApp;

  beforeEach(() => {
    ctx = makeTestApp();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns exactly the four seeded members in seed order', async () => {
    const response = await request(ctx.app).get('/api/v1/members');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [
        { id: SEED_MEMBER_IDS[0], displayName: '成员 A' },
        { id: SEED_MEMBER_IDS[1], displayName: '成员 B' },
        { id: SEED_MEMBER_IDS[2], displayName: '成员 C' },
        { id: SEED_MEMBER_IDS[3], displayName: '成员 D' },
      ],
    });
  });

  it('exposes no authentication or management semantics', async () => {
    const response = await request(ctx.app).get('/api/v1/members');

    for (const member of response.body.data as Record<string, unknown>[]) {
      expect(Object.keys(member).sort()).toEqual(['displayName', 'id']);
    }
  });

  it('keeps the same IDs and order after repeated initialization', async () => {
    const before = await request(ctx.app).get('/api/v1/members');

    const { seedMembers } = await import('../src/db/seed');
    seedMembers(ctx.db.raw);
    seedMembers(ctx.db.raw);

    const after = await request(ctx.app).get('/api/v1/members');
    expect(after.body).toEqual(before.body);
  });

  it('sets the API baseline headers', async () => {
    const response = await request(ctx.app).get('/api/v1/members');

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('rejects unknown query parameters', async () => {
    const response = await request(ctx.app).get('/api/v1/members?role=admin');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('has no write route: POST is an unknown path', async () => {
    const response = await request(ctx.app).post('/api/v1/members').send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});