import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { applyMigrations } from '../src/db/migrations';
import { createTempDatabase } from './helpers/temp-db';

describe('0002 to priority migration preserves account-era data', () => {
  it('backfills medium, retains ownership/publisher/assignment and does not reset later edits', () => {
    const temp = createTempDatabase(); const db = openDatabase(temp.path);
    try {
      const old = path.join(temp.dir, 'migrations'); fs.mkdirSync(old);
      for (const file of ['0001_p0_schema.sql', '0002_accounts_projects.sql']) fs.copyFileSync(path.resolve('migrations', file), path.join(old, file));
      applyMigrations(db.raw, old);
      db.raw.prepare("INSERT INTO users VALUES ('user-a','user_a','成员甲','fixture-only','old-created')").run();
      db.raw.prepare("INSERT INTO boards(id,name,created_at,owner_id) VALUES ('board-a','原项目','old-created','user-a')").run();
      db.raw.prepare("INSERT INTO board_members VALUES ('board-a','user-a','old-joined')").run();
      db.raw.prepare("INSERT INTO tasks(id,board_id,title,description,due_date,status,created_at,updated_at,created_by,assigned_user_id) VALUES ('task-a','board-a','原任务','原描述','2026-10-28','doing','old-created','old-updated','user-a','user-a')").run();
      const snapshot = db.raw.prepare('SELECT * FROM tasks').get() as Record<string, unknown>;
      expect(applyMigrations(db.raw, path.resolve('migrations')).applied).toEqual(['0003']);
      expect(db.raw.prepare('SELECT * FROM tasks').get()).toEqual({ ...snapshot, priority: 'medium' });
      expect(db.raw.prepare('SELECT owner_id FROM boards').get()).toEqual({ owner_id: 'user-a' });
      expect(db.raw.prepare('SELECT COUNT(*) AS count FROM board_members').get()).toEqual({ count: 1 });
      db.raw.prepare("UPDATE tasks SET priority='high'").run();
      expect(applyMigrations(db.raw, path.resolve('migrations')).applied).toEqual([]);
      expect(db.raw.prepare('SELECT priority FROM tasks').get()).toEqual({ priority: 'high' });
      expect(() => db.raw.prepare("UPDATE tasks SET priority='urgent'").run()).toThrow(/CHECK/);
      expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); temp.cleanup(); }
  });
});
