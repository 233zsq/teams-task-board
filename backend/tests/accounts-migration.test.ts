import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { applyMigrations } from '../src/db/migrations';
import { initializeDatabase } from '../src/db/initialize';
import { seedMembers, SEED_MEMBERS } from '../src/db/seed';
import { claimLegacyProjects } from '../src/modules/projects/claim';
import { createTempDatabase } from './helpers/temp-db';

describe('0001 to account projects migration', () => {
  it('preserves legacy values and requires an explicit existing account to claim history', () => {
    const temp = createTempDatabase();
    const old = path.join(temp.dir, 'old-migrations');
    fs.mkdirSync(old);
    fs.copyFileSync(path.resolve('migrations/0001_p0_schema.sql'), path.join(old, '0001_p0_schema.sql'));
    const db = openDatabase(temp.path);
    try {
      applyMigrations(db.raw, old); seedMembers(db.raw);
      db.raw.prepare("INSERT INTO boards(id,name,created_at) VALUES ('old-board','旧项目','2026-01-01')").run();
      db.raw.prepare(`INSERT INTO tasks(id,board_id,title,description,due_date,assignee_id,status,created_at,updated_at)
        VALUES ('old-task','old-board','旧任务','原描述','2026-10-28',?,'doing','old-created','old-updated')`).run(SEED_MEMBERS[0]!.id);
      const snapshot = db.raw.prepare('SELECT * FROM tasks').get() as Record<string, unknown>;
      expect(applyMigrations(db.raw, path.resolve('migrations')).applied).toEqual(['0002']);
      expect(db.raw.prepare('SELECT * FROM tasks').get()).toEqual({ ...snapshot, created_by: null, assigned_user_id: null });
      expect(db.raw.prepare('SELECT owner_id FROM boards').get()).toEqual({ owner_id: null });
      expect(() => claimLegacyProjects(db.raw, 'missing')).toThrow('尚未注册');
      db.raw.prepare("INSERT INTO users(id,username,display_name,password_hash,created_at) VALUES ('operator','operator','指定负责人','unused-fixture','now')").run();
      // Creating an account itself never claims legacy data.
      expect(db.raw.prepare('SELECT COUNT(*) AS count FROM board_members').get()).toEqual({ count: 0 });
      expect(claimLegacyProjects(db.raw, 'operator')).toBe(1);
      expect(claimLegacyProjects(db.raw, 'operator')).toBe(0);
      expect(db.raw.prepare('SELECT * FROM tasks').get()).toEqual({ ...snapshot, created_by: null, assigned_user_id: null });
      expect(initializeDatabase({ databasePath: temp.path, migrationsDir: path.resolve('migrations') }).applied).toEqual([]);
      expect(db.raw.pragma('foreign_key_check')).toEqual([]);
      expect(db.raw.prepare('SELECT owner_id FROM boards').get()).toEqual({ owner_id: 'operator' });
    } finally { db.close(); temp.cleanup(); }
  });
});
