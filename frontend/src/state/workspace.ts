import { reactive } from 'vue';
import type {
  Board,
  HealthData,
  Member,
  Task,
  TaskFieldInput,
  TaskFilters,
} from '@team-plan/shared';
import { hasTaskFilters } from '@team-plan/shared';
import { ApiError } from '../api/client';
import { api as defaultApi, type ApiEndpoints } from '../api/endpoints';

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Resource<T> {
  status: ResourceStatus;
  data: T;
  error: ApiError | null;
}

export interface WorkspaceState {
  health: Resource<HealthData | null>;
  boards: Resource<Board[]>;
  members: Resource<Member[]>;
  board: Resource<Board | null>;
  tasks: Resource<Task[]>;
  taskFilters: TaskFilters;
  taskResults: Resource<Task[]>;
  filterNotice: string | null;
  currentBoardId: string | null;
  lastRefreshedAt: number | null;
  refreshing: boolean;
  refreshFailed: boolean;
}

export interface WorkspaceStore {
  state: WorkspaceState;
  checkHealth(): Promise<boolean>;
  loadBoardList(): Promise<Board[] | null>;
  loadMembers(): Promise<Member[] | null>;
  /** Load board + tasks for a board id. Returns false when the board is 404. */
  openBoard(boardId: string): Promise<boolean>;
  refreshBoard(): Promise<void>;
  /** Read the freshest task snapshot before opening the edit form. */
  fetchTask(taskId: string): Promise<Task>;
  createBoard(name: string): Promise<Board>;
  createTask(input: TaskFieldInput): Promise<Task>;
  updateTask(taskId: string, input: TaskFieldInput): Promise<Task>;
  deleteTask(taskId: string): Promise<void>;
  applyTaskFilters(filters: TaskFilters): Promise<boolean>;
  reset(): void;
}

function errorOf(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  return new ApiError({
    kind: 'network',
    code: 'NETWORK_ERROR',
    message: error instanceof Error ? error.message : undefined,
  });
}

function byCreatedAtThenId(left: Board, right: Board): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function byTaskOrder(left: Task, right: Task): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function initialResource<T>(data: T): Resource<T> {
  return { status: 'idle', data, error: null };
}

function createState(): WorkspaceState {
  return {
    health: initialResource<HealthData | null>(null),
    boards: initialResource<Board[]>([]),
    members: initialResource<Member[]>([]),
    board: initialResource<Board | null>(null),
    tasks: initialResource<Task[]>([]),
    taskFilters: {},
    taskResults: initialResource<Task[]>([]),
    filterNotice: null,
    currentBoardId: null,
    lastRefreshedAt: null,
    refreshing: false,
    refreshFailed: false,
  };
}

/**
 * Page-level workspace state. Server snapshots and form drafts stay separate;
 * reads are guarded by a request sequence plus the bound boardId so a slow
 * response can never paint board A's tasks under board B.
 */
