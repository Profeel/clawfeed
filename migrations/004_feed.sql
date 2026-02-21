-- Add slug to users
ALTER TABLE users ADD COLUMN slug TEXT UNIQUE;

-- Add user_id to digests (nullable, NULL = system digest)
ALTER TABLE digests ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_digests_user ON digests(user_id);
