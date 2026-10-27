import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers/test-app';
import { createSequentialUuid, createTestClock, SEED_MEMBER_IDS } from './helpers/determinism';

const RFC3339_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNKNOWN_UUID = '22222222-2222-4222-8222-222222222222';

describe('task API', () => {
  let ctx: TestApp;
  let boardId: string;
  let otherBoardId: string;

  beforeEach(async () => {
    ctx = makeTestApp({ now: createTestClock(), generateId: createSequentialUuid() });
    boardId = await createBoard('课程作业');
    otherBoardId = await createBoard('答辩准备');
  });

  afterEach(() => {
    ctx.cleanup();
  });

  async function createBoard(name: string): Promise<string> {
    const response = await request(ctx.app).post('/api/v1/boards').send({ name });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  }

  async function createTask(
    body: Record<string, unknown>,
    targetBoard: string = boardId,
  ): Promise<request.Response> {
    return request(ctx.app).post(`/api/v1/boards/${targetBoard}/tasks`).send(body);
  }

  async function updateTask(
    taskId: string,
    body: Record<string, unknown>,
    targetBoard: string = boardId,
  ): Promise<request.Response> {
    return request(ctx.app)
      .put(`/api/v1/boards/${targetBoard}/tasks/${taskId}`)
      .send(body);
  }

  describe('POST /boards/:boardId/tasks', () => {
    it('creates a full task and returns the shared Task shape', async () => {
      const response = await createTask({
        title: '  完成接口联调  ',
        description: '覆盖创建、编辑和状态修改',
        dueDate: '2026-10-23',
        assigneeId: SEED_MEMBER_IDS[1],
        status: 'doing',
      });

      expect(response.status).toBe(201);
      const task = response.body.data;
      expect(task.id).toBe('33333333-3333-4333-8333-000000000003');
      expect(task.boardId).toBe(boardId);
      expect(task.title).toBe('完成接口联调');
      expect(task.description).toBe('覆盖创建、编辑和状态修改');
      expect(task.dueDate).toBe('2026-10-23');
      expect(task.assigneeId).toBe(SEED_MEMBER_IDS[1]);
      expect(task.status).toBe('doing');
      expect(task.createdAt).toMatch(RFC3339_MS);
      expect(task.updatedAt).toBe(task.createdAt);
    });

    it('applies creation defaults for a title-only task', async () => {
      const response = await createTask({ title: '只写标题' });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        title: '只写标题',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'todo',
      });
    });

    it('lists tasks by createdAt then id, and separates boards', async () => {
      await createTask({ title: '第一项' });
      await createTask({ title: '第二项' });
      await createTask({ title: '别的看板' }, otherBoardId);

      const list = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`);
      expect(list.status).toBe(200);
      expect(list.body.data.map((task: { title: string }) => task.title)).toEqual([
        '第一项',
        '第二项',
      ]);

      const other = await request(ctx.app).get(`/api/v1/boards/${otherBoardId}/tasks`);
      expect(other.body.data.map((task: { title: string }) => task.title)).toEqual(['别的看板']);
    });

    it('returns an empty array for a board without tasks', async () => {
      const list = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`);
      expect(list.body).toEqual({ data: [] });
    });

    it('uses 404 for unknown boards and 400 for malformed board ids', async () => {
      const missing = await createTask({ title: '任务' }, UNKNOWN_UUID);
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');

      const malformed = await request(ctx.app)
        .post('/api/v1/boards/not-a-uuid/tasks')
        .send({ title: '任务' });
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('BAD_REQUEST');
    });

    it('rejects an empty body with a title field error (D-04)', async () => {
      const response = await request(ctx.app).post(`/api/v1/boards/${boardId}/tasks`);

      expect(response.status).toBe(422);
      expect(response.body.error.fields).toEqual({ title: '标题不能为空' });
    });

    it('rejects unknown, protected and dangerous fields', async () => {
      for (const body of [
        { title: '任务', sortOrder: 1 },
        { title: '任务', boardId: otherBoardId },
        { title: '任务', id: UNKNOWN_UUID },
        { title: '任务', updatedAt: '2026-10-20T02:00:00.000Z' },
      ]) {
        const response = await createTask(body);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('BAD_REQUEST');
      }
    });

    it('rejects a non-object top-level body', async () => {
      const response = await request(ctx.app)
        .post(`/api/v1/boards/${boardId}/tasks`)
        .set('Content-Type', 'application/json')
        .send('["title"]');
      expect(response.status).toBe(400);
    });

    it('rejects unknown query parameters', async () => {
      const response = await request(ctx.app)
        .post(`/api/v1/boards/${boardId}/tasks?fast=1`)
        .send({ title: '任务' });
      expect(response.status).toBe(400);
    });

    it('rejects a non-JSON body with 415 and keeps the task list unchanged', async () => {
      const response = await request(ctx.app)
        .post(`/api/v1/boards/${boardId}/tasks`)
        .set('Content-Type', 'text/plain')
        .send('title=x');

      expect(response.status).toBe(415);

      const list = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`);
      expect(list.body.data).toEqual([]);
    });

    it('returns 413 above 32 KiB', async () => {
      const response = await createTask({ title: '任务', description: 'x'.repeat(33 * 1024) });
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('field rules', () => {
    it('enforces title length in code points, rejecting zero-width and control characters', async () => {
      const ok = await createTask({ title: '标'.repeat(100) });
      expect(ok.status).toBe(201);

      const cases: Array<[Record<string, unknown>, string]> = [
        [{ title: '标'.repeat(101) }, '标题不能超过 100 个字符'],
        [{ title: '   ' }, '标题不能为空'],
        [{ title: 'a\u0000b' }, '标题包含不支持的字符'],
        [{ title: 'a\u200bb' }, '标题包含不支持的字符'],
        [{ title: 'a\u202eb' }, '标题包含不支持的字符'],
        [{ title: 'a\ufeffb' }, '标题包含不支持的字符'],
        [{ title: 'a\nb' }, '标题包含不支持的字符'],
      ];

      for (const [body, message] of cases) {
        const response = await createTask(body);
        expect(response.status).toBe(422);
        expect(response.body.error.fields).toEqual({ title: message });
      }

      const emoji = await createTask({ title: '👨\u200d👩\u200d👧\u200d👦 家庭任务' });
      expect(emoji.status).toBe(201);
    });

    it('enforces description length and keeps newlines verbatim', async () => {
      const ok = await createTask({
        title: '任务',
        description: `第一行\n\t第二行${'字'.repeat(1990)}`,
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.description.startsWith('第一行\n\t第二行')).toBe(true);

      const tooLong = await createTask({ title: '任务', description: '字'.repeat(2001) });
      expect(tooLong.status).toBe(422);
      expect(tooLong.body.error.fields).toEqual({ description: '描述不能超过 2000 个字符' });

      const nullDescription = await createTask({ title: '任务', description: null });
      expect(nullDescription.status).toBe(422);
      expect(nullDescription.body.error.fields).toEqual({ description: '描述必须是字符串' });

      const bidi = await createTask({ title: '任务', description: 'a\u202eb' });
      expect(bidi.status).toBe(422);
    });

    it('validates real calendar dates without accepting near-misses', async () => {
      for (const good of ['2026-10-23', '2028-02-29', '2000-02-29', '0001-01-01']) {
        const response = await createTask({ title: '任务', dueDate: good });
        expect(response.status).toBe(201);
        expect(response.body.data.dueDate).toBe(good);
      }

      for (const bad of [
        '2026-02-29',
        '2026-02-30',
        '2026-2-3',
        '2026-00-10',
        '2026-13-01',
        '0000-01-01',
        '1900-02-29',
        '2026-10-23T00:00:00.000Z',
        '',
      ]) {
        const response = await createTask({ title: '任务', dueDate: bad });
        expect(response.status).toBe(422);
        expect(response.body.error.fields).toEqual({
          dueDate: '截止日期必须是 YYYY-MM-DD 格式的有效日期',
        });
      }

      const cleared = await createTask({ title: '任务', dueDate: null });
      expect(cleared.status).toBe(201);
      expect(cleared.body.data.dueDate).toBeNull();
    });

    it('accepts the four seeded members and rejects unknown assignees with 422', async () => {
      for (const memberId of SEED_MEMBER_IDS) {
        const response = await createTask({ title: '任务', assigneeId: memberId });
        expect(response.status).toBe(201);
        expect(response.body.data.assigneeId).toBe(memberId);
      }

      const unknown = await createTask({ title: '任务', assigneeId: UNKNOWN_UUID });
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.fields).toEqual({ assigneeId: '负责人不存在' });

      const malformed = await createTask({ title: '任务', assigneeId: '成员A' });
      expect(malformed.status).toBe(422);
      expect(malformed.body.error.fields).toEqual({ assigneeId: '负责人格式不正确' });
    });

    it('accepts only the three lowercase statuses', async () => {
      const response = await createTask({ title: '任务', status: 'Doing' });
      expect(response.status).toBe(422);
      expect(response.body.error.fields).toEqual({ status: '状态只能是 todo、doing 或 done' });
    });
  });

  describe('GET /boards/:boardId/tasks/:taskId', () => {
    it('reads one task and keeps the membership check strict', async () => {
      const created = await createTask({ title: '任务' });
      const taskId = created.body.data.id as string;

      const found = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks/${taskId}`);
      expect(found.status).toBe(200);
      expect(found.body.data.title).toBe('任务');

      const crossBoard = await request(ctx.app).get(
        `/api/v1/boards/${otherBoardId}/tasks/${taskId}`,
      );
      expect(crossBoard.status).toBe(404);

      const malformed = await request(ctx.app).get(
        `/api/v1/boards/${boardId}/tasks/not-a-uuid`,
      );
      expect(malformed.status).toBe(400);
    });

    it('rejects task list query parameters in P0', async () => {
      const response = await request(ctx.app).get(
        `/api/v1/boards/${boardId}/tasks?priority=high`,
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /boards/:boardId/tasks/:taskId', () => {
    it('updates all five fields with a full PUT and keeps id/boardId/createdAt', async () => {
      const created = await createTask({ title: '旧标题' });
      const original = created.body.data;

      const response = await updateTask(original.id, {
        title: '新标题',
        description: '新描述',
        dueDate: '2026-12-01',
        assigneeId: SEED_MEMBER_IDS[0],
        status: 'doing',
      });

      expect(response.status).toBe(200);
      const updated = response.body.data;
      expect(updated.id).toBe(original.id);
      expect(updated.boardId).toBe(boardId);
      expect(updated.createdAt).toBe(original.createdAt);
      expect(updated.updatedAt).not.toBe(original.updatedAt);
      expect(updated).toMatchObject({
        title: '新标题',
        description: '新描述',
        dueDate: '2026-12-01',
        assigneeId: SEED_MEMBER_IDS[0],
        status: 'doing',
      });
    });

    it('refreshes updatedAt even when no value changes', async () => {
      const created = await createTask({ title: '任务' });
      const original = created.body.data;

      const response = await updateTask(original.id, {
        title: original.title,
        description: original.description,
        dueDate: original.dueDate,
        assigneeId: original.assigneeId,
        status: original.status,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.updatedAt).not.toBe(original.updatedAt);
    });

    it('clears optional fields with empty string and explicit nulls', async () => {
      const created = await createTask({
        title: '任务',
        description: '描述',
        dueDate: '2026-10-23',
        assigneeId: SEED_MEMBER_IDS[2],
      });
      const taskId = created.body.data.id as string;

      const response = await updateTask(taskId, {
        title: '任务',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'todo',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        description: '',
        dueDate: null,
        assigneeId: null,
      });
    });

    it('reports every missing field instead of treating it as a clear', async () => {
      const created = await createTask({ title: '任务' });
      const taskId = created.body.data.id as string;

      const empty = await updateTask(taskId, {});
      expect(empty.status).toBe(422);
      expect(Object.keys(empty.body.error.fields).sort()).toEqual([
        'assigneeId',
        'description',
        'dueDate',
        'status',
        'title',
      ]);

      const partial = await updateTask(taskId, { title: '只给标题' });
      expect(partial.status).toBe(422);
      expect(Object.keys(partial.body.error.fields).sort()).toEqual([
        'assigneeId',
        'description',
        'dueDate',
        'status',
      ]);

      const stillThere = await request(ctx.app).get(
        `/api/v1/boards/${boardId}/tasks/${taskId}`,
      );
      expect(stillThere.body.data.title).toBe('任务');
    });

    it('supports all six status transitions and persists them', async () => {
      const created = await createTask({ title: '流转任务' });
      const task = created.body.data;
      const order = ['todo', 'doing', 'done'];

      for (const [from, to] of [
        ['todo', 'doing'],
        ['todo', 'done'],
        ['doing', 'todo'],
        ['doing', 'done'],
        ['done', 'todo'],
        ['done', 'doing'],
      ] as const) {
        const seeded = await updateTask(task.id, {
          title: task.title,
          description: '',
          dueDate: null,
          assigneeId: null,
          status: from,
        });
        expect(seeded.status).toBe(200);

        const moved = await updateTask(task.id, {
          title: task.title,
          description: '',
          dueDate: null,
          assigneeId: null,
          status: to,
        });
        expect(moved.status).toBe(200);
        expect(moved.body.data.status).toBe(to);
        expect(order).toContain(to);
      }

      const reread = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks/${task.id}`);
      expect(reread.body.data.status).toBe('doing');
    });

    it('rejects unknown statuses, dates and assignees', async () => {
      const created = await createTask({ title: '任务' });
      const taskId = created.body.data.id as string;

      const badStatus = await updateTask(taskId, {
        title: '任务',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'Doing',
      });
      expect(badStatus.status).toBe(422);

      const badDate = await updateTask(taskId, {
        title: '任务',
        description: '',
        dueDate: '2026-02-30',
        assigneeId: null,
        status: 'todo',
      });
      expect(badDate.status).toBe(422);

      const badAssignee = await updateTask(taskId, {
        title: '任务',
        description: '',
        dueDate: null,
        assigneeId: UNKNOWN_UUID,
        status: 'todo',
      });
      expect(badAssignee.status).toBe(422);
      expect(badAssignee.body.error.fields).toEqual({ assigneeId: '负责人不存在' });
    });

    it('cannot move a task to another board through the body', async () => {
      const created = await createTask({ title: '任务' });
      const taskId = created.body.data.id as string;

      const response = await updateTask(taskId, {
        title: '任务',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'todo',
        boardId: otherBoardId,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('keeps cross-board writes at 404 and leaves data untouched', async () => {
      const created = await createTask({ title: '任务' });
      const taskId = created.body.data.id as string;

      const response = await updateTask(
        taskId,
        { title: '篡改', description: '', dueDate: null, assigneeId: null, status: 'done' },
        otherBoardId,
      );

      expect(response.status).toBe(404);
      const reread = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks/${taskId}`);
      expect(reread.body.data.title).toBe('任务');
      expect(reread.body.data.status).toBe('todo');
    });

    it('returns 404 for a deleted or never-existing task', async () => {
      const response = await updateTask(UNKNOWN_UUID, {
        title: '任务',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'todo',
      });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /boards/:boardId/tasks/:taskId', () => {
    it('deletes one task with 204 and no body', async () => {
      const keep = await createTask({ title: '保留' });
      const drop = await createTask({ title: '删除' });

      const response = await request(ctx.app).delete(
        `/api/v1/boards/${boardId}/tasks/${drop.body.data.id}`,
      );

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(response.headers['content-type']).toBeUndefined();

      const list = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`);
      expect(list.body.data.map((task: { id: string }) => task.id)).toEqual([
        keep.body.data.id,
      ]);
    });

    it('returns 404 on a repeated delete and on cross-board deletes', async () => {
      const created = await createTask({ title: '任务' });
      const taskId = created.body.data.id as string;

      const crossBoard = await request(ctx.app).delete(
        `/api/v1/boards/${otherBoardId}/tasks/${taskId}`,
      );
      expect(crossBoard.status).toBe(404);

      const first = await request(ctx.app).delete(`/api/v1/boards/${boardId}/tasks/${taskId}`);
      expect(first.status).toBe(204);

      const second = await request(ctx.app).delete(`/api/v1/boards/${boardId}/tasks/${taskId}`);
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe('NOT_FOUND');
    });

    it('ignores a JSON body on DELETE but still rejects non-JSON bodies', async () => {
      const keep = await createTask({ title: '保留' });
      const drop = await createTask({ title: '删除' });

      const withJson = await request(ctx.app)
        .delete(`/api/v1/boards/${boardId}/tasks/${drop.body.data.id}`)
        .send({ id: keep.body.data.id, boardId: otherBoardId });

      expect(withJson.status).toBe(204);

      const list = await request(ctx.app).get(`/api/v1/boards/${boardId}/tasks`);
      expect(list.body.data.map((task: { id: string }) => task.id)).toEqual([
        keep.body.data.id,
      ]);

      const nonJson = await request(ctx.app)
        .delete(`/api/v1/boards/${boardId}/tasks/${keep.body.data.id}`)
        .set('Content-Type', 'text/plain')
        .send('bye');

      expect(nonJson.status).toBe(415);
    });
  });
});