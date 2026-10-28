import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { initializeDatabase } from '../src/db/initialize';
import {
  applyMigrations,
  assertSchemaCompatible,
  checksumSql,
  discoverMigrations,
  MigrationError,
} from '../src/db/migrations';
import { seedMembers, SEED_MEMBERS, SeedError } from '../src/db/seed';
import { createTempDatabase, type TempDatabase } from './helpers/temp-db';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

function init(temp: TempDatabase, migrationsDir = MIGRATIONS_DIR) {
  return initializeDatabase({
    databasePath: temp.path,
    migrationsDir,
    now: () => '2026-10-21T00:00:00.000Z',
  });
}

describe('P0 migrations and seed', () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it('creates the P0 tables, indexes and four fixed members', () => {
    const result = init(temp);

    expect(result.created).toBe(false);
    expect(result.applied).toEqual(['0001', '0002', '0003']);
    expect(result.currentVersion).toBe('0003');
    expect(result.memberCount).toBe(4);

    const db = openDatabase(temp.path);
    try {
      const tables = db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(
        expect.arrayContaining(['boards', 'members', 'tasks', 'schema_migrations']),
      );

      const indexes = db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(indexes).toEqual(
        expect.arrayContaining(['idx_tasks_board_created', 'idx_tasks_assignee']),
      );

      const members = db.raw
        .prepare('SELECT id, display_name, seed_order FROM members ORDER BY seed_order')
        .all() as { id: string; display_name: string; seed_order: number }[];
      expect(members).toEqual(
        SEED_MEMBERS.map((member) => ({
          id: member.id,
          display_name: member.displayName,
          seed_order: member.seedOrder,
        })),
      );

      const migration = db.raw
        .prepare('SELECT version, checksum, applied_at FROM schema_migrations')
        .get() as { version: string; checksum: string; applied_at: string };
      expect(migration.version).toBe('0001');
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(migration.applied_at).toBe('2026-10-21T00:00:00.000Z');
    } finally {
      db.close();
    }
  });

  it('creates a missing database file during explicit initialization', () => {
    const missingPath = path.join(temp.dir, 'new.sqlite');
    const result = initializeDatabase({
      databasePath: missingPath,
      migrationsDir: MIGRATIONS_DIR,
    });

    expect(result.created).toBe(true);
    expect(fs.existsSync(missingPath)).toBe(true);
  });

  it('is idempotent and preserves existing boards and tasks', () => {
    init(temp);

    const db = openDatabase(temp.path);
    db.raw
      .prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)')
      .run('b1', '课程作业', '2026-10-20T00:00:00.000Z');
    db.raw
      .prepare(
        `INSERT INTO tasks (id, board_id, title, description, due_date, assignee_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        't1',
        'b1',
        '完成接口联调',
        '覆盖创建、编辑和状态修改',
        null,
        null,
        'todo',
        '2026-10-20T00:00:00.000Z',
        '2026-10-20T00:00:00.000Z',
      );
    db.close();

    const second = init(temp);
    expect(second.created).toBe(false);
    expect(second.applied).toEqual([]);
    expect(second.currentVersion).toBe('0003');
    expect(second.memberCount).toBe(4);

    const reopened = openDatabase(temp.path);
    try {
      expect(
        (reopened.raw.prepare('SELECT COUNT(*) AS count FROM boards').get() as { count: number })
          .count,
      ).toBe(1);
      expect(
        (reopened.raw.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number })
          .count,
      ).toBe(1);
      expect(
        (
          reopened.raw
            .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
            .get() as { count: number }
        ).count,
      ).toBe(3);
    } finally {
      reopened.close();
    }
  });
});

describe('database constraints', () => {
  let temp: TempDatabase;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    temp = createTempDatabase();
    init(temp);
    db = openDatabase(temp.path);
    db.raw
      .prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)')
      .run('b1', '课程作业', '2026-10-20T00:00:00.000Z');
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  function insertTask(overrides: {
    id?: string;
    boardId?: string;
    title?: string;
    description?: string;
    dueDate?: string | null;
    assigneeId?: string | null;
    status?: string;
  } = {}) {
    db.raw
      .prepare(
        `INSERT INTO tasks (id, board_id, title, description, due_date, assignee_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        overrides.id ?? 't1',
        overrides.boardId ?? 'b1',
        overrides.title ?? '任务',
        overrides.description ?? '',
        overrides.dueDate ?? null,
        overrides.assigneeId ?? null,
        overrides.status ?? 'todo',
        '2026-10-20T00:00:00.000Z',
        '2026-10-20T00:00:00.000Z',
      );
  }

  it('enforces foreign keys', () => {
    expect(() => insertTask({ boardId: 'missing-board' })).toThrow(/FOREIGN KEY/);
    expect(() => insertTask({ assigneeId: 'missing-member' })).toThrow(/FOREIGN KEY/);

    insertTask({ assigneeId: SEED_MEMBERS[0]!.id });
    expect(() => db.raw.prepare('DELETE FROM boards WHERE id = ?').run('b1')).toThrow(
      /FOREIGN KEY/,
    );
  });

  it('enforces title and description lengths', () => {
    insertTask({ title: 'a'.repeat(100), description: 'a'.repeat(2000) });
    expect(() => insertTask({ id: 't2', title: 'a'.repeat(101) })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertTask({ id: 't3', description: 'a'.repeat(2001) })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertTask({ id: 't4', title: '   ' })).toThrow(/CHECK constraint failed/);
  });

  it('enforces status, board name and due date format', () => {
    expect(() => insertTask({ status: 'blocked' })).toThrow(/CHECK constraint failed/);
    expect(() => insertTask({ dueDate: '2026-2-3' })).toThrow(/CHECK constraint failed/);
    insertTask({ dueDate: '2026-02-03' });

    expect(() =>
      db.raw
        .prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)')
        .run('b2', 'a'.repeat(51), '2026-10-20T00:00:00.000Z'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects a conflicting seed instead of overwriting data', () => {
    db.raw.prepare('DELETE FROM members WHERE id = ?').run(SEED_MEMBERS[0]!.id);
    db.raw
      .prepare('INSERT INTO members (id, display_name, seed_order, created_at) VALUES (?, ?, ?, ?)')
      .run('other-member', '其他成员', 1, '2026-10-20T00:00:00.000Z');

    expect(() => seedMembers(db.raw)).toThrow(SeedError);
  });
});

describe('migration compatibility checks', () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it('rejects a checksum mismatch', () => {
    init(temp);
    const db = openDatabase(temp.path);
    try {
      db.raw.prepare("UPDATE schema_migrations SET checksum = 'deadbeef' WHERE version = '0001'").run();
      expect(() => assertSchemaCompatible(db.raw, MIGRATIONS_DIR)).toThrow(MigrationError);
      expect(() => assertSchemaCompatible(db.raw, MIGRATIONS_DIR)).toThrow(/校验和/);
    } finally {
      db.close();
    }
  });

  it('rejects a missing applied migration file', () => {
    const migrationsDir = path.join(temp.dir, 'migrations');
    fs.mkdirSync(migrationsDir);
    fs.copyFileSync(
      path.join(MIGRATIONS_DIR, '0001_p0_schema.sql'),
      path.join(migrationsDir, '0001_p0_schema.sql'),
    );

    init(temp, migrationsDir);
    const db = openDatabase(temp.path);
    try {
      fs.rmSync(path.join(migrationsDir, '0001_p0_schema.sql'));
      expect(() => assertSchemaCompatible(db.raw, migrationsDir)).toThrow(/缺少文件/);
    } finally {
      db.close();
    }
  });

  it('rejects duplicate and non-contiguous migration numbers', () => {
    const duplicateDir = path.join(temp.dir, 'duplicate');
    fs.mkdirSync(duplicateDir);
    fs.writeFileSync(path.join(duplicateDir, '0001_a.sql'), 'SELECT 1;\n');
    fs.writeFileSync(path.join(duplicateDir, '0001_b.sql'), 'SELECT 1;\n');
    expect(() => discoverMigrations(duplicateDir)).toThrow(/重复/);

    const gapDir = path.join(temp.dir, 'gap');
    fs.mkdirSync(gapDir);
    fs.writeFileSync(path.join(gapDir, '0001_a.sql'), 'SELECT 1;\n');
    fs.writeFileSync(path.join(gapDir, '0003_c.sql'), 'SELECT 1;\n');
    expect(() => discoverMigrations(gapDir)).toThrow(/不连续/);
  });

  it('rejects an applied version without a file', () => {
    init(temp);
    const db = openDatabase(temp.path);
    try {
      db.raw
        .prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)')
        .run('9999', 'a'.repeat(64), '2026-10-21T00:00:00.000Z');
      expect(() => assertSchemaCompatible(db.raw, MIGRATIONS_DIR)).toThrow(/缺少文件/);
    } finally {
      db.close();
    }
  });

  it('reports a pending migration instead of pretending compatibility', () => {
    const migrationsDir = path.join(temp.dir, 'pending');
    fs.mkdirSync(migrationsDir);
    fs.copyFileSync(
      path.join(MIGRATIONS_DIR, '0001_p0_schema.sql'),
      path.join(migrationsDir, '0001_p0_schema.sql'),
    );

    init(temp, migrationsDir);
    fs.writeFileSync(
      path.join(migrationsDir, '0002_extra.sql'),
      'CREATE TABLE extra (id TEXT PRIMARY KEY);\n',
    );

    const db = openDatabase(temp.path);
    try {
      expect(() => assertSchemaCompatible(db.raw, migrationsDir)).toThrow(/版本落后/);
      expect(applyMigrations(db.raw, migrationsDir).applied).toEqual(['0002']);
      expect(() => assertSchemaCompatible(db.raw, migrationsDir)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('rolls back a migration that fails partway through', () => {
    const migrationsDir = path.join(temp.dir, 'failing');
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(
      path.join(migrationsDir, '0001_bad.sql'),
      'CREATE TABLE should_not_exist (id INTEGER);\nINSERT INTO missing_table VALUES (1);\n',
    );

    const db = openDatabase(temp.path);
    try {
      expect(() => applyMigrations(db.raw, migrationsDir)).toThrow();
      const table = db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist'")
        .get();
      expect(table).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('hashes CRLF and LF migration files identically', () => {
    expect(checksumSql('CREATE TABLE a (id TEXT);\r\n')).toBe(
      checksumSql('CREATE TABLE a (id TEXT);\n'),
    );
  });
});
