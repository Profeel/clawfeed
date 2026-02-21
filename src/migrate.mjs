#!/usr/bin/env node
/**
 * Migrate existing digest files and marks.json into SQLite.
 * Usage: node src/migrate.mjs [digestsDir]
 * Default digestsDir: ../digests (relative to repo root)
 */
import { readFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, createDigest, createMark, updateMarkStatus } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const digestsDir = process.argv[2] || join(ROOT, '..', 'digests');
const DB_PATH = join(ROOT, 'data', 'digest.db');
mkdirSync(join(ROOT, 'data'), { recursive: true });

const db = getDb(DB_PATH);

console.log(`📂 Migrating from: ${digestsDir}`);
console.log(`💾 Database: ${DB_PATH}`);

// ── Migrate digest markdown files ──
const types = ['4h', 'daily', 'weekly', 'monthly'];
let digestCount = 0;

for (const type of types) {
  const dir = join(digestsDir, type);
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch { continue; }

  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    const name = file.replace('.md', '');

    // Parse created_at from filename
    let created_at;
    if (type === '4h') {
      // 2026-02-19-1237 → 2026-02-19T12:37:00+08:00
      const m = name.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/);
      if (m) created_at = `${m[1]}T${m[2]}:${m[3]}:00`;
    } else if (type === 'daily') {
      created_at = `${name}T23:59:00`;
    } else if (type === 'weekly') {
      // 2026-W07 → just store as-is
      created_at = name;
    } else {
      created_at = name;
    }

    const metadata = JSON.stringify({ source_file: file });
    createDigest(db, { type, content, metadata, created_at });
    digestCount++;
  }
}

console.log(`✅ Migrated ${digestCount} digests`);

// ── Migrate marks.json ──
let markCount = 0;
try {
  const marksPath = join(digestsDir, 'marks.json');
  const data = JSON.parse(readFileSync(marksPath, 'utf8'));

  // Build processed set
  const processedUrls = new Set();
  if (data.history) {
    for (const h of data.history) {
      if (h.action === 'processed') processedUrls.add(h.target);
    }
  }

  // Import marks from history (action=mark entries)
  const markEntries = (data.history || []).filter(h => h.action === 'mark');
  for (const entry of markEntries) {
    const url = entry.target;
    const result = createMark(db, { url });
    if (!result.duplicate && processedUrls.has(url)) {
      updateMarkStatus(db, result.id, 'processed');
    }
    markCount++;
  }

  // Also import pending tweets not yet in history
  if (data.tweets) {
    for (const t of data.tweets) {
      const result = createMark(db, { url: t.url });
      if (!result.duplicate) markCount++;
    }
  }
} catch (e) {
  console.log(`⚠️  marks.json migration: ${e.message}`);
}

console.log(`✅ Migrated ${markCount} marks`);
console.log('🎉 Migration complete!');
