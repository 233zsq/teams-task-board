import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers/test-app';
import { openDatabase } from '../src/db/connection';
import { initializeDatabase } from '../src/db/initialize';
import { createBoardService } from '../src/business/boards';

const MISSING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('S1 real API and SQLite', () => {
  let ctx: TestApp;
  beforeEach(() => { ctx = makeTestApp(); });
  afterEach(() => ctx.cleanup());
  const postBoard = (name = '课程作业') => request(ctx.app).post('/api/v1/boards').send({ name });
  async function boardId() { return (await postBoard()).body.data.id as string; }

  it('creates distinct same-name boards, normalizes names, and lists by createdAt/id', async () => {
    expect((await request(ctx.app).get('/api/v1/boards')).body).toEqual({ data: [] });
    const a = await postBoard('  课程作业  '), b = await postBoard();
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(a.body.data.name).toBe('课程作业'); expect(a.body.data.id).not.toBe(b.body.data.id);
    expect(Object.keys(a.body.data).sort()).toEqual(['createdAt', 'id', 'name']);
    expect((await request(ctx.app).get(`/api/v1/boards/${a.body.data.id}`)).body).toEqual(a.body);
    const list = (await request(ctx.app).get('/api/v1/boards')).body.data;
    expect(list).toEqual([a.body.data, b.body.data].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id)));
    expect(a.headers['cache-control']).toBe('no-store');
  });
  it.each(['', '   ', 'x'.repeat(51), 'a\n', '\u200btext', '\ufefftext', 'a\u202e', null, 22])('rejects invalid board name %j without inserting', async name => {
    const result = await request(ctx.app).post('/api/v1/boards').send({ name });
    expect(result.status).toBe(422); expect(result.body.error.fields.name).toBeTruthy();
    expect(ctx.db.raw.prepare('SELECT count(*) AS n FROM boards').get()).toEqual({ n: 0 });
  });
  it('counts Unicode code points and permits ZWJ', async () => {
    expect((await postBoard('😀'.repeat(50))).status).toBe(201);
    expect((await postBoard('👩‍💻任务')).status).toBe(201);
    expect((await postBoard('😀'.repeat(51))).status).toBe(422);
  });
  it('returns fixed members, initializes repeatedly without erasing business data, and survives reopen', async () => {
    const members = (await request(ctx.app).get('/api/v1/members')).body.data;
    expect(members.map((m: { displayName: string }) => m.displayName)).toEqual(['成员 A', '成员 B', '成员 C', '成员 D']);
    const id = await boardId();
    const task = (await request(ctx.app).post(`/api/v1/boards/${id}/tasks`).send({ title: '持久化证据' })).body.data;
    ctx.db.close();
    for (let i = 0; i < 2; i++) initializeDatabase({ databasePath: ctx.temp.path, migrationsDir: ctx.migrationsDir });
    const reopened = openDatabase(ctx.temp.path);
    try {
      const service = createBoardService(reopened);
      expect(service.listMembers()).toEqual(members);
      expect(service.getTask(id, task.id)).toEqual(task);
      expect(service.listBoards()).toHaveLength(1);
      expect(service.listTasks(id)).toHaveLength(1);
    } finally { reopened.close(); }
  });
  it('creates full and minimal tasks, reads exact DTOs, isolates boards and sorts stable ties', async () => {
    const id = await boardId(), second = await boardId();
    const member = (await request(ctx.app).get('/api/v1/members')).body.data[0].id;
    const full = await request(ctx.app).post(`/api/v1/boards/${id}/tasks`).send({ title: '  联调  ', description: '第一行\n第二行', assigneeId: member, dueDate: '2028-02-29', status: 'doing' });
    const minimal = await request(ctx.app).post(`/api/v1/boards/${id}/tasks`).send({ title: '默认值' });
    expect(full.status).toBe(201); expect(minimal.status).toBe(201);
    expect(full.body.data).toMatchObject({ boardId: id, title: '联调', description: '第一行\n第二行', assigneeId: member, dueDate: '2028-02-29', status: 'doing' });
    expect(minimal.body.data).toMatchObject({ description: '', assigneeId: null, dueDate: null, status: 'todo' });
    expect(full.body.data.updatedAt).toBe(full.body.data.createdAt);
    expect((await request(ctx.app).get(`/api/v1/boards/${id}/tasks/${full.body.data.id}`)).body).toEqual(full.body);
    expect((await request(ctx.app).get(`/api/v1/boards/${second}/tasks/${full.body.data.id}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/v1/boards/${second}/tasks`)).body).toEqual({ data: [] });
    ctx.db.raw.prepare('UPDATE tasks SET created_at = ?').run('2026-10-27T00:00:00.000Z');
    const list = (await request(ctx.app).get(`/api/v1/boards/${id}/tasks`)).body.data;
    expect(list.map((t: { id: string }) => t.id)).toEqual([full.body.data.id, minimal.body.data.id].sort());
  });
  it.each([
    {}, { title: '  ' }, { title: 'x'.repeat(101) }, { title: 'a\u0000' }, { title: 'a\u200b' },
    { description: null }, { description: 'x'.repeat(2001) }, { description: '\u202e' },
    { dueDate: '2026-02-29' }, { dueDate: '1900-02-29' }, { dueDate: '0000-01-01' }, { dueDate: '2026-2-3' }, { dueDate: '' },
    { assigneeId: MISSING }, { assigneeId: 42 }, { status: 'Doing' }, { status: null },
  ])('validates task input %j', async invalid => {
    const id = await boardId();
    const input = Object.keys(invalid).length === 0 ? {} : { title: '任务', ...invalid };
    const response = await request(ctx.app).post(`/api/v1/boards/${id}/tasks`).send(input);
    expect(response.status).toBe(422); expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(ctx.db.raw.prepare('SELECT count(*) AS n FROM tasks').get()).toEqual({ n: 0 });
  });
  it.each(['0001-01-01', '0099-12-31', '2000-02-29', '9999-12-31'])('accepts exact calendar date %s without timezone conversion', async dueDate => {
    const id = await boardId();
    const result = await request(ctx.app).post(`/api/v1/boards/${id}/tasks`).send({ title: '😀'.repeat(100), dueDate });
    expect(result.status).toBe(201); expect(result.body.data.dueDate).toBe(dueDate);
  });
  it('treats HTML and SQL payloads as text', async () => {
    const id = await boardId();
    const title = "' OR 1=1 --", description = '<script>alert(1)</script>';
    const result = await request(ctx.app).post(`/api/v1/boards/${id}/tasks`).send({ title, description });
    expect(result.status).toBe(201); expect(result.body.data).toMatchObject({ title, description });
    expect(ctx.db.raw.prepare('SELECT count(*) AS n FROM boards').get()).toEqual({ n: 1 });
  });
  it('returns 400 for invalid paths and queries, 404 for absent resources', async () => {
    const id = await boardId();
    for (const path of ['/boards/bad', '/boards?x=1', '/members?x=1&x=2', `/boards/${id}/tasks?status=todo`, `/boards/${id}/tasks/bad`]) {
      expect((await request(ctx.app).get(`/api/v1${path}`)).status).toBe(400);
    }
    for (const path of [`/boards/${MISSING}`, `/boards/${MISSING}/tasks`, `/boards/${id}/tasks/${MISSING}`]) {
      expect((await request(ctx.app).get(`/api/v1${path}`)).status).toBe(404);
    }
    expect((await request(ctx.app).post(`/api/v1/boards/${MISSING}/tasks`).send({ title: '任务' })).status).toBe(404);
  });
  it('keeps both new write routes behind all request guards', async () => {
    const id = await boardId();
    for (const path of ['/api/v1/boards', `/api/v1/boards/${id}/tasks`]) {
      expect((await request(ctx.app).post(path).type('text').send('x')).status).toBe(415);
      expect((await request(ctx.app).post(path).type('json').send('x'.repeat(32769))).status).toBe(413);
      expect((await request(ctx.app).post(path).type('json').send('{')).status).toBe(400);
      expect((await request(ctx.app).post(path).type('json').send('null')).status).toBe(400);
      expect((await request(ctx.app).post(path).send({ id: MISSING })).status).toBe(400);
      expect((await request(ctx.app).post(path).type('json').send('{"__proto__":{}}')).status).toBe(400);
      expect((await request(ctx.app).post(path)).status).toBe(422);
      expect((await request(ctx.app).post(path).set('Host', 'evil.example').send({})).status).toBe(403);
    }
  });
  it('rolls back failed creation and hides SQL errors', async () => {
    const id = await boardId();
    ctx.db.raw.exec("CREATE TRIGGER fail_task AFTER INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'private-database-detail'); END");
    const response = await request(ctx.app).post(`/api/v1/boards/${id}/tasks`).send({ title: '不能部分落库' });
    expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain('private-database-detail');
    expect(ctx.db.raw.prepare('SELECT count(*) AS n FROM tasks').get()).toEqual({ n: 0 });
  });
});
