import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createMemoryLogger } from './helpers/logger';
import { makeTestApp, type TestApp } from './helpers/test-app';
import type { AccountUser, Board, Task } from '@team-plan/shared';

describe('authenticated accounts and project collaboration', () => {
  let ctx: TestApp;
  const password = 'course-test-only-passphrase';
  type Client = { agent: ReturnType<typeof request.agent>; csrf: string; user: AccountUser; cookie: string };
  let alice: Client;
  let bob: Client;
  let outsider: Client;
  async function register(username: string, displayName: string): Promise<Client> {
    const agent = request.agent(ctx.app);
    const response = await agent.post('/api/v1/auth/register').send({ username, displayName, password }).expect(201);
    return { agent, csrf: response.body.data.csrfToken, user: response.body.data.user,
      cookie: String(response.headers['set-cookie']?.[0] ?? '').split(';')[0]! };
  }
  function call(client: Client, method: 'post' | 'put' | 'delete', path: string, body = {}) {
    return client.agent[method](`/api/v1${path}`).set('X-CSRF-Token', client.csrf).send(body);
  }
  async function board(client = alice): Promise<Board> {
    return (await call(client, 'post', '/boards', { name: '项目协作验证' }).expect(201)).body.data;
  }
  beforeAll(async () => {
    ctx = makeTestApp({ authentication: true });
    alice = await register('alice', '小林');
    bob = await register('bob', '小周');
    outsider = await register('outsider', '外部账号');
  });
  beforeEach(() => { ctx.db.raw.prepare('DELETE FROM auth_throttles').run(); });
  afterAll(() => ctx?.cleanup());

  it('stores salted passwords and session digests and restores only public account fields', async () => {
    const restored = (await alice.agent.get('/api/v1/auth/me').expect(200)).body.data;
    expect(restored.user).toEqual(alice.user);
    expect(restored.csrfToken).toBe(alice.csrf);
    expect(Object.keys(restored.user).sort()).toEqual(['createdAt', 'displayName', 'id', 'username']);
    const raw = ctx.db.raw.prepare('SELECT password_hash FROM users WHERE id = ?').get(alice.user.id) as { password_hash: string };
    expect(raw.password_hash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(raw.password_hash).not.toContain(password);
    const sessions = JSON.stringify(ctx.db.raw.prepare('SELECT * FROM sessions').all());
    expect(sessions).not.toContain(alice.cookie.split('=')[1]!);
    expect(JSON.stringify(ctx.records)).not.toContain(password);
    expect(JSON.stringify(ctx.records)).not.toContain(alice.csrf);
  });
  it('rejects duplicate normalized usernames, weak passwords and fabricated identity fields', async () => {
    await request(ctx.app).post('/api/v1/auth/register').send({ username: 'ALICE', displayName: '另一个人', password }).expect(409);
    await request(ctx.app).post('/api/v1/auth/register').send({ username: 'new_user', displayName: '新用户', password: 'short' }).expect(422);
    await request(ctx.app).post('/api/v1/auth/register').send({ username: 'new_user', displayName: '新用户', password, role: 'admin' }).expect(400);
    await request(ctx.app).post('/api/v1/auth/register').send({ username: 'new_user', displayName: '   ', password }).expect(422);
  });
  it('uses the same error for unknown account and wrong password, and accepts username case', async () => {
    const wrong = await request(ctx.app).post('/api/v1/auth/login').send({ username: 'alice', password: 'wrong' }).expect(401);
    const missing = await request(ctx.app).post('/api/v1/auth/login').send({ username: 'missing_user', password: 'wrong' }).expect(401);
    expect(wrong.body).toEqual(missing.body);
    const response = await request(ctx.app).post('/api/v1/auth/login').send({ username: 'ALICE', password }).expect(200);
    expect(response.body.data.user.id).toBe(alice.user.id);
  });
  it('blocks every anonymous business operation', async () => {
    await request(ctx.app).get('/api/v1/boards').expect(401);
    await request(ctx.app).get('/api/v1/members').expect(401);
    await request(ctx.app).post('/api/v1/boards').send({ name: '匿名写入' }).expect(401);
    expect((await request(ctx.app).get('/api/v1/auth/me').expect(200)).body.data.user).toBeNull();
  });
  it('requires CSRF tokens and rejects cross-origin and cross-site writes', async () => {
    await alice.agent.post('/api/v1/boards').send({ name: '缺少令牌' }).expect(403);
    await alice.agent.post('/api/v1/boards').set('X-CSRF-Token', bob.csrf).send({ name: '令牌不符' }).expect(403);
    await alice.agent.post('/api/v1/boards').set('X-CSRF-Token', alice.csrf).set('Origin', 'https://evil.example').send({ name: '跨源' }).expect(403);
    await alice.agent.post('/api/v1/boards').set('X-CSRF-Token', alice.csrf).set('Sec-Fetch-Site', 'cross-site').send({ name: '跨站' }).expect(403);
    await request(ctx.app).post('/api/v1/auth/login').set('Origin', 'https://evil.example').send({ username: 'alice', password }).expect(403);
  });
  it('isolates project lists, direct reads, tasks, members and activity by membership', async () => {
    const project = await board();
    expect(project.owner?.id).toBe(alice.user.id);
    expect(project.role).toBe('owner');
    expect(project.memberCount).toBe(1);
    const task = (await call(alice, 'post', `/boards/${project.id}/tasks`, { title: '仅项目内可见' }).expect(201)).body.data as Task;
    for (const suffix of ['', '/tasks', `/tasks/${task.id}`, '/members', '/activity']) {
      await outsider.agent.get(`/api/v1/boards/${project.id}${suffix}`).expect(404);
    }
    await call(outsider, 'put', `/boards/${project.id}/tasks/${task.id}`, { title: '越权', description: '', dueDate: null, assigneeId: null, status: 'todo' }).expect(404);
    await call(outsider, 'delete', `/boards/${project.id}/tasks/${task.id}`).expect(404);
    expect((await outsider.agent.get('/api/v1/boards').expect(200)).body.data).toEqual([]);
    expect((await outsider.agent.get(`/api/v1/members?boardId=${project.id}`).expect(404)).body.error.code).toBe('NOT_FOUND');
  });
  it('adds registered members idempotently and restricts member management to the owner', async () => {
    const project = await board();
    await call(alice, 'post', `/boards/${project.id}/members`, { username: 'not_registered' }).expect(422);
    await call(alice, 'post', `/boards/${project.id}/members`, { username: 'BOB' }).expect(200);
    await call(alice, 'post', `/boards/${project.id}/members`, { username: 'bob' }).expect(200);
    expect((await bob.agent.get(`/api/v1/boards/${project.id}`).expect(200)).body.data.role).toBe('member');
    expect((await bob.agent.get(`/api/v1/boards/${project.id}/members`).expect(200)).body.data).toHaveLength(2);
    await call(bob, 'post', `/boards/${project.id}/members`, { username: 'outsider' }).expect(403);
    await call(bob, 'delete', `/boards/${project.id}/members/${alice.user.id}`).expect(403);
    await call(bob, 'put', `/boards/${project.id}/owner`, { userId: bob.user.id }).expect(403);
    const events = (await alice.agent.get(`/api/v1/boards/${project.id}/activity`).expect(200)).body.data;
    expect(events.filter((event: { action: string }) => event.action === 'member.added')).toHaveLength(1);
  });
  it('assigns only project members and records an immutable publisher distinct from assignee', async () => {
    const project = await board();
    await call(alice, 'post', `/boards/${project.id}/members`, { username: 'bob' }).expect(200);
    await call(alice, 'post', `/boards/${project.id}/tasks`, { title: '非法负责人', assigneeId: outsider.user.id }).expect(422);
    const task = (await call(alice, 'post', `/boards/${project.id}/tasks`, { title: '双人协作', assigneeId: bob.user.id }).expect(201)).body.data as Task;
    expect(task.createdBy?.id).toBe(alice.user.id);
    expect(task.assigneeId).toBe(bob.user.id);
    await call(bob, 'put', `/boards/${project.id}/tasks/${task.id}`, { title: '继续推进', description: '', dueDate: null, assigneeId: bob.user.id, status: 'doing', createdBy: bob.user.id }).expect(400);
    const updated = (await call(bob, 'put', `/boards/${project.id}/tasks/${task.id}`, { title: '继续推进', description: '', dueDate: null, assigneeId: bob.user.id, status: 'doing' }).expect(200)).body.data as Task;
    expect(updated.createdBy?.id).toBe(alice.user.id);
    const row = ctx.db.raw.prepare('SELECT assignee_id, assigned_user_id, created_by FROM tasks WHERE id = ?').get(task.id);
    expect(row).toEqual({ assignee_id: null, assigned_user_id: bob.user.id, created_by: alice.user.id });
  });
  it('removes access immediately and clears task assignments, while retaining historical publisher', async () => {
    const project = await board();
    await call(alice, 'post', `/boards/${project.id}/members`, { username: 'bob' }).expect(200);
    const task = (await call(bob, 'post', `/boards/${project.id}/tasks`, { title: '成员发布', assigneeId: bob.user.id }).expect(201)).body.data as Task;
    await call(alice, 'delete', `/boards/${project.id}/members/${alice.user.id}`).expect(422);
    await call(alice, 'delete', `/boards/${project.id}/members/${bob.user.id}`).expect(204);
    await bob.agent.get(`/api/v1/boards/${project.id}/tasks`).expect(404);
    const after = (await alice.agent.get(`/api/v1/boards/${project.id}/tasks/${task.id}`).expect(200)).body.data as Task;
    expect(after.assigneeId).toBeNull();
    expect(after.createdBy?.id).toBe(bob.user.id);
    await call(alice, 'post', `/boards/${project.id}/tasks`, { title: '已退出', assigneeId: bob.user.id }).expect(422);
  });
  it('transfers ownership only to a current member and updates permissions immediately', async () => {
    const project = await board();
    await call(alice, 'put', `/boards/${project.id}/owner`, { userId: outsider.user.id }).expect(422);
    await call(alice, 'post', `/boards/${project.id}/members`, { username: 'bob' }).expect(200);
    await call(alice, 'put', `/boards/${project.id}/owner`, { userId: bob.user.id }).expect(204);
    await call(alice, 'post', `/boards/${project.id}/members`, { username: 'outsider' }).expect(403);
    expect((await bob.agent.get(`/api/v1/boards/${project.id}`).expect(200)).body.data.owner.id).toBe(bob.user.id);
    await call(bob, 'post', `/boards/${project.id}/members`, { username: 'outsider' }).expect(200);
  });
  it('shows latest nicknames and commits bounded activity only for successful business operations', async () => {
    const project = await board();
    const task = (await call(alice, 'post', `/boards/${project.id}/tasks`, { title: '发布者昵称' }).expect(201)).body.data;
    await call(alice, 'put', '/auth/profile', { displayName: '小林新版' }).expect(200);
    expect((await alice.agent.get(`/api/v1/boards/${project.id}/tasks/${task.id}`).expect(200)).body.data.createdBy.displayName).toBe('小林新版');
    const before = (await alice.agent.get(`/api/v1/boards/${project.id}/activity`).expect(200)).body.data.length;
    await call(alice, 'post', `/boards/${project.id}/tasks`, { title: '' }).expect(422);
    expect((await alice.agent.get(`/api/v1/boards/${project.id}/activity`).expect(200)).body.data).toHaveLength(before);
    for (let i = 0; i < 55; i++) {
      await call(alice, 'put', `/boards/${project.id}/tasks/${task.id}`, { title: `更新 ${i}`, description: '不应出现在活动记录的正文', dueDate: null, assigneeId: null, status: 'todo' }).expect(200);
    }
    const events = (await alice.agent.get(`/api/v1/boards/${project.id}/activity`).expect(200)).body.data;
    expect(events).toHaveLength(50);
    expect(events[0].subject).toBe('更新 54');
    expect(JSON.stringify(events)).not.toContain('不应出现在活动记录的正文');
  });
  it('sets HttpOnly SameSite Strict Secure cookies on the HTTPS production domain', async () => {
    const app = createApp({ config: { ...ctx.config, env: 'production', allowedHosts: ['board.example.test'] }, db: ctx.db, logger: createMemoryLogger().logger });
    const response = await request(app).post('/api/v1/auth/login').set('Host', 'board.example.test').set('X-Forwarded-Proto', 'https').send({ username: 'alice', password }).expect(200);
    const cookie = String(response.headers['set-cookie']?.[0] ?? '');
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Strict');
  });
  it('changes password only after verification and invalidates other sessions', async () => {
    const client = await register('password_user', '改密用户');
    const other = request.agent(ctx.app);
    await other.post('/api/v1/auth/login').send({ username: 'password_user', password }).expect(200);
    await call(client, 'put', '/auth/password', { currentPassword: 'wrong', newPassword: 'a-new-test-passphrase' }).expect(401);
    const changed = await call(client, 'put', '/auth/password', { currentPassword: password, newPassword: 'a-new-test-passphrase' }).expect(200);
    client.csrf = changed.body.data.csrfToken;
    await client.agent.get('/api/v1/boards').expect(200);
    await other.get('/api/v1/boards').expect(401);
    await request(ctx.app).post('/api/v1/auth/login').send({ username: 'password_user', password }).expect(401);
    await request(ctx.app).post('/api/v1/auth/login').send({ username: 'password_user', password: 'a-new-test-passphrase' }).expect(200);
    await call(client, 'post', '/auth/logout').expect(204);
    await client.agent.get('/api/v1/boards').expect(401);
  }, 15000);
  it('persists rate limits across application recreation and expires sessions server-side', async () => {
    const timestamp = new Date('2030-01-01T00:00:00Z');
    const isolated = makeTestApp({ authentication: true, now: () => timestamp });
    try {
      const agent = request.agent(isolated.app);
      const registered = await agent.post('/api/v1/auth/register').send({ username: 'expiry_user', displayName: '过期用户', password }).expect(201);
      isolated.db.raw.prepare('UPDATE auth_throttles SET attempts = 10 WHERE 1').run();
      const recreated = createApp({ config: isolated.config, db: isolated.db, logger: createMemoryLogger().logger, now: () => timestamp });
      await request(recreated).post('/api/v1/auth/register').send({ username: 'another_user', displayName: '新用户', password }).expect(429);
      timestamp.setDate(timestamp.getDate() + 8);
      await agent.get('/api/v1/boards').expect(401);
      expect((await agent.get('/api/v1/auth/me').expect(200)).body.data.user).toBeNull();
      expect(registered.body.data.csrfToken).toBeTruthy();
    } finally { isolated.cleanup(); }
  });
});
