ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high'));
CREATE INDEX idx_tasks_board_priority ON tasks(board_id, priority);
CREATE INDEX idx_tasks_board_due ON tasks(board_id, due_date);
CREATE INDEX idx_tasks_board_user_assignee ON tasks(board_id, assigned_user_id);
CREATE INDEX idx_tasks_board_legacy_assignee ON tasks(board_id, assignee_id);
