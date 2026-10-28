import type {
  Board,
  CreateBoardInput,
  HealthData,
  Member,
  Task,
  TaskFieldInput,
} from '@team-plan/shared';
import { createApiClient, type ApiClient } from './client';

export interface ApiEndpoints {
  health(signal?: AbortSignal): Promise<HealthData>;
  listMembers(signal?: AbortSignal, boardId?: string): Promise<Member[]>;
  listBoards(signal?: AbortSignal): Promise<Board[]>;
  getBoard(boardId: string, signal?: AbortSignal): Promise<Board>;
  createBoard(input: CreateBoardInput): Promise<Board>;
  listTasks(boardId: string, signal?: AbortSignal): Promise<Task[]>;
  getTask(boardId: string, taskId: string, signal?: AbortSignal): Promise<Task>;
  createTask(boardId: string, input: TaskFieldInput): Promise<Task>;
  updateTask(boardId: string, taskId: string, input: TaskFieldInput): Promise<Task>;
  deleteTask(boardId: string, taskId: string): Promise<void>;
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

/** Typed endpoint facade used by the pages; it shares one client (and timeout). */
export function createApiEndpoints(client: ApiClient): ApiEndpoints {
  return {
    health: (signal) => client.request<HealthData>('GET', '/health', { signal }),

    listMembers: (signal, boardId) => client.request<Member[]>('GET', boardId ? `/members?boardId=${encode(boardId)}` : '/members', { signal }),

    listBoards: (signal) => client.request<Board[]>('GET', '/boards', { signal }),

    getBoard: (boardId, signal) =>
      client.request<Board>('GET', `/boards/${encode(boardId)}`, { signal }),

    createBoard: (input) =>
      client.request<Board>('POST', '/boards', { body: input }),

    listTasks: (boardId, signal) =>
      client.request<Task[]>('GET', `/boards/${encode(boardId)}/tasks`, { signal }),

    getTask: (boardId, taskId, signal) =>
      client.request<Task>(
        'GET',
        `/boards/${encode(boardId)}/tasks/${encode(taskId)}`,
        { signal },
      ),

    createTask: (boardId, input) =>
      client.request<Task>('POST', `/boards/${encode(boardId)}/tasks`, { body: input }),

    updateTask: (boardId, taskId, input) =>
      client.request<Task>(
        'PUT',
        `/boards/${encode(boardId)}/tasks/${encode(taskId)}`,
        { body: input },
      ),

    deleteTask: (boardId, taskId) =>
      client.request<void>(
        'DELETE',
        `/boards/${encode(boardId)}/tasks/${encode(taskId)}`,
      ),
  };
}

/** Default app API; tests inject their own client via the store factory. */
export const api: ApiEndpoints = createApiEndpoints(createApiClient());
