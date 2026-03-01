-- Track pushed items to avoid duplicate Feishu notifications
CREATE TABLE IF NOT EXISTS pushed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_hash TEXT NOT NULL,
  title_hash TEXT NOT NULL,
  title TEXT,
  url TEXT,
  digest_type TEXT NOT NULL,
  pushed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pushed_url_hash ON pushed_items(url_hash);
CREATE INDEX IF NOT EXISTS idx_pushed_title_hash ON pushed_items(title_hash);
CREATE INDEX IF NOT EXISTS idx_pushed_at ON pushed_items(pushed_at);
