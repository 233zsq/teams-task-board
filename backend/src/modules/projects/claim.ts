import type Database from 'better-sqlite3';
import { projectService } from './service';

/** Operator-only migration: never runs automatically on registration. */
export function claimLegacyProjects(db: Database.Database, username: string, now = () => new Date()): number {
  return db.transaction(() => {
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined;
    if (!user) throw new Error('指定账号尚未注册，未变更任何项目');
    const boards = db.prepare('SELECT id FROM boards WHERE owner_id IS NULL').all() as { id: string }[];
    const projects = projectService(db, now);
    for (const board of boards) {
      db.prepare('UPDATE boards SET owner_id = ? WHERE id = ? AND owner_id IS NULL').run(user.id, board.id);
      db.prepare('INSERT INTO board_members(board_id, user_id, joined_at) VALUES (?, ?, ?)').run(board.id, user.id, now().toISOString());
      projects.log(board.id, user.id, 'project.claimed', '历史项目由维护人指定负责人');
    }
    return boards.length;
  })();
}
