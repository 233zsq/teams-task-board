import type Database from 'better-sqlite3';
import type { Task, TaskFieldInput } from '@team-plan/shared';
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
  listTasks(boardId: string): Task[];
  getTask(boardId: string, taskId: string): Task;
  createTask(boardId: string, input: TaskFieldInput): Task;
  updateTask(boardId: string, taskId: string, input: TaskFieldInput): Task;
  deleteTask(boardId: string, taskId: string): void;
}

export interface TaskServiceDeps {
  db: Database.Database;
  now: () => Date;
  generateId: () => string;
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
    listTasks(boardId: string): Task[] {
      assertBoardExists(deps.db, boardId);
      return listTaskRows(deps.db, boardId).map(toTask);
    },

    getTask(boardId: string, taskId: string): Task {
      // A missing board and a task belonging to another board both map to 404.
      const row = getTaskRow(deps.db, boardId, taskId);
      if (row === undefined) {
        throw new NotFoundError();
      }
      return toTask(row);
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
          ...toTask(existing),
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          assigneeId: input.assigneeId,
          status: input.status,
          // Any successful PUT refreshes updatedAt, even for identical values.
          updatedAt: deps.now().toISOString(),
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