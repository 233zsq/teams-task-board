import type Database from 'better-sqlite3';
import type { Board, Member, ProjectActivity, ProjectMember, Task } from '@team-plan/shared';
import { AppError } from '../../http/errors';

export function projectService(db: Database.Database, now: () => Date) {
  function access(boardId: string, userId: string, ownerOnly = false): void {
    const board = db.prepare(`SELECT b.owner_id FROM boards b JOIN board_members m ON m.board_id = b.id
      WHERE b.id = ? AND m.user_id = ?`).get(boardId, userId) as { owner_id: string } | undefined;
    if (!board) throw new AppError(404, 'NOT_FOUND');
    if (ownerOnly && board.owner_id !== userId) throw new AppError(403, 'ACCESS_DENIED');
  }
  function log(boardId: string, actorId: string, action: string, subject: string): void {
    db.prepare('INSERT INTO project_activity(board_id, actor_id, action, subject, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(boardId, actorId, action, subject, now().toISOString());
  }
  function members(boardId: string): ProjectMember[] {
    return db.prepare(`SELECT u.id, u.username, u.display_name AS displayName, u.created_at AS createdAt,
      CASE WHEN b.owner_id = u.id THEN 'owner' ELSE 'member' END AS role
      FROM board_members m JOIN users u ON u.id = m.user_id JOIN boards b ON b.id = m.board_id
      WHERE m.board_id = ? ORDER BY CASE WHEN b.owner_id = u.id THEN 0 ELSE 1 END, m.joined_at, u.id`)
      .all(boardId) as ProjectMember[];
  }
  return {
    access, log, members,
    visible(boardId: string, userId: string): boolean {
      return !!db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId);
    },
    board(board: Board, userId: string): Board {
      const list = members(board.id);
      const owner = list.find((member) => member.role === 'owner');
      return { ...board, owner: owner ? { id: owner.id, displayName: owner.displayName } : null,
        memberCount: list.length, role: owner?.id === userId ? 'owner' : 'member' };
    },
    task(task: Task): Task {
      const creator = db.prepare(`SELECT u.id, u.display_name AS displayName FROM tasks t
        JOIN users u ON u.id = t.created_by WHERE t.id = ?`).get(task.id) as Member | undefined;
      return { ...task, createdBy: creator ?? null };
    },
    attachBoard(board: Board, userId: string): void {
      db.prepare('UPDATE boards SET owner_id = ? WHERE id = ?').run(userId, board.id);
      db.prepare('INSERT INTO board_members(board_id, user_id, joined_at) VALUES (?, ?, ?)').run(board.id, userId, now().toISOString());
      log(board.id, userId, 'project.created', board.name);
    },
    attachTask(task: Task, userId: string): void {
      db.prepare('UPDATE tasks SET created_by = ? WHERE id = ?').run(userId, task.id);
      log(task.boardId, userId, 'task.created', task.title);
    },
    assignee(boardId: string, assigneeId: string | null, previous?: string | null): void {
      if (assigneeId === null) return;
      if (db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, assigneeId)) return;
      // Preserve a legacy task's existing demo assignee during ordinary edits.
      if (assigneeId === previous && db.prepare('SELECT 1 FROM members WHERE id = ?').get(assigneeId)) return;
      throw new AppError(422, 'VALIDATION_ERROR', { fields: { assigneeId: '请选择当前项目成员' } });
    },
    assignable(boardId: string): Member[] {
      const real = members(boardId).map(({ id, displayName }) => ({ id, displayName }));
      const legacy = db.prepare(`SELECT DISTINCT m.id, m.display_name AS displayName FROM members m
        JOIN tasks t ON t.assignee_id = m.id WHERE t.board_id = ? ORDER BY m.seed_order`).all(boardId) as Member[];
      return [...real, ...legacy];
    },
    directory(userId: string): Member[] {
      return db.prepare(`SELECT DISTINCT u.id, u.display_name AS displayName FROM users u
        WHERE u.id = ? OR EXISTS (SELECT 1 FROM board_members a JOIN board_members b ON a.board_id = b.board_id
          WHERE a.user_id = ? AND b.user_id = u.id) ORDER BY u.created_at, u.id`).all(userId, userId) as Member[];
    },
    add(boardId: string, actorId: string, username: string): void {
      db.transaction(() => {
        access(boardId, actorId, true);
        const user = db.prepare('SELECT id, display_name FROM users WHERE username = ?').get(username) as { id: string; display_name: string } | undefined;
        if (!user) throw new AppError(422, 'VALIDATION_ERROR', { fields: { username: '该账号尚未注册，请对方先注册' } });
        const inserted = db.prepare('INSERT OR IGNORE INTO board_members(board_id, user_id, joined_at) VALUES (?, ?, ?)')
          .run(boardId, user.id, now().toISOString());
        if (inserted.changes) log(boardId, actorId, 'member.added', user.display_name);
      })();
    },
    remove(boardId: string, actorId: string, userId: string): void {
      db.transaction(() => {
        access(boardId, actorId, true);
        const target = members(boardId).find((member) => member.id === userId);
        if (!target) throw new AppError(404, 'NOT_FOUND');
        if (target.role === 'owner') throw new AppError(422, 'VALIDATION_ERROR', { fields: { userId: '请先转交项目负责人' } });
        db.prepare('UPDATE tasks SET assigned_user_id = NULL, updated_at = ? WHERE board_id = ? AND assigned_user_id = ?')
          .run(now().toISOString(), boardId, userId);
        db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, userId);
        log(boardId, actorId, 'member.removed', target.displayName);
      })();
    },
    transfer(boardId: string, actorId: string, userId: string): void {
      db.transaction(() => {
        access(boardId, actorId, true);
        const target = members(boardId).find((member) => member.id === userId);
        if (!target) throw new AppError(422, 'VALIDATION_ERROR', { fields: { userId: '请选择当前项目成员' } });
        if (target.role === 'owner') return;
        db.prepare('UPDATE boards SET owner_id = ? WHERE id = ?').run(userId, boardId);
        log(boardId, actorId, 'owner.transferred', target.displayName);
      })();
    },
    activity(boardId: string): ProjectActivity[] {
      const rows = db.prepare(`SELECT a.id, a.action, a.subject, a.created_at AS createdAt,
        u.id AS actorId, u.display_name AS actorName FROM project_activity a JOIN users u ON u.id = a.actor_id
        WHERE a.board_id = ? ORDER BY a.id DESC LIMIT 50`).all(boardId) as
        (Omit<ProjectActivity, 'actor'> & { actorId: string; actorName: string })[];
      return rows.map(({ actorId, actorName, ...row }) => ({ ...row, actor: { id: actorId, displayName: actorName } }));
    },
  };
}
export type ProjectService = ReturnType<typeof projectService>;
