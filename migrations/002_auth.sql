CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE,
  email TEXT,
  name TEXT,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_admin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Add user_id to marks (nullable for migration)
ALTER TABLE marks ADD COLUMN user_id INTEGER REFERENCES users(id);
