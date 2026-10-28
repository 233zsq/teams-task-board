import type Database from 'better-sqlite3';
import type { Task, TaskStatus, TaskPriority, TaskFilters } from '@team-plan/shared';

export interface TaskRow {
  id: string;
  board_id: string;
  title: string;
  description: string;
  due_date: string | null;
  assignee_id: string | null;
  assigned_user_id?: string | null;
  priority?: TaskPriority;
  status: string;
  created_at: string;
  updated_at: string;
}

const TASK_COLUMNS =
  'id, board_id, title, description, due_date, assignee_id, status, created_at, updated_at, assigned_user_id, priority';

/** P0 order: createdAt then id, ascending (spec §4.3). */
export function listTaskRows(db: Database.Database, boardId: string, filters: TaskFilters = {}): TaskRow[] {
  const clauses = ['board_id = ?'];
  const values: string[] = [boardId];
  if (filters.q) {
    clauses.push('instr(lower(title || char(10) || description), lower(?)) > 0');
    values.push(filters.q);
  }
  if (filters.assigneeId === 'unassigned') clauses.push('assigned_user_id IS NULL AND assignee_id IS NULL');
  else if (filters.assigneeId) { clauses.push('COALESCE(assigned_user_id, assignee_id) = ?'); values.push(filters.assigneeId); }
  if (filters.priority) { clauses.push('priority = ?'); values.push(filters.priority); }
  if (filters.dueFrom) { clauses.push('due_date >= ?'); values.push(filters.dueFrom); }
  if (filters.dueTo) { clauses.push('due_date <= ?'); values.push(filters.dueTo); }
  return db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC, id ASC`,
    )
    .all(...values) as TaskRow[];
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
    `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.board_id,
    row.title,
    row.description,
    row.due_date,
    db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.assignee_id) ? null : row.assignee_id,
    row.status,
    row.created_at,
    row.updated_at,
    db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.assignee_id) ? row.assignee_id : null,
    row.priority ?? 'medium',
  );
}

export function updateTaskRow(db: Database.Database, row: TaskRow): number {
  const result = db
    .prepare(
      `UPDATE tasks
         SET title = ?, description = ?, due_date = ?, assignee_id = ?, status = ?, updated_at = ?, assigned_user_id = ?, priority = COALESCE(?, priority)
       WHERE board_id = ? AND id = ?`,
    )
    .run(
      row.title,
      row.description,
      row.due_date,
      db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.assignee_id) ? null : row.assignee_id,
      row.status,
      row.updated_at,
      db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.assignee_id) ? row.assignee_id : null,
      row.priority ?? null,
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

export function toTask(row: TaskRow, includePriority = false): Task {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    assigneeId: row.assigned_user_id ?? row.assignee_id,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includePriority ? { priority: row.priority ?? 'medium' } : {}),
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
    ...(task.priority === undefined ? {} : { priority: task.priority }),
  };
}
