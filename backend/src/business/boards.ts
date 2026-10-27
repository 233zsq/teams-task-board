import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '../db/connection';
import { AppError } from '../http/errors';
import { validateBoardName, validateTaskInput, type Board, type Member, type Task, type TaskStatus } from '@team-plan/shared';

const BOARD_COLUMNS = 'id, name, created_at AS createdAt';
const TASK_COLUMNS = `id, board_id AS boardId, title, description, due_date AS dueDate,
  assignee_id AS assigneeId, status, created_at AS createdAt, updated_at AS updatedAt`;

/** Concrete business boundary. No HTTP objects, generic repository, or memory fallback. */
export function createBoardService(db: DatabaseHandle) {
  function getBoard(id: string): Board {
    const board = db.raw.prepare(`SELECT ${BOARD_COLUMNS} FROM boards WHERE id = ?`).get(id) as Board | undefined;
    if (!board) throw new AppError(404, 'NOT_FOUND');
    return board;
  }
  function getTask(boardId: string, taskId: string): Task {
    const task = db.raw.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE board_id = ? AND id = ?`)
      .get(boardId, taskId) as Task | undefined;
    if (!task) throw new AppError(404, 'NOT_FOUND');
    return task;
  }
  return {
    getBoard, getTask,
    listBoards: () => db.raw.prepare(`SELECT ${BOARD_COLUMNS} FROM boards ORDER BY created_at, id`).all() as Board[],
    listMembers: () => db.raw.prepare('SELECT id, display_name AS displayName FROM members ORDER BY seed_order').all() as Member[],
    listTasks(boardId: string): Task[] {
      getBoard(boardId);
      return db.raw.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE board_id = ? ORDER BY created_at, id`).all(boardId) as Task[];
    },
    createBoard(input: Record<string, unknown>): Board {
      const error = typeof input.name === 'string' ? validateBoardName(input.name) : '请输入看板名称';
      if (error) throw new AppError(422, 'VALIDATION_ERROR', { fields: { name: error } });
      const board: Board = { id: randomUUID(), name: (input.name as string).trim(), createdAt: new Date().toISOString() };
      db.raw.prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)').run(board.id, board.name, board.createdAt);
      return board;
    },
    createTask(boardId: string, input: Record<string, unknown>): Task {
      const fields = validateTaskInput(input);
      if (Object.keys(fields).length) throw new AppError(422, 'VALIDATION_ERROR', { fields });
      return db.raw.transaction(() => {
        getBoard(boardId);
        const assigneeId = typeof input.assigneeId === 'string' ? input.assigneeId.toLowerCase() : null;
        if (assigneeId && !db.raw.prepare('SELECT id FROM members WHERE id = ?').get(assigneeId)) {
          throw new AppError(422, 'VALIDATION_ERROR', { fields: { assigneeId: '负责人不存在，请刷新成员列表' } });
        }
        const now = new Date().toISOString();
        const task: Task = {
          id: randomUUID(), boardId, title: (input.title as string).trim(),
          description: input.description === undefined ? '' : input.description as string,
          dueDate: input.dueDate === undefined ? null : input.dueDate as string | null,
          assigneeId, status: input.status === undefined ? 'todo' : input.status as TaskStatus,
          createdAt: now, updatedAt: now,
        };
        db.raw.prepare(`INSERT INTO tasks (id, board_id, title, description, due_date, assignee_id, status, created_at, updated_at)
          VALUES (@id, @boardId, @title, @description, @dueDate, @assigneeId, @status, @createdAt, @updatedAt)`).run(task);
        return task;
      })();
    },
  };
}
