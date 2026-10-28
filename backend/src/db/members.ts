import type Database from 'better-sqlite3';
import type { Member } from '@team-plan/shared';

export interface MemberRow {
  id: string;
  display_name: string;
  seed_order: number;
  created_at: string;
}

export function listMemberRows(db: Database.Database): MemberRow[] {
  return db
    .prepare(
      'SELECT id, display_name, seed_order, created_at FROM members ORDER BY seed_order ASC',
    )
    .all() as MemberRow[];
}

export function memberExists(db: Database.Database, id: string): boolean {
  const row = db.prepare('SELECT 1 AS present FROM members WHERE id = ?').get(id);
  return row !== undefined || db.prepare('SELECT 1 FROM users WHERE id = ?').get(id) !== undefined;
}

export function toMember(row: MemberRow): Member {
  return { id: row.id, displayName: row.display_name };
}
