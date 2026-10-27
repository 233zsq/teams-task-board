import type Database from 'better-sqlite3';
import type { Board } from '@team-plan/shared';

export interface BoardRow {
  id: string;
  name: string;
  created_at: string;
}

export interface BoardInsert {
  id: string;
  name: string;
  createdAt: string;
}

export function listBoardRows(db: Database.Database): BoardRow[] {
  return db
    .prepare('SELECT id, name, created_at FROM boards ORDER BY created_at ASC, id ASC')
    .all() as BoardRow[];
}

export function getBoardRow(db: Database.Database, id: string): BoardRow | undefined {
  return db.prepare('SELECT id, name, created_at FROM boards WHERE id = ?').get(id) as
    | BoardRow
    | undefined;
}

export function insertBoardRow(db: Database.Database, board: BoardInsert): void {
  db.prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)').run(
    board.id,
    board.name,
    board.createdAt,
  );
}

export function toBoard(row: BoardRow): Board {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}