import type Database from 'better-sqlite3';

/**
 * Short write transactions only. Business modules decide the boundary; the
 * driver commits on return and rolls back when the callback throws.
 */
export function withWriteTransaction<T>(db: Database.Database, run: () => T): T {
  return db.transaction(run)();
}