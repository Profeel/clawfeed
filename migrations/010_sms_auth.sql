-- Add phone column to users
ALTER TABLE users ADD COLUMN phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- SMS OTP table
CREATE TABLE IF NOT EXISTS sms_otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sms_otps_phone ON sms_otps(phone);
