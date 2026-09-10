CREATE TABLE IF NOT EXISTS user_channels (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  feishu_webhook TEXT,
  feishu_secret TEXT,
  feishu_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
