import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load .env
const envPath = join(ROOT, '.env');
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
}

const ADMIN_EMAILS = (env.ADMIN_EMAILS || process.env.ADMIN_EMAILS || '').split(',').filter(Boolean);

let _db;

export function getDb(dbPath) {
  if (_db) return _db;
  const p = dbPath || join(ROOT, 'data', 'digest.db');
  _db = new Database(p);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  // Run migrations
  const sql = readFileSync(join(ROOT, 'migrations', '001_init.sql'), 'utf8');
  _db.exec(sql);
  // Run auth migration (idempotent)
  try {
    const sql2 = readFileSync(join(ROOT, 'migrations', '002_auth.sql'), 'utf8');
    // Execute each statement separately since ALTER TABLE may fail if column exists
    for (const stmt of sql2.split(';').map(s => s.trim()).filter(Boolean)) {
      try { _db.exec(stmt + ';'); } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
  } catch (e) {
    if (!e.message.includes('duplicate column')) console.error('Migration 002:', e.message);
  }
  return _db;
}

// ── Digests ──

export function listDigests(db, { type, limit = 20, offset = 0 } = {}) {
  let sql = 'SELECT id, type, content, metadata, created_at FROM digests';
  const params = [];
  if (type) { sql += ' WHERE type = ?'; params.push(type); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function getDigest(db, id) {
  return db.prepare('SELECT * FROM digests WHERE id = ?').get(id);
}

export function createDigest(db, { type, content, metadata = '{}', created_at }) {
  const sql = created_at
    ? 'INSERT INTO digests (type, content, metadata, created_at) VALUES (?, ?, ?, ?)'
    : 'INSERT INTO digests (type, content, metadata) VALUES (?, ?, ?)';
  const params = created_at ? [type, content, metadata, created_at] : [type, content, metadata];
  const result = db.prepare(sql).run(...params);
  return { id: result.lastInsertRowid };
}

// ── Marks ──

export function listMarks(db, { status, limit = 100, offset = 0, userId, isAdmin } = {}) {
  let sql = 'SELECT * FROM marks';
  const params = [];
  const conditions = [];
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (userId && !isAdmin) { conditions.push('user_id = ?'); params.push(userId); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function createMark(db, { url, title = '', note = '', userId }) {
  // Check duplicate for this user
  const existing = db.prepare('SELECT id FROM marks WHERE url = ? AND user_id = ?').get(url, userId);
  if (existing) return { id: existing.id, duplicate: true };
  const result = db.prepare('INSERT INTO marks (url, title, note, user_id) VALUES (?, ?, ?, ?)').run(url, title, note, userId);
  return { id: result.lastInsertRowid, duplicate: false };
}

export function deleteMark(db, id, userId, isAdmin) {
  if (isAdmin) return db.prepare('DELETE FROM marks WHERE id = ?').run(id);
  return db.prepare('DELETE FROM marks WHERE id = ? AND user_id = ?').run(id, userId);
}

export function migrateMarksToUser(db, userId) {
  return db.prepare('UPDATE marks SET user_id = ? WHERE user_id IS NULL').run(userId);
}

export function updateMarkStatus(db, id, status) {
  return db.prepare('UPDATE marks SET status = ? WHERE id = ?').run(status, id);
}

// ── Auth ──

export function upsertUser(db, { googleId, email, name, avatar }) {
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
  if (existing) {
    db.prepare('UPDATE users SET email = ?, name = ?, avatar = ? WHERE google_id = ?').run(email, name, avatar, googleId);
    return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
  }
  const isAdmin = ADMIN_EMAILS.includes(email) ? 1 : 0;
  db.prepare('INSERT INTO users (google_id, email, name, avatar, is_admin) VALUES (?, ?, ?, ?, ?)').run(googleId, email, name, avatar, isAdmin);
  return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
}

export function createSession(db, { id, userId, expiresAt }) {
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
}

export function getSession(db, sessionId) {
  return db.prepare(`
    SELECT s.*, u.id as uid, u.google_id, u.email, u.name, u.avatar, u.is_admin
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).get(sessionId);
}

export function deleteSession(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// ── Config ──

export function getConfig(db) {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const obj = {};
  for (const r of rows) {
    try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
  }
  return obj;
}

export function setConfig(db, key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, v);
}
