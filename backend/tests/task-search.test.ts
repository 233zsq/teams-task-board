import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Task, TaskFieldInput } from '@team-plan/shared';
import { makeTestApp, type TestApp } from './helpers/test-app';
import { createApp } from '../src/app';
import { createMemoryLogger } from './helpers/logger';

describe('priority and parameterized project task search', () => {
  let ctx: TestApp;
  let agent: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  let csrf: string, cookie: string, boardId: string, mine: string, theirs: string;
  const rows: Task[] = [];
  const base = { description: '', dueDate: null, assigneeId: null, status: 'todo' };
  const url = () => `/api/v1/boards/${boardId}/tasks`;
  function post(input: Record<string, unknown>) {
    return agent.post(url()).set('X-CSRF-Token', csrf).send(input);
  }
  async function find(query: Record<string, string> = {}): Promise<Task[]> {
    return (await agent.get(url()).query(query).expect(200)).body.data;
  }
  const ids = (tasks: Task[]) => tasks.map((task) => task.id).sort();
  beforeAll(async () => {
    ctx = makeTestApp({ authentication: true, env: { ENABLE_PRIORITY: '1', ENABLE_FILTERS: '1' } });
    agent = request.agent(ctx.app); other = request.agent(ctx.app);
    const a = await agent.post('/api/v1/auth/register').send({ username: 'search_owner', displayName: '搜索负责人', password: 'Search-fixture-only-password' }).expect(201);
    const b = await other.post('/api/v1/auth/register').send({ username: 'search_member', displayName: '搜索成员', password: 'Search-fixture-only-password' }).expect(201);
    csrf = a.body.data.csrfToken; cookie = String(a.headers['set-cookie']?.[0]).split(';')[0]!;
    mine = a.body.data.user.id; theirs = b.body.data.user.id;
    boardId = (await agent.post('/api/v1/boards').set('X-CSRF-Token', csrf).send({ name: '搜索项目' }).expect(201)).body.data.id;
    await agent.post(`/api/v1/boards/${boardId}/members`).set('X-CSRF-Token', csrf).send({ username: 'search_member' }).expect(200);
    for (const task of [
      { title: 'Fix API 100%_匹配', description: '课程接口文档', priority: 'high', assigneeId: mine, dueDate: '2026-10-28' },
      { title: 'api review', description: '仅描述 ALPHA', priority: 'medium', assigneeId: theirs, dueDate: '2026-10-29' },
      { title: '其它', description: 'alpha 中文', priority: 'low', assigneeId: null, dueDate: null },
      { title: '汉字修订', description: '课程接口', priority: 'high', assigneeId: null, dueDate: '2026-10-30' },
      { title: '100xx匹配', priority: 'medium', assigneeId: theirs, dueDate: '2026-10-27' },
      { title: "引号 ' OR 1=1 --", priority: 'high', assigneeId: null, dueDate: '2026-10-28' },
    ]) rows.push((await post(task).expect(201)).body.data);
  });
  afterAll(() => ctx?.cleanup());

  it('returns priority on list/detail, defaults create and persists priority updates', async () => {
    const created = (await post({ title: '默认优先级' }).expect(201)).body.data as Task;
    expect(created.priority).toBe('medium');
    const updated = await agent.put(`${url()}/${created.id}`).set('X-CSRF-Token', csrf)
      .send({ ...base, title: created.title, priority: 'high' }).expect(200);
    expect(updated.body.data.priority).toBe('high');
    expect((await agent.get(`${url()}/${created.id}`).expect(200)).body.data.priority).toBe('high');
    expect(ctx.db.raw.prepare('SELECT priority FROM tasks WHERE id=?').get(created.id)).toEqual({ priority: 'high' });
    await agent.delete(`${url()}/${created.id}`).set('X-CSRF-Token', csrf).expect(204);
  });
  it('rejects invalid priorities and missing priority on full PUT without modifying data', async () => {
    for (const priority of ['urgent', null, 3]) await post({ title: '拒绝非法值', priority }).expect(422);
    await agent.put(`${url()}/${rows[0]!.id}`).set('X-CSRF-Token', csrf).send({ ...base, title: '不应保存' }).expect(422);
    expect((await find()).length).toBe(6);
    expect((await agent.get(`${url()}/${rows[0]!.id}`).expect(200)).body.data.title).toBe(rows[0]!.title);
  });
  it('searches title and description case-insensitively for ASCII and matches Chinese text', async () => {
    expect(ids(await find({ q: 'API' }))).toEqual(ids(rows.slice(0, 2)));
    expect(ids(await find({ q: 'alpha' }))).toEqual(ids(rows.slice(1, 3)));
    expect(ids(await find({ q: '课程接口' }))).toEqual(ids([rows[0]!, rows[3]!]));
    expect(ids(await find({ q: '   ' }))).toEqual(ids(rows));
  });
  it('treats SQL and wildcard-shaped keywords as literal text', async () => {
    expect(ids(await find({ q: '100%_' }))).toEqual([rows[0]!.id]);
    expect(ids(await find({ q: "' OR 1=1 --" }))).toEqual([rows[5]!.id]);
    expect(await find({ q: '%anything%' })).toEqual([]);
  });
  it('combines assignee, priority, dates and keyword with AND and inclusive endpoints', async () => {
    expect(ids(await find({ q: 'api', assigneeId: mine, priority: 'high', dueFrom: '2026-10-28', dueTo: '2026-10-28' }))).toEqual([rows[0]!.id]);
    expect(ids(await find({ dueFrom: '2026-10-28', dueTo: '2026-10-29' }))).toEqual(ids([rows[0]!, rows[1]!, rows[5]!]));
    expect(ids(await find({ dueTo: '2026-10-27' }))).toEqual([rows[4]!.id]);
    expect(ids(await find({ dueFrom: '2026-10-30' }))).toEqual([rows[3]!.id]);
    expect(ids(await find({ assigneeId: 'unassigned', priority: 'low' }))).toEqual([rows[2]!.id]);
    expect(await find({ assigneeId: 'unassigned', priority: 'low', dueFrom: '0001-01-01' })).toEqual([]);
  });
  it('distinguishes invalid values, unknown/repeated parameters and queries on non-list routes', async () => {
    for (const query of [{ priority: 'urgent' }, { assigneeId: 'no-id' }, { dueFrom: '2026-02-29' }, { dueTo: '0000-01-01' }, { dueFrom: '2026-10-30', dueTo: '2026-10-28' }, { q: 'a'.repeat(101) }]) {
      await agent.get(url()).query(query).expect(422);
    }
    await agent.get(url() + '?priority=low&priority=high').expect(400);
    await agent.get(url()).query({ sort: 'high' }).expect(400);
    await agent.get(`${url()}/${rows[0]!.id}?q=api`).expect(400);
    await agent.get(`/api/v1/boards/${boardId}/activity?q=api`).expect(400);
  });
  it('keeps membership authorization ahead of query validation and rejects foreign assignees', async () => {
    const outside = request.agent(ctx.app);
    const c = (await outside.post('/api/v1/auth/register').send({ username: 'search_outside', displayName: '外部成员', password: 'Search-fixture-only-password' }).expect(201)).body.data.user;
    await request(ctx.app).get(url()).query({ q: 'api' }).expect(401);
    await outside.get(url()).query({ q: 'a'.repeat(101), priority: 'urgent' }).expect(404);
    await agent.get(url()).query({ assigneeId: c.id }).expect(422);
    const foreignBoard = (await outside.post('/api/v1/boards').set('X-CSRF-Token', (await outside.get('/api/v1/auth/me')).body.data.csrfToken).send({ name: '外部项目' }).expect(201)).body.data;
    await agent.get(`/api/v1/boards/${foreignBoard.id}/tasks?q=api`).expect(404);
  });
  it('supports feature-off compatibility without resetting stored priority', async () => {
    const app = createApp({ config: { ...ctx.config, features: { ...ctx.config.features, priority: false, filters: false } }, db: ctx.db, logger: createMemoryLogger().logger });
    const found = await request(app).get(`${url()}/${rows[0]!.id}`).set('Cookie', cookie).expect(200);
    expect(found.body.data).not.toHaveProperty('priority');
    await request(app).get(url() + '?q=api').set('Cookie', cookie).expect(400);
    const input: TaskFieldInput = { ...base, title: rows[0]!.title, description: rows[0]!.description, dueDate: rows[0]!.dueDate, assigneeId: mine, status: 'doing' };
    await request(app).put(`${url()}/${rows[0]!.id}`).set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ ...input, priority: 'low' }).expect(400);
    await request(app).put(`${url()}/${rows[0]!.id}`).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(input).expect(200);
    expect(ctx.db.raw.prepare('SELECT priority FROM tasks WHERE id=?').get(rows[0]!.id)).toEqual({ priority: 'high' });
  });
  it('supports priority alone while keeping query filters disabled', async () => {
    const app = createApp({ config: { ...ctx.config, features: { ...ctx.config.features, priority: true, filters: false } }, db: ctx.db, logger: createMemoryLogger().logger });
    const found = await request(app).get(`${url()}/${rows[0]!.id}`).set('Cookie', cookie).expect(200);
    expect(found.body.data.priority).toBe('high');
    await request(app).get(url() + '?priority=high').set('Cookie', cookie).expect(400);
    const created = await request(app).post(url()).set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ title: '仅优先级模式', priority: 'low' }).expect(201);
    expect(created.body.data.priority).toBe('low');
    await request(app).delete(`${url()}/${created.body.data.id}`).set('Cookie', cookie).set('X-CSRF-Token', csrf).expect(204);
  });
});
