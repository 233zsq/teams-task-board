import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { createWorkspaceStore } from '../src/state/workspace';
import { BOARD_A, BOARD_B, deferred, createFakeApi, makeTask } from './helpers/test-context';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace store', () => {
  it('opens a board with its tasks and members, and records the refresh time', async () => {
    const task = makeTask();
    const api = createFakeApi({ listTasks: async () => [task] });
    const store = createWorkspaceStore(api);

    const opened = await store.openBoard(BOARD_A.id);

    expect(opened).toBe(true);
    expect(store.state.board.data?.name).toBe('课程作业');
    expect(store.state.tasks.data).toEqual([task]);
    expect(store.state.members.data).toHaveLength(4);
    expect(store.state.lastRefreshedAt).not.toBeNull();
    expect(store.state.refreshFailed).toBe(false);
  });

  it('reports a missing board as 404 without falling back to another board', async () => {
    const api = createFakeApi({
      getBoard: async () => {
        throw new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' });
      },
    });
    const store = createWorkspaceStore(api);

    const opened = await store.openBoard(BOARD_A.id);

    expect(opened).toBe(false);
    expect(store.state.board.status).toBe('error');
    expect(store.state.board.error?.code).toBe('NOT_FOUND');
    expect(store.state.tasks.data).toEqual([]);
  });

  it('keeps an empty result apart from a failed read', async () => {
    const api = createFakeApi({
      listTasks: async () => {
        throw new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' });
      },
    });
    const store = createWorkspaceStore(api);

    await store.openBoard(BOARD_A.id);

    expect(store.state.tasks.status).toBe('error');
    expect(store.state.tasks.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(store.state.lastRefreshedAt).toBeNull();

    const okApi = createFakeApi({ listTasks: async () => [] });
    const okStore = createWorkspaceStore(okApi);
    await okStore.openBoard(BOARD_A.id);
    expect(okStore.state.tasks.status).toBe('ready');
    expect(okStore.state.tasks.data).toEqual([]);
  });

  it('never lets a slow response from board A paint under board B', async () => {
    const slowBoard = deferred<typeof BOARD_A>();
    const slowTasks = deferred<ReturnType<typeof makeTask>[]>();
    const taskB = makeTask({ id: 'task-b', boardId: BOARD_B.id, title: 'B 的任务' });

    const api = createFakeApi({
      getBoard: async (boardId: string) =>
        boardId === BOARD_A.id ? slowBoard.promise : BOARD_B,
      listTasks: async (boardId: string) =>
        boardId === BOARD_A.id ? slowTasks.promise : [taskB],
    });
    const store = createWorkspaceStore(api);

    const openingA = store.openBoard(BOARD_A.id);
    const openingB = store.openBoard(BOARD_B.id);
    await openingB;

    // Board A's response arrives after the switch: it must be discarded.
    slowBoard.resolve(BOARD_A);
    slowTasks.resolve([makeTask({ id: 'task-a', title: 'A 的任务' })]);
    await openingA;

    expect(store.state.currentBoardId).toBe(BOARD_B.id);
    expect(store.state.board.data?.id).toBe(BOARD_B.id);
    expect(store.state.tasks.data.map((task) => task.id)).toEqual(['task-b']);
  });

  it('clears tasks and shows loading state when switching boards', async () => {
    const api = createFakeApi({
      listTasks: async (boardId: string) =>
        boardId === BOARD_A.id ? [makeTask()] : [],
    });
    const store = createWorkspaceStore(api);
    await store.openBoard(BOARD_A.id);
    expect(store.state.tasks.data).toHaveLength(1);

    const switching = store.openBoard(BOARD_B.id);
    // Old tasks are gone immediately, and the workspace is loading, not empty.
    expect(store.state.tasks.data).toEqual([]);
    expect(store.state.tasks.status).toBe('loading');
    await switching;
    expect(store.state.tasks.status).toBe('ready');
  });

  it('updates the last refresh time on a successful refresh', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000));

    const api = createFakeApi({ listTasks: async () => [makeTask()] });
    const store = createWorkspaceStore(api);
    await store.openBoard(BOARD_A.id);
    const first = store.state.lastRefreshedAt;

    await store.refreshBoard();

    expect(store.state.lastRefreshedAt).not.toBe(first);
    expect(store.state.refreshFailed).toBe(false);
  });

  it('keeps the current snapshot and marks it stale when a refresh fails', async () => {
    const api = createFakeApi({ listTasks: async () => [makeTask()] });
    const store = createWorkspaceStore(api);
    await store.openBoard(BOARD_A.id);
    const before = store.state.lastRefreshedAt;

    api.set('getBoard', async () => {
      throw new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' });
    });
    await store.refreshBoard();

    expect(store.state.tasks.data).toHaveLength(1);
    expect(store.state.board.data?.name).toBe('课程作业');
    expect(store.state.refreshFailed).toBe(true);
    expect(store.state.lastRefreshedAt).toBe(before);
  });

  it('ignores repeated refresh requests while one is running', async () => {
    const api = createFakeApi({ listTasks: async () => [] });
    const store = createWorkspaceStore(api);
    await store.openBoard(BOARD_A.id);

    const slow = deferred<ReturnType<typeof makeTask>[]>();
    api.set('listTasks', async () => slow.promise);

    const first = store.refreshBoard();
    void store.refreshBoard();
    slow.resolve([makeTask()]);
    await first;

    const listCalls = api.calls.filter((call) => call.method === 'listTasks');
    // openBoard once, the first refresh once; the duplicate refresh was dropped.
    expect(listCalls).toHaveLength(2);
  });

  it('applies write results to the snapshot and ignores other boards', async () => {
    const api = createFakeApi({ listTasks: async () => [] });
    const store = createWorkspaceStore(api);
    await store.openBoard(BOARD_A.id);

    const created = await store.createTask({
      title: '新任务',
      description: '',
      dueDate: null,
      assigneeId: null,
      status: 'todo',
    });
    expect(store.state.tasks.data.map((task) => task.id)).toContain(created.id);

    const updated = await store.updateTask(created.id, {
      title: '新任务（改）',
      description: '',
      dueDate: null,
      assigneeId: null,
      status: 'done',
    });
    expect(store.state.tasks.data.find((task) => task.id === created.id)?.status).toBe('done');

    await store.deleteTask(updated.id);
    expect(store.state.tasks.data).toEqual([]);

    // A late response for a board the user already left is not applied.
    api.set('updateTask', async () => makeTask({ id: 'late', boardId: BOARD_B.id }));
    await store.updateTask('late', {
      title: '晚了',
      description: '',
      dueDate: null,
      assigneeId: null,
      status: 'todo',
    });
    expect(store.state.tasks.data).toEqual([]);
  });
});