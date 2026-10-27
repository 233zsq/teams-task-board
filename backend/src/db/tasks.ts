import type Database from 'better-sqlite3';
import type { Task, TaskStatus } from '@team-plan/shared';

export interface TaskRow {
  id: string;
  board_id: string;
  title: string;
  description: string;
  due_date: string | null;
  assignee_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const TASK_COLUMNS =
  'id, board_id, title, description, due_date, assignee_id, status, created_at, updated_at';

/** P0 order: createdAt then id, ascending (spec §4.3). */
export function listTaskRows(db: Database.Database, boardId: string): TaskRow[] {
  return db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE board_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(boardId) as TaskRow[];
}

export function getTaskRow(
  db: Database.Database,
  boardId: string,
  taskId: string,
): TaskRow | undefined {
  return db
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE board_id = ? AND id = ?`)
    .get(boardId, taskId) as TaskRow | undefined;
}

export function insertTaskRow(db: Database.Database, row: TaskRow): void {
  db.prepare(
    `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.board_id,
    row.title,
    row.description,
    row.due_date,
    row.assignee_id,
    row.status,
    row.created_at,
    row.updated_at,
  );
}

export function updateTaskRow(db: Database.Database, row: TaskRow): number {
  const result = db
    .prepare(
      `UPDATE tasks
         SET title = ?, description = ?, due_date = ?, assignee_id = ?, status = ?, updated_at = ?
       WHERE board_id = ? AND id = ?`,
    )
    .run(
      row.title,
      row.description,
      row.due_date,
      row.assignee_id,
      row.status,
      row.updated_at,
      row.board_id,
      row.id,
    );
  return result.changes;
}

export function deleteTaskRow(
  db: Database.Database,
  boardId: string,
  taskId: string,
): number {
  const result = db.prepare('DELETE FROM tasks WHERE board_id = ? AND id = ?').run(
    boardId,
    taskId,
  );
  return result.changes;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    assigneeId: row.assignee_id,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTaskRow(task: Task): TaskRow {
  return {
    id: task.id,
    board_id: task.boardId,
    title: task.title,
    description: task.description,
    due_date: task.dueDate,
    assignee_id: task.assigneeId,
    status: task.status,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}