export function createWorkspaceStore(endpoints: ApiEndpoints): WorkspaceStore {
  const state = reactive<WorkspaceState>(createState());

  let boardSequence = 0;
  let memberSequence = 0;
  let boardListSequence = 0;
  let boardAbort: AbortController | null = null;
  let filterSequence = 0;
  let filterAbort: AbortController | null = null;

  function clearTaskFilters(): void {
    filterSequence++;
    filterAbort?.abort(); filterAbort = null;
    state.taskFilters = {};
    state.taskResults = initialResource<Task[]>([]);
    state.filterNotice = null;
  }

  async function loadTaskResults(): Promise<boolean> {
    const sequence = ++filterSequence;
    filterAbort?.abort();
    const boardId = state.currentBoardId;
    if (!boardId || !hasTaskFilters(state.taskFilters)) {
      filterAbort = null; state.taskResults = initialResource<Task[]>([]); return true;
    }
    const controller = new AbortController(); filterAbort = controller;
    const filters = { ...state.taskFilters };
    state.taskResults = { status: 'loading', data: [], error: null };
    try {
      const results = await endpoints.listTasks(boardId, controller.signal, filters);
      if (sequence !== filterSequence || boardId !== state.currentBoardId) return false;
      state.taskResults = { status: 'ready', data: results, error: null };
      return true;
    } catch (error) {
      if (sequence !== filterSequence || boardId !== state.currentBoardId) return false;
      state.taskResults = { status: 'error', data: [], error: errorOf(error) };
      return false;
    } finally { if (sequence === filterSequence) filterAbort = null; }
  }

  async function applyTaskFilters(filters: TaskFilters): Promise<boolean> {
    state.taskFilters = { ...filters };
    state.filterNotice = null;
    return loadTaskResults();
  }

  /** A committed write stays successful if its follow-up read fails. */
  async function afterTaskChange(boardId: string, task?: Task): Promise<void> {
    state.filterNotice = null;
    if (boardId !== state.currentBoardId || !hasTaskFilters(state.taskFilters)) return;
    const loaded = await loadTaskResults();
    if (boardId !== state.currentBoardId || !hasTaskFilters(state.taskFilters)) return;
    if (!loaded && state.taskResults.status === 'error') {
      state.filterNotice = '任务已保存，筛选结果暂时读取失败；请重试查询，无需再次保存';
    } else if (loaded && task && !state.taskResults.data.some((item) => item.id === task.id)) {
      state.filterNotice = '任务已保存，但不符合当前筛选条件，已移出结果；清空筛选可查看';
    }
  }

  function reset(): void {
    clearTaskFilters();
    boardSequence += 1;
    memberSequence += 1;
    boardListSequence += 1;
    boardAbort?.abort();
    boardAbort = null;
    Object.assign(state, createState());
  }

  async function checkHealth(): Promise<boolean> {
    state.health.status = 'loading';
    state.health.error = null;
    try {
      const data = await endpoints.health();
      state.health.data = data;
      state.health.status = 'ready';
      return true;
    } catch (error) {
      state.health.data = null;
      state.health.status = 'error';
      state.health.error = errorOf(error);
      return false;
    }
  }

  async function loadBoardList(): Promise<Board[] | null> {
    const sequence = ++boardListSequence;
    state.boards.status = 'loading';
    state.boards.error = null;
    try {
      const boards = await endpoints.listBoards();
      if (sequence !== boardListSequence) {
        return null;
      }
      state.boards.data = [...boards].sort(byCreatedAtThenId);
      state.boards.status = 'ready';
      return state.boards.data;
    } catch (error) {
      if (sequence !== boardListSequence) {
        return null;
      }
      state.boards.status = 'error';
      state.boards.error = errorOf(error);
      return null;
    }
  }

  async function loadMembers(): Promise<Member[] | null> {
    const sequence = ++memberSequence;
    state.members.status = 'loading';
    state.members.error = null;
    try {
      const members = await endpoints.listMembers(undefined, state.currentBoardId ?? undefined);
      if (sequence !== memberSequence) {
        return null;
      }
      state.members.data = members;
      state.members.status = 'ready';
      return members;
    } catch (error) {
      if (sequence !== memberSequence) {
        return null;
      }
      state.members.status = 'error';
      state.members.error = errorOf(error);
      return null;
    }
  }

  async function openBoard(boardId: string): Promise<boolean> {
    clearTaskFilters();
    const sequence = ++boardSequence;
    boardAbort?.abort();
    const controller = new AbortController();
    boardAbort = controller;

    state.currentBoardId = boardId;
    state.board = { status: 'loading', data: null, error: null };
    state.tasks = { status: 'loading', data: [], error: null };
    state.lastRefreshedAt = null;
    state.refreshFailed = false;

    // Membership is project-specific; never reuse the previous project's people.
    state.members = { status: 'loading', data: [], error: null };
    const membersPending = loadMembers();

    const boardPromise = endpoints.getBoard(boardId, controller.signal);
    const tasksPromise = endpoints.listTasks(boardId, controller.signal);

    let boardOk = false;
    let tasksOk = false;

    try {
      const board = await boardPromise;
      if (sequence !== boardSequence) {
        return true;
      }
      state.board = { status: 'ready', data: board, error: null };
      boardOk = true;
    } catch (error) {
      if (sequence !== boardSequence) {
        return true;
      }
      state.board = { status: 'error', data: null, error: errorOf(error) };
    }

    try {
      const tasks = await tasksPromise;
      if (sequence !== boardSequence) {
        return boardOk;
      }
      state.tasks = { status: 'ready', data: tasks, error: null };
      tasksOk = true;
    } catch (error) {
      if (sequence !== boardSequence) {
        return boardOk;
      }
      state.tasks = { status: 'error', data: [], error: errorOf(error) };
    }

    await membersPending;

    if (sequence === boardSequence && boardOk && tasksOk) {
      state.lastRefreshedAt = Date.now();
    }

    return boardOk;
  }

  async function refreshBoard(): Promise<void> {
    const boardId = state.currentBoardId;
    if (boardId === null || state.refreshing) {
      return;
    }

    const sequence = ++boardSequence;
    state.refreshing = true;

    const controller = new AbortController();
    boardAbort?.abort();
    boardAbort = controller;

    let failed = false;

    const boardsPending = loadBoardList();
    const membersPending = loadMembers();

    try {
      const [board, tasks] = await Promise.all([
        endpoints.getBoard(boardId, controller.signal),
        endpoints.listTasks(boardId, controller.signal),
      ]);
      if (sequence !== boardSequence || state.currentBoardId !== boardId) {
        return;
      }
      state.board = { status: 'ready', data: board, error: null };
      state.tasks = { status: 'ready', data: tasks, error: null };
      if (hasTaskFilters(state.taskFilters) && !(await loadTaskResults())) failed = true;
    } catch (error) {
      if (sequence !== boardSequence || state.currentBoardId !== boardId) {
        return;
      }
      // A failed refresh keeps the current snapshot and only marks it stale.
      state.refreshFailed = true;
      state.board.error = state.board.data === null ? errorOf(error) : state.board.error;
      state.tasks.error = state.tasks.data.length === 0 ? errorOf(error) : state.tasks.error;
      failed = true;
    } finally {
      const boards = await boardsPending;
      const members = await membersPending;
      if (sequence === boardSequence && state.currentBoardId === boardId) {
        if (boards === null || members === null) {
          failed = true;
        }
        if (!failed) {
          state.lastRefreshedAt = Date.now();
          state.refreshFailed = false;
        } else state.refreshFailed = true;
        state.refreshing = false;
      } else {
        state.refreshing = false;
      }
    }
  }

  async function fetchTask(taskId: string): Promise<Task> {
    const boardId = state.currentBoardId;
    if (boardId === null) {
      throw new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' });
    }
    return endpoints.getTask(boardId, taskId);
  }

  async function createBoard(name: string): Promise<Board> {
    const board = await endpoints.createBoard({ name });
    state.boards.data = [...state.boards.data, board].sort(byCreatedAtThenId);
    state.boards.status = 'ready';
    state.boards.error = null;
    return board;
  }

  async function createTask(input: TaskFieldInput): Promise<Task> {
    const boardId = state.currentBoardId;
    if (boardId === null) {
      throw new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' });
    }
    const task = await endpoints.createTask(boardId, input);
    if (task.boardId === state.currentBoardId) {
      state.tasks.data = [...state.tasks.data, task].sort(byTaskOrder);
      state.tasks.status = 'ready';
      await afterTaskChange(boardId, task);
    }
    return task;
  }

  async function updateTask(taskId: string, input: TaskFieldInput): Promise<Task> {
    const boardId = state.currentBoardId;
    if (boardId === null) {
      throw new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' });
    }
    const task = await endpoints.updateTask(boardId, taskId, input);
    if (task.boardId === state.currentBoardId) {
      state.tasks.data = state.tasks.data.map((item) =>
        item.id === task.id ? task : item,
      );
      state.tasks.status = 'ready';
      await afterTaskChange(boardId, task);
    }
    return task;
  }

  async function deleteTask(taskId: string): Promise<void> {
    const boardId = state.currentBoardId;
    if (boardId === null) {
      throw new ApiError({ kind: 'http', status: 404, code: 'NOT_FOUND' });
    }
    await endpoints.deleteTask(boardId, taskId);
    if (boardId === state.currentBoardId) {
      state.tasks.data = state.tasks.data.filter((item) => item.id !== taskId);
      await afterTaskChange(boardId);
    }
  }

  return {
    state,
    checkHealth,
    loadBoardList,
    loadMembers,
    openBoard,
    refreshBoard,
    fetchTask,
    createBoard,
    createTask,
    updateTask,
    deleteTask,
    applyTaskFilters,
    reset,
  };
}

export const workspace = createWorkspaceStore(defaultApi);
