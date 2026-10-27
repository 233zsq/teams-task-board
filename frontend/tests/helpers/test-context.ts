import type { App, Plugin } from 'vue';
import { mount } from '@vue/test-utils';
import type { Board, Member, Task } from '@team-plan/shared';
import { WORKSPACE_KEY } from '../../src/state/injection';
import type { WorkspaceStore } from '../../src/state/workspace';
import type { ApiEndpoints } from '../../src/api/endpoints';

export const BOARD_A: Board = {
  id: '22222222-2222-4222-8222-222222222221',
  name: '课程作业',
  createdAt: '2026-10-20T02:00:00.000Z',
};

export const BOARD_B: Board = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '答辩准备',
  createdAt: '2026-10-20T03:00:00.000Z',
};

export const MEMBERS: Member[] = [
  { id: '11111111-1111-4111-8111-111111111111', displayName: '成员 A' },
  { id: '11111111-1111-4111-8111-111111111112', displayName: '成员 B' },
  { id: '11111111-1111-4111-8111-111111111113', displayName: '成员 C' },
  { id: '11111111-1111-4111-8111-111111111114', displayName: '成员 D' },
];

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '33333333-3333-4333-8333-000000000001',
    boardId: BOARD_A.id,
    title: '完成接口联调',
    description: '覆盖创建、编辑和状态修改',
    dueDate: null,
    assigneeId: null,
    status: 'todo',
    createdAt: '2026-10-20T02:10:00.000Z',
    updatedAt: '2026-10-20T02:10:00.000Z',
    ...overrides,
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type Methods = {
  [K in keyof ApiEndpoints]: ApiEndpoints[K];
};

export interface FakeApi extends ApiEndpoints {
  calls: Array<{ method: keyof ApiEndpoints; args: unknown[] }>;
  set<K extends keyof Methods>(method: K, handler: Methods[K]): void;
  setMany(handlers: Partial<Methods>): void;
}

/**
 * A stubbed endpoint facade: every call is recorded, and a test can override
 * any method with a handler (including one that returns a deferred promise to
 * simulate slow responses).
 */
export function createFakeApi(handlers: Partial<Methods> = {}): FakeApi {
  const calls: Array<{ method: keyof ApiEndpoints; args: unknown[] }> = [];
  const table: Partial<Methods> = { ...handlers };

  function make<K extends keyof Methods>(method: K, fallback: Methods[K]): Methods[K] {
    return (async (...args: unknown[]) => {
      calls.push({ method, args });
      const handler = table[method] ?? fallback;
      return (handler as (...innerArgs: unknown[]) => unknown)(...args);
    }) as Methods[K];
  }

  const api = {
    calls,
    set<K extends keyof Methods>(method: K, handler: Methods[K]): void {
      table[method] = handler;
    },
    setMany(next: Partial<Methods>): void {
      Object.assign(table, next);
    },
    health: make('health', async () => ({
      status: 'ok' as const,
      features: { priority: false, filters: false, ordering: false, sharing: false },
    })),
    listMembers: make('listMembers', async () => MEMBERS),
    listBoards: make('listBoards', async () => [BOARD_A]),
    getBoard: make('getBoard', async () => BOARD_A),
    createBoard: make('createBoard', async (input: { name: string }) => ({
      id: '22222222-2222-4222-8222-222222222299',
      name: input.name,
      createdAt: '2026-10-21T02:00:00.000Z',
    })),
    listTasks: make('listTasks', async () => []),
    getTask: make('getTask', async () => makeTask()),
    createTask: make('createTask', async (boardId: string, input: Partial<Task>) =>
      makeTask({ boardId, ...input }),
    ),
    updateTask: make(
      'updateTask',
      async (boardId: string, taskId: string, input: Partial<Task>) =>
        makeTask({ boardId, id: taskId, ...input }),
    ),
    deleteTask: make('deleteTask', async () => undefined),
  };

  return api as unknown as FakeApi;
}

/** Mount with the workspace store injected, mirroring how App.vue provides it. */
export function mountWithWorkspace(
  component: Parameters<typeof mount>[0],
  store: WorkspaceStore,
  options: Parameters<typeof mount>[1] = {},
): ReturnType<typeof mount> {
  const globalOptions = options.global ?? {};
  const workspacePlugin: Plugin = {
    install(app: App): void {
      app.provide(WORKSPACE_KEY, store);
    },
  };

  return mount(component, {
    ...options,
    global: {
      ...globalOptions,
      plugins: [...(globalOptions.plugins ?? []), workspacePlugin],
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        ...(globalOptions.stubs ?? {}),
      },
    },
  });
}