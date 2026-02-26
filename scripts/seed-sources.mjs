#!/usr/bin/env node
/**
 * 初始化默认信息源
 * 用法: node scripts/seed-sources.mjs
 *
 * 会向数据库写入一批常用的公开信息源（HN、Reddit、RSS 等）。
 * 重复运行是安全的（已存在的源会被跳过）。
 */

import { existsSync, readFileSync } from 'fs';
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
    if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}

const dbPath = process.env.DIGEST_DB || env.DIGEST_DB || join(ROOT, 'data', 'digest.db');

if (!existsSync(dbPath)) {
  console.error('❌ 数据库不存在，请先启动服务器: npm start');
  process.exit(1);
}

const { default: Database } = await import('better-sqlite3');
const db = new Database(dbPath);

const DEFAULT_SOURCES = [
  // ── AI / 技术 RSS ─────────────────────────────────────────────────────────
  {
    name: 'The Verge - AI',
    type: 'rss',
    config: { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  },
  {
    name: 'MIT Technology Review',
    type: 'rss',
    config: { url: 'https://www.technologyreview.com/feed/' },
  },
  {
    name: 'TechCrunch AI',
    type: 'rss',
    config: { url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  },
  {
    name: 'Wired',
    type: 'rss',
    config: { url: 'https://www.wired.com/feed/rss' },
  },
  {
    name: 'Simon Willison Blog',
    type: 'rss',
    config: { url: 'https://simonwillison.net/atom/everything/' },
  },
  {
    name: 'OpenAI Blog',
    type: 'rss',
    config: { url: 'https://openai.com/blog/rss.xml' },
  },
  {
    name: 'DeepMind Blog',
    type: 'rss',
    config: { url: 'https://deepmind.google/blog/rss.xml' },
  },
  // ── Hacker News ───────────────────────────────────────────────────────────
  {
    name: 'Hacker News 热榜',
    type: 'hackernews',
    config: { filter: 'top', min_score: 100, limit: 20 },
  },
  // ── Reddit ────────────────────────────────────────────────────────────────
  {
    name: 'r/artificial',
    type: 'reddit',
    config: { subreddit: 'artificial', sort: 'hot', limit: 15 },
  },
  {
    name: 'r/LocalLLaMA',
    type: 'reddit',
    config: { subreddit: 'LocalLLaMA', sort: 'hot', limit: 15 },
  },
  {
    name: 'r/MachineLearning',
    type: 'reddit',
    config: { subreddit: 'MachineLearning', sort: 'hot', limit: 10 },
  },
  // ── GitHub Trending ───────────────────────────────────────────────────────
  {
    name: 'GitHub Trending',
    type: 'github_trending',
    config: { language: 'all', since: 'daily' },
  },
  {
    name: 'GitHub Trending Python',
    type: 'github_trending',
    config: { language: 'python', since: 'daily' },
  },
];

const insertStmt = db.prepare(
  'INSERT OR IGNORE INTO sources (name, type, config, is_active, is_public) VALUES (?, ?, ?, 1, 1)'
);

let added = 0;
let skipped = 0;

console.log('正在写入默认信息源...\n');
for (const source of DEFAULT_SOURCES) {
  const configStr = JSON.stringify(source.config);
  // Check if already exists (by type + config)
  const existing = db.prepare('SELECT id FROM sources WHERE type = ? AND config = ?').get(source.type, configStr);
  if (existing) {
    console.log(`  ⏭  已存在: ${source.name}`);
    skipped++;
  } else {
    insertStmt.run(source.name, source.type, configStr);
    console.log(`  ✅ 添加: ${source.name}`);
    added++;
  }
}

db.close();

console.log(`\n完成！新增 ${added} 个，跳过 ${skipped} 个（已存在）。`);
console.log('\n现在可以运行 Digest 生成:');
console.log('  npm run digest');
