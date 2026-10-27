import { compareCreated, validateBoardName, type Board, type Task } from '@team-plan/shared';
import { RequestError, type BoardApi, type ReadOptions } from '../api/service';
import { boards as initialBoards, members, tasks as initialTasks } from './fixtures';

export type DemoScenario = 'normal' | 'empty' | 'read-error' | 'members-error' | 'slow';
export function createDemoApi(latencyMs = 180): BoardApi & { setScenario(value: DemoScenario): void } {
  let boards: Board[] = structuredClone(initialBoards);
  let tasks: Task[] = structuredClone(initialTasks);
  let scenario: DemoScenario = 'normal';
  async function read<T>(kind: string, value: () => T, options?: ReadOptions): Promise<T> {
    if (options?.signal?.aborted) throw new RequestError('aborted', 'ABORTED');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new RequestError('aborted', 'ABORTED')); };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener('abort', onAbort); resolve();
      }, scenario === 'slow' && kind === 'tasks' ? 2500 : latencyMs);
      options?.signal?.addEventListener('abort', onAbort, { once: true });
    });
    if ((scenario === 'read-error' && kind === 'tasks') || (scenario === 'members-error' && kind === 'members')) {
      throw new RequestError('http', 'SERVICE_UNAVAILABLE', 503);
    }
    return structuredClone(value());
  }
  const board = (id: string) => {
    const found = boards.find(b => b.id === id);
    if (!found) throw new RequestError('http', 'NOT_FOUND', 404);
    return found;
  };
  return {
    setScenario(value) {
      scenario = value;
      if (value === 'empty') { boards = []; tasks = []; }
    },
    health: options => read('health', () => ({ status: 'ok', features: {
      priority: false, filters: false, ordering: false, sharing: false,
    } }), options),
    listBoards: options => read('boards', () => [...boards].sort(compareCreated), options),
    createBoard: input => read('create', () => {
      const error = validateBoardName(input.name);
      if (error) throw new RequestError('http', 'VALIDATION_ERROR', 422, { name: error });
      const created = { id: crypto.randomUUID(), name: input.name.trim(), createdAt: new Date().toISOString() };
      boards.push(created); return created;
    }),
    createTask: (id, input) => read('create', () => {
      board(id);
      const now = new Date().toISOString();
      const created: Task = { id: crypto.randomUUID(), boardId: id, title: input.title.trim(),
        description: input.description ?? '', dueDate: input.dueDate ?? null, assigneeId: input.assigneeId ?? null,
        status: input.status ?? 'todo', createdAt: now, updatedAt: now };
      tasks.push(created); return created;
    }),
    getBoard: (id, options) => read('board', () => board(id), options),
    listMembers: options => read('members', () => members, options),
    listTasks: (id, options) => read('tasks', () => {
      board(id); return tasks.filter(t => t.boardId === id).sort(compareCreated);
    }, options),
    getTask: (id, taskId, options) => read('task', () => {
      board(id);
      const found = tasks.find(t => t.boardId === id && t.id === taskId);
      if (!found) throw new RequestError('http', 'NOT_FOUND', 404);
      return found;
    }, options),
  };
}
