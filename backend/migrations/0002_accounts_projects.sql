-- Preserve legacy members/tasks; real users use a separate assignee column.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 30),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
ALTER TABLE boards ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN assigned_user_id TEXT REFERENCES users(id);
CREATE TABLE board_members (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(board_id, user_id)
);
CREATE INDEX idx_board_members_user ON board_members(user_id, board_id);
CREATE TABLE project_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_project_activity_board ON project_activity(board_id, id DESC);
CREATE TABLE auth_throttles (
  bucket TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
