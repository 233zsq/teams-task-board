import { randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AccountUser } from '@team-plan/shared';
import { AppError } from '../../http/errors';
import { digest, hashPassword, verifyPassword } from './security';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  created_at: string;
}

export function publicUser(row: UserRow): AccountUser {
  return { id: row.id, username: row.username, displayName: row.display_name, createdAt: row.created_at };
}

export function accountService(db: Database.Database, now: () => Date) {
  function byId(id: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  function throttle(key: string, limit: number, windowMs: number): void {
    const timestamp = now().getTime();
    const bucket = digest(key);
    const row = db.prepare('SELECT attempts, reset_at FROM auth_throttles WHERE bucket = ?').get(bucket) as
      { attempts: number; reset_at: number } | undefined;
    if (row && row.reset_at > timestamp && row.attempts >= limit) throw new AppError(429, 'RATE_LIMITED');
    db.prepare('DELETE FROM auth_throttles WHERE reset_at <= ?').run(timestamp);
    db.prepare(`INSERT INTO auth_throttles(bucket, attempts, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1`).run(bucket, timestamp + windowMs);
  }

  function issue(userId: string): string {
    const token = randomBytes(32).toString('hex');
    const timestamp = now().getTime();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(timestamp).toISOString());
    // Keep at most 10 concurrent sessions per account.
    db.prepare(`DELETE FROM sessions WHERE token_hash IN
      (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT -1 OFFSET 9)`).run(userId);
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(digest(token), userId, new Date(timestamp + 7 * 86400000).toISOString());
    return token;
  }

  return {
    throttle,
    issue,
    find(token: string): AccountUser | null {
      if (!/^[a-f0-9]{64}$/.test(token)) return null;
      const row = db.prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), now().toISOString()) as UserRow | undefined;
      return row ? publicUser(row) : null;
    },
    revoke(token: string): void {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
    },
    async register(username: string, displayName: string, password: string): Promise<AccountUser> {
      // Recheck uniqueness in the transaction after the async KDF.
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new AppError(409, 'ACCOUNT_EXISTS');
      const passwordHash = await hashPassword(password);
      return db.transaction(() => {
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new AppError(409, 'ACCOUNT_EXISTS');
        const row: UserRow = { id: randomUUID(), username, display_name: displayName, password_hash: passwordHash, created_at: now().toISOString() };
        db.prepare('INSERT INTO users(id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(row.id, row.username, row.display_name, row.password_hash, row.created_at);
        return publicUser(row);
      })();
    },
    async login(username: string, password: string): Promise<AccountUser> {
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
      if (!(await verifyPassword(password, row?.password_hash)) || !row) throw new AppError(401, 'INVALID_CREDENTIALS');
      // A concurrent password change invalidates an in-flight login.
      if (byId(row.id)?.password_hash !== row.password_hash) throw new AppError(401, 'INVALID_CREDENTIALS');
      return publicUser(row);
    },
    profile(userId: string, displayName: string): AccountUser {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId);
      return publicUser(byId(userId)!);
    },
    async password(userId: string, current: string, next: string): Promise<void> {
      const row = byId(userId)!;
      if (!(await verifyPassword(current, row.password_hash))) throw new AppError(401, 'INVALID_CREDENTIALS');
      const hash = await hashPassword(next);
      db.transaction(() => {
        const changed = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?')
          .run(hash, userId, row.password_hash);
        if (!changed.changes) throw new AppError(401, 'INVALID_CREDENTIALS');
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      })();
    },
  };
}

export type AccountService = ReturnType<typeof accountService>;
