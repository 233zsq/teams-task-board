import type Database from 'better-sqlite3';
import type { Task, TaskFieldInput, TaskFilters } from '@team-plan/shared';
import { getBoardRow } from '../../db/boards';
import { memberExists } from '../../db/members';
import {
  deleteTaskRow,
  getTaskRow,
  insertTaskRow,
  listTaskRows,
  toTask,
  toTaskRow,
  updateTaskRow,
} from '../../db/tasks';
import { withWriteTransaction } from '../../db/transaction';
import { AssigneeNotFoundError, NotFoundError } from '../errors';

export interface TaskService {
  listTasks(boardId: string, filters?: TaskFilters): Task[];
  getTask(boardId: string, taskId: string): Task;
  createTask(boardId: string, input: TaskFieldInput): Task;
  updateTask(boardId: string, taskId: string, input: TaskFieldInput): Task;
  deleteTask(boardId: string, taskId: string): void;
}

export interface TaskServiceDeps {
  db: Database.Database;
  now: () => Date;
  generateId: () => string;
  priority?: boolean;
}

function assertBoardExists(db: Database.Database, boardId: string): void {
  if (getBoardRow(db, boardId) === undefined) {
    throw new NotFoundError();
  }
}

function assertAssigneeExists(db: Database.Database, assigneeId: string | null): void {
  if (assigneeId !== null && !memberExists(db, assigneeId)) {
    throw new AssigneeNotFoundError();
  }
}

export function createTaskService(deps: TaskServiceDeps): TaskService {
  return {
    listTasks(boardId: string, filters: TaskFilters = {}): Task[] {
      assertBoardExists(deps.db, boardId);
      return listTaskRows(deps.db, boardId, filters).map((row) => toTask(row, deps.priority));
    },

    getTask(boardId: string, taskId: string): Task {
      // A missing board and a task belonging to another board both map to 404.
      const row = getTaskRow(deps.db, boardId, taskId);
      if (row === undefined) {
        throw new NotFoundError();
      }
      return toTask(row, deps.priority);
    },

    createTask(boardId: string, input: TaskFieldInput): Task {
      return withWriteTransaction(deps.db, () => {
        assertBoardExists(deps.db, boardId);
        assertAssigneeExists(deps.db, input.assigneeId);

        const timestamp = deps.now().toISOString();
        const task: Task = {
          id: deps.generateId(),
          boardId,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          assigneeId: input.assigneeId,
          status: input.status,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(deps.priority ? { priority: input.priority ?? 'medium' } : {}),
        };

        insertTaskRow(deps.db, toTaskRow(task));
        return task;
      });
    },

    updateTask(boardId: string, taskId: string, input: TaskFieldInput): Task {
      return withWriteTransaction(deps.db, () => {
        const existing = getTaskRow(deps.db, boardId, taskId);
        if (existing === undefined) {
          throw new NotFoundError();
        }
        assertAssigneeExists(deps.db, input.assigneeId);

        const task: Task = {
          ...toTask(existing, deps.priority),
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          assigneeId: input.assigneeId,
          status: input.status,
          // Any successful PUT refreshes updatedAt, even for identical values.
          updatedAt: deps.now().toISOString(),
          ...(deps.priority ? { priority: input.priority ?? 'medium' } : {}),
        };

        updateTaskRow(deps.db, toTaskRow(task));
        return task;
      });
    },

    deleteTask(boardId: string, taskId: string): void {
      withWriteTransaction(deps.db, () => {
        const changes = deleteTaskRow(deps.db, boardId, taskId);
        if (changes === 0) {
          throw new NotFoundError();
        }
      });
    },
  };
}
