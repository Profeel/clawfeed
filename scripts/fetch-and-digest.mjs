#!/usr/bin/env node
/**
 * ClawFeed 采集 + Digest 生成脚本
 *
 * 用法:
 *   node scripts/fetch-and-digest.mjs [--type 4h|daily|weekly|monthly] [--deep]
 *
 * 支持的 Source 类型:
 *   rss / atom       — RSS / Atom 订阅
 *   hackernews       — Hacker News 热门帖
 *   reddit           — Subreddit 热门帖
 *   github_trending  — GitHub Trending
 *   twitter_feed     — X/Twitter 用户时间线（通过 Nitter RSS，config: { username: "@handle", limit: 20 }）
 *   twitter_list     — X/Twitter 列表（通过 Nitter RSS，config: { url: "https://x.com/i/lists/...", limit: 20 }）
 *
 * 需要 .env 中配置:
 *   API_KEY          — ClawFeed 服务 API Key
 *   DEEPSEEK_API_KEY — SiliconFlow DeepSeek API Key
 *
 * --deep 模式: 对 Digest 精选的每篇文章抓取原文，生成 250 字中文深度摘要
 */

import https from 'https';
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHmac, createHash } from 'crypto';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load .env ──────────────────────────────────────────────────────────────
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

const API_KEY = env.API_KEY || process.env.API_KEY || '';
const DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const PORT = parseInt(env.DIGEST_PORT || process.env.DIGEST_PORT || '8767', 10);
const PROXY_URL = env.HTTP_PROXY || env.HTTPS_PROXY || env.http_proxy || env.https_proxy
  || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy || '';
const FEISHU_WEBHOOK = env.FEISHU_WEBHOOK || process.env.FEISHU_WEBHOOK || '';
const FEISHU_SECRET = env.FEISHU_SECRET || process.env.FEISHU_SECRET || '';
const RSSHUB_URL = (env.RSSHUB_URL || process.env.RSSHUB_URL || '').replace(/\/+$/, '');
const MAX_ARTICLE_AGE_HOURS = parseInt(env.MAX_ARTICLE_AGE_HOURS || process.env.MAX_ARTICLE_AGE_HOURS || '72', 10);

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag) => {
  const eqIdx = args.findIndex(a => a.startsWith(`${flag}=`));
  if (eqIdx !== -1) return args[eqIdx].split('=').slice(1).join('=');
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

const DIGEST_TYPE = getArg('--type') || '4h';
const DEEP_MODE = args.includes('--deep');
const VALID_TYPES = ['4h', 'daily', 'weekly', 'monthly'];
if (!VALID_TYPES.includes(DIGEST_TYPE)) {
  console.error(`错误: --type 必须是 ${VALID_TYPES.join(' | ')} 之一`);
  process.exit(1);
}

// ── Logger ─────────────────────────────────────────────────────────────────
const log = (...a) => console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}]`, ...a);
const warn = (...a) => console.warn(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ⚠️`, ...a);

// ── HTTP helpers ───────────────────────────────────────────────────────────
const FETCH_TIMEOUT = 15000;

// Build proxy dispatcher once (reuse across requests)
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : null;

async function httpFetch(url, { headers = {}, timeout = FETCH_TIMEOUT, maxBytes = 600000 } = {}) {
  const readBody = async (res) => {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > maxBytes) { reader.cancel(); break; }
    }
    return {
      status: res.status,
      body: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8'),
      headers: Object.fromEntries(res.headers),
    };
  };

  const attempt = async (useProxy) => {
    const opts = {
      headers: { 'User-Agent': 'ClawFeed-Fetcher/1.0', ...headers },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    };
    if (useProxy && proxyDispatcher) opts.dispatcher = proxyDispatcher;
    const res = await undiciFetch(url, opts);
    return readBody(res);
  };

  if (!proxyDispatcher) return attempt(false);

  try {
    return await attempt(true);
  } catch (e) {
    // 代理层引发的连接错误时回退到直连（适用于直连可达但代理有干扰的站点）
    const code = e.cause?.code || e.code || '';
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT'
      || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_SOCKET') {
      return attempt(false);
    }
    throw e;
  }
}

// POST JSON to any HTTPS URL (used for Feishu webhook)
async function postJson(url, body) {
  const payload = JSON.stringify(body);

  const readBody = async (res) => {
    const reader = res.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return { status: res.status, body: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8') };
  };

  const attempt = (useProxy) => {
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ClawFeed-Bot/1.0' },
      body: payload,
      signal: AbortSignal.timeout(10000),
    };
    if (useProxy && proxyDispatcher) opts.dispatcher = proxyDispatcher;
    return undiciFetch(url, opts).then(readBody);
  };

  if (!proxyDispatcher) return attempt(false);

  try {
    return await attempt(true);
  } catch (e) {
    const code = e.cause?.code || e.code || '';
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT'
      || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_SOCKET') {
      return attempt(false);
    }
    throw e;
  }
}

// ── Feishu / Lark Webhook Push ─────────────────────────────────────────────

function buildFeishuSign() {
  if (!FEISHU_SECRET) return {};
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${FEISHU_SECRET}`;
  const sign = createHmac('sha256', stringToSign).update('').digest('base64');
  return { timestamp, sign };
}

async function postFeishu(card) {
  const body = { msg_type: 'interactive', card, ...buildFeishuSign() };
  try {
    const resp = await postJson(FEISHU_WEBHOOK, body);
    const result = JSON.parse(resp.body);
    if (result.code !== 0 && result.StatusCode !== 0) {
      warn(`飞书推送失败: ${result.msg || result.StatusMessage || JSON.stringify(result)}`);
      return false;
    }
    return true;
  } catch (e) {
    warn(`飞书推送异常: ${e.message}`);
    return false;
  }
}

// Build a card for a single article
function buildArticleCard(item, index, total) {
  const isHot = item.category === '重要动态';
  const tag = isHot ? '🔥' : '📰';
  const headerColor = isHot ? 'red' : 'turquoise';

  return {
    header: {
      title: { tag: 'plain_text', content: `${tag} ${item.title || '(无标题)'}` },
      template: headerColor,
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: item.summary || '暂无解读',
        },
      },
      {
        tag: 'note',
        elements: [
          { tag: 'lark_md', content: `${item.source || '-'}　·　[阅读原文](${item.url || '#'})　·　${index}/${total}` },
        ],
      },
    ],
  };
}

// Build a summary header card
function buildHeaderCard(items, meta) {
  const hotCount = items.filter(i => i.category === '重要动态').length;
  const otherCount = items.length - hotCount;
  const typeLabels = { '4h': '4小时简报', daily: '日报', weekly: '周报', monthly: '月报' };
  const typeLabel = typeLabels[meta.digestType] || '简报';

  const toc = items.map((item, n) => {
    const tag = item.category === '重要动态' ? '🔥' : '·';
    return `${tag} ${item.title}`;
  }).join('\n');

  return {
    header: {
      title: { tag: 'plain_text', content: `☀️ ClawFeed ${typeLabel} | ${meta.dateStr || ''}` },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `🔥 ${hotCount} 条重要动态　·　📰 ${otherCount} 条精选资讯\n\n${toc}`,
        },
      },
    ],
  };
}

// Send each article as an individual Feishu card
async function sendFeishuArticles(items, meta) {
  if (!FEISHU_WEBHOOK || !items?.length) return;

  log(`\n正在推送 ${items.length} 条到飞书...`);

  const headerSent = await postFeishu(buildHeaderCard(items, meta));
  if (headerSent) process.stdout.write('  ✓ 目录卡片\n');
  await sleep(600);

  let ok = 0;
  for (let i = 0; i < items.length; i++) {
    const card = buildArticleCard(items[i], i + 1, items.length);
    const sent = await postFeishu(card);
    if (sent) {
      ok++;
      process.stdout.write(`  ✓ [${i + 1}/${items.length}] ${items[i].title?.slice(0, 30) || '-'}\n`);
    } else {
      process.stdout.write(`  ✗ [${i + 1}/${items.length}] 推送失败\n`);
    }
    if (i < items.length - 1) await sleep(600);
  }

  log(`✅ 飞书推送完成（${ok}/${items.length}）`);
}

// Fallback: send whole content as plain text (used when no structured items)
async function sendFeishuNotification(content) {
  if (!FEISHU_WEBHOOK) return;
  const text = content.length > 4000
    ? content.slice(0, 4000) + '\n\n…（内容已截断）'
    : content;
  const msgBody = { msg_type: 'text', content: { text }, ...buildFeishuSign() };
  try {
    const resp = await postJson(FEISHU_WEBHOOK, msgBody);
    const result = JSON.parse(resp.body);
    if (result.code === 0 || result.StatusCode === 0) {
      log('✅ 飞书推送成功');
    } else {
      warn(`飞书推送失败: ${result.msg || result.StatusMessage || JSON.stringify(result)}`);
    }
  } catch (e) {
    warn(`飞书推送异常: ${e.message}`);
  }
}

// POST to local ClawFeed API
function localPost(path, data, extraHeaders = {}) {
  const payload = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...extraHeaders,
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Local API timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── RSS / Atom Parser ──────────────────────────────────────────────────────
function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function xmlText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:[^>]*)>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m ? stripHtml(m[1].trim()) : '';
}

function xmlAttr(block, tag, attr) {
  const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i'));
  return m ? m[1].trim() : '';
}

async function fetchRss(url, limit = 20) {
  const { body } = await httpFetch(url);
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(body)) && items.length < limit) {
    const block = m[1] || m[2];
    const title = xmlText(block, 'title');
    const link =
      xmlText(block, 'link') ||
      xmlAttr(block, 'link', 'href') ||
      xmlText(block, 'id');
    const description = (
      xmlText(block, 'content:encoded') ||
      xmlText(block, 'description') ||
      xmlText(block, 'summary') ||
      xmlText(block, 'content')
    ).slice(0, 400);
    const pubDate = xmlText(block, 'pubDate') || xmlText(block, 'published') || xmlText(block, 'updated');
    const author = xmlText(block, 'author') || xmlText(block, 'dc:creator') || xmlText(block, 'name');
    if (!title && !link) continue;
    items.push({ title, url: link, description, pubDate, author });
  }
  return items;
}

// ── Hacker News ────────────────────────────────────────────────────────────
// 主用 Algolia HN Search API（无需认证，稳定），Firebase API 已不可靠
async function fetchHackerNews({ filter = 'top', min_score = 50, limit = 20 } = {}) {
  const tagMap = { top: 'front_page', new: 'story', best: 'front_page', ask: 'ask_hn', show: 'show_hn' };
  const tag = tagMap[filter] || 'front_page';
  const { body } = await httpFetch(
    `https://hn.algolia.com/api/v1/search?tags=${tag}&hitsPerPage=${Math.min(limit * 2, 60)}`,
    { timeout: 10000 }
  );
  const data = JSON.parse(body);
  return (data.hits || [])
    .filter(h => h.title && (h.points || 0) >= (min_score || 0))
    .slice(0, limit)
    .map(h => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      description: `${h.points || 0} 分 · ${h.num_comments || 0} 评论`,
      author: h.author,
    }));
}

// ── Reddit ─────────────────────────────────────────────────────────────────
async function fetchReddit({ subreddit, sort = 'hot', limit = 20 } = {}) {
  const { body } = await httpFetch(
    `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`,
    { headers: { 'User-Agent': 'ClawFeed/1.0 (news aggregator bot)' }, timeout: 10000 }
  );
  const data = JSON.parse(body);
  return (data.data?.children || [])
    .map(c => c.data)
    .filter(p => p.title)
    .slice(0, limit)
    .map(p => ({
      title: p.title,
      url: p.url?.startsWith('/r/') ? `https://www.reddit.com${p.url}` : (p.url || `https://www.reddit.com${p.permalink}`),
      description: p.selftext
        ? p.selftext.slice(0, 300)
        : `↑${p.score} · ${p.num_comments} 评论 · r/${p.subreddit}`,
      author: p.author,
    }));
}

// ── Twitter/X via RSSHub (preferred) or Nitter RSS (fallback) ─────────────
// RSSHub 路由: /twitter/user/:screenName  /twitter/list/:listId
// 需在 .env 中配置 RSSHUB_URL（如 http://localhost:1200）
// Nitter 公共实例已于 2024 年被 Twitter/X 全面封锁，仅作降级备选

const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.1d4.us',
  'https://nitter.moomoo.me',
  'https://nitter.net',
];

async function fetchNitterRss(path, limit = 20) {
  let lastError;
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}${path}`;
      const items = await fetchRss(url, limit);
      if (items.length > 0) return items;
    } catch (e) {
      lastError = e;
    }
  }
  return [];
}

const RSSHUB_RETRIES = 3;
const RSSHUB_RETRY_DELAY = 5000;

async function fetchRssHubWithRetry(path, limit = 20) {
  for (let attempt = 1; attempt <= RSSHUB_RETRIES; attempt++) {
    try {
      const items = await fetchRss(`${RSSHUB_URL}${path}`, limit);
      if (items.length > 0) return items;
      if (attempt < RSSHUB_RETRIES) {
        log(`RSSHub 返回空结果 (${path})，${RSSHUB_RETRY_DELAY / 1000}s 后重试 (${attempt}/${RSSHUB_RETRIES})`);
        await sleep(RSSHUB_RETRY_DELAY);
      }
    } catch (e) {
      if (attempt < RSSHUB_RETRIES) {
        log(`RSSHub 请求失败 (${path}: ${e.message})，${RSSHUB_RETRY_DELAY / 1000}s 后重试 (${attempt}/${RSSHUB_RETRIES})`);
        await sleep(RSSHUB_RETRY_DELAY);
      } else {
        warn(`RSSHub 请求失败 (${path}: ${e.message})，已用尽重试`);
      }
    }
  }
  return [];
}

async function fetchTwitterFeed({ username, handle, limit = 20 } = {}) {
  const raw = username || handle;
  if (!raw) throw new Error('twitter_feed Source 需要配置 username 或 handle 字段（如 "@karpathy"）');
  const screenName = raw.replace(/^@/, '');

  if (RSSHUB_URL) {
    const items = await fetchRssHubWithRetry(`/twitter/user/${screenName}`, limit);
    if (items.length > 0) return items;
  }

  const nitterItems = await fetchNitterRss(`/${screenName}/rss`, limit);
  if (nitterItems.length > 0) return nitterItems;

  if (!RSSHUB_URL) {
    warn(`Twitter/X 采集失败（@${screenName}）：未配置 RSSHUB_URL 且所有 Nitter 实例不可用。` +
      ' 请在 .env 中设置 RSSHUB_URL（自建 RSSHub: https://docs.rsshub.app/deploy/）');
  } else {
    warn(`Twitter/X 采集失败（@${screenName}）：RSSHub 和 Nitter 均无法获取数据`);
  }
  return [];
}

async function fetchTwitterList({ url, limit = 20 } = {}) {
  if (!url) throw new Error('twitter_list Source 需要配置 url 字段（Twitter 列表页 URL）');
  const m = url.match(/(?:twitter\.com|x\.com)\/(?:[^/]+\/)?lists?\/([^/?#]+)/i);
  if (!m) throw new Error(`无法解析 Twitter 列表 URL: ${url}`);
  const listId = m[1];

  if (RSSHUB_URL) {
    const items = await fetchRssHubWithRetry(`/twitter/list/${listId}`, limit);
    if (items.length > 0) return items;
  }

  const nitterItems = await fetchNitterRss(`/i/lists/${listId}/rss`, limit);
  if (nitterItems.length > 0) return nitterItems;

  if (!RSSHUB_URL) {
    warn(`Twitter/X 列表采集失败（${listId}）：未配置 RSSHUB_URL 且所有 Nitter 实例不可用。` +
      ' 请在 .env 中设置 RSSHUB_URL（自建 RSSHub: https://docs.rsshub.app/deploy/）');
  } else {
    warn(`Twitter/X 列表采集失败（${listId}）：RSSHub 和 Nitter 均无法获取数据`);
  }
  return [];
}

// ── GitHub Trending ────────────────────────────────────────────────────────
async function fetchGitHubTrending({ language = '', since = 'daily' } = {}) {
  const langPath = language && language !== 'all' ? `/${encodeURIComponent(language)}` : '';
  const { body } = await httpFetch(`https://github.com/trending${langPath}?since=${since}`, { timeout: 12000 });

  const items = [];
  // Match each repo article block
  const repoRe = /href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"\s*>/g;
  const seen = new Set();
  let m;
  while ((m = repoRe.exec(body)) && items.length < 25) {
    const repo = m[1];
    if (seen.has(repo) || repo.includes('/login') || repo.includes('/trending')) continue;
    seen.add(repo);

    // Try to find description near this position
    const excerpt = body.slice(m.index, m.index + 600);
    const descM = excerpt.match(/<p[^>]*>\s*([^<]{10,200})\s*<\/p>/);
    const starsM = body.slice(m.index, m.index + 1200).match(/(\d[\d,]*)\s*stars today/i);
    const desc = descM ? descM[1].trim() : '';
    const stars = starsM ? starsM[1].replace(/,/g, '') : '';

    items.push({
      title: repo,
      url: `https://github.com/${repo}`,
      description: [desc, stars ? `⭐ ${stars} stars today` : ''].filter(Boolean).join(' · '),
    });
  }
  return items.slice(0, 20);
}

// ── Dispatcher ─────────────────────────────────────────────────────────────
async function fetchSource(source) {
  let config;
  try {
    config = typeof source.config === 'string' ? JSON.parse(source.config) : (source.config || {});
  } catch {
    config = {};
  }

  switch (source.type) {
    case 'rss':
    case 'atom':
    case 'digest_feed':
      return fetchRss(config.url);

    case 'hackernews':
      return fetchHackerNews(config);

    case 'reddit':
      return fetchReddit(config);

    case 'github_trending':
      return fetchGitHubTrending(config);

    case 'twitter_feed':
      return fetchTwitterFeed(config);

    case 'twitter_list':
      return fetchTwitterList(config);

    default:
      warn(`暂不支持的 Source 类型: ${source.type} (${source.name})，已跳过`);
      return [];
  }
}

// ── Load sources from ClawFeed DB ──────────────────────────────────────────
// Import better-sqlite3 to read directly from DB (avoids auth complexity)
async function loadSources() {
  try {
    const { default: Database } = await import('better-sqlite3');
    const dbPath = process.env.DIGEST_DB || env.DIGEST_DB || join(ROOT, 'data', 'digest.db');
    if (!existsSync(dbPath)) {
      log('数据库不存在，请先启动 ClawFeed 服务器初始化数据库');
      return [];
    }
    const db = new Database(dbPath, { readonly: true });
    const sources = db.prepare(
      'SELECT id, name, type, config, is_active, is_public FROM sources WHERE is_active = 1 AND is_deleted = 0'
    ).all();
    db.close();
    return sources;
  } catch (e) {
    warn('无法读取数据库，尝试通过 HTTP API 获取:', e.message);
    // Fallback: HTTP API (only returns public sources without auth)
    const res = await httpFetch(`http://127.0.0.1:${PORT}/api/sources`);
    const sources = JSON.parse(res.body);
    return Array.isArray(sources) ? sources.filter(s => s.is_active && !s.is_deleted) : [];
  }
}

// ── Push History (dedup across digests) ─────────────────────────────────────
const DB_PATH = process.env.DIGEST_DB || env.DIGEST_DB || join(ROOT, 'data', 'digest.db');

const hashStr = (s) => createHash('sha256').update(s || '').digest('hex').slice(0, 16);
const normalizeUrlForHash = (url) => {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/+$/, '').toLowerCase();
  } catch { return (url || '').toLowerCase(); }
};

let _pushDb = null;

async function getPushDbAsync() {
  if (_pushDb) return _pushDb;
  try {
    const { default: Database } = await import('better-sqlite3');
    if (!existsSync(DB_PATH)) return null;
    _pushDb = new Database(DB_PATH);
    _pushDb.exec(`CREATE TABLE IF NOT EXISTS pushed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_hash TEXT NOT NULL,
      title_hash TEXT NOT NULL,
      title TEXT,
      url TEXT,
      digest_type TEXT NOT NULL,
      pushed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    _pushDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_pushed_url_hash ON pushed_items(url_hash)');
    _pushDb.exec('CREATE INDEX IF NOT EXISTS idx_pushed_title_hash ON pushed_items(title_hash)');
    return _pushDb;
  } catch { return null; }
}

function loadPushedHistory(db, hours = 72) {
  try {
    const rows = db.prepare(
      `SELECT url_hash, title_hash, title FROM pushed_items WHERE pushed_at >= datetime('now', ?)`
    ).all(`-${hours} hours`);
    return {
      urlHashes: new Set(rows.map(r => r.url_hash)),
      titleHashes: new Set(rows.map(r => r.title_hash)),
      titles: rows.map(r => r.title).filter(Boolean),
    };
  } catch { return { urlHashes: new Set(), titleHashes: new Set(), titles: [] }; }
}

function recordPushedItems(db, items, digestType) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO pushed_items (url_hash, title_hash, title, url, digest_type) VALUES (?, ?, ?, ?, ?)'
  );
  const run = db.transaction((list) => {
    for (const item of list) {
      const urlHash = hashStr(normalizeUrlForHash(item.url));
      const titleHash = hashStr((item.title || '').replace(/\s+/g, '').toLowerCase());
      stmt.run(urlHash, titleHash, item.title || '', item.url || '', digestType);
    }
  });
  run(items);
}

function cleanOldPushedItems(db, days = 7) {
  try {
    db.prepare(`DELETE FROM pushed_items WHERE pushed_at < datetime('now', ?)`).run(`-${days} days`);
  } catch {}
}

function isItemPushedBefore(history, item) {
  const urlHash = hashStr(normalizeUrlForHash(item.url));
  if (history.urlHashes.has(urlHash)) return true;
  const titleHash = hashStr((item.title || '').replace(/\s+/g, '').toLowerCase());
  if (history.titleHashes.has(titleHash)) return true;
  if (item.title && history.titles?.length > 0) {
    for (const pushedTitle of history.titles) {
      if (titlesAreSimilar(item.title, pushedTitle)) return true;
    }
  }
  return false;
}

// ── DeepSeek Digest Generator ──────────────────────────────────────────────
function callDeepSeek(messages, maxTokens = 4096) {
  const payload = JSON.stringify({
    model: 'deepseek-ai/DeepSeek-V3',
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.siliconflow.cn',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`DeepSeek 响应解析失败: ${data.slice(0, 300)}`)); }
      });
    });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('DeepSeek 请求超时（120s）')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Title similarity utilities (shared by dedup + history check) ───────────
const normalizeTitle = (title) =>
  (title || '').replace(/[\s\u3000：:，,。.！!？?、·—–\-""''\"\']/g, '').toLowerCase();

const extractKeyEntities = (title) => {
  const norm = normalizeTitle(title);
  const numbers = norm.match(/\d[\d,.]*[亿万千百kmbgt%％]+|\$[\d,.]+[kmbgt]*/gi) || [];
  const names = norm.match(/[a-z][a-z0-9.]*[a-z0-9]/gi) || [];
  // Also extract Chinese brand/company names (2-6 chars commonly seen together)
  const cnNames = norm.match(/[\u4e00-\u9fff]{2,6}/g) || [];
  return {
    numbers: numbers.map(n => n.toLowerCase()),
    names: names.map(n => n.toLowerCase()),
    cnNames,
  };
};

const titlesAreSimilar = (a, b) => {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ea = extractKeyEntities(a);
  const eb = extractKeyEntities(b);
  // Same English name + same numbers → same event
  if (ea.names.length > 0 && eb.names.length > 0 && ea.numbers.length > 0 && eb.numbers.length > 0) {
    const sharedNames = ea.names.filter(n => eb.names.some(m => n === m || n.includes(m) || m.includes(n)));
    const sharedNums = ea.numbers.filter(n => eb.numbers.includes(n));
    if (sharedNames.length > 0 && sharedNums.length > 0) return true;
  }
  // Same English entity name appearing in both (e.g. "Anthropic" in both titles) → likely related
  if (ea.names.length > 0 && eb.names.length > 0) {
    const sharedNames = ea.names.filter(n =>
      n.length >= 4 && eb.names.some(m => m.length >= 4 && (n === m || n.includes(m) || m.includes(n)))
    );
    // If they share a significant entity name and both titles are short (event-like), likely same event chain
    if (sharedNames.length > 0 && na.length < 30 && nb.length < 30) return true;
  }

  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return false;
  let intersection = 0;
  for (const g of ba) if (bb.has(g)) intersection++;
  const union = ba.size + bb.size - intersection;
  return union > 0 && (intersection / union) > 0.35;
};

// Fix unescaped quotes inside JSON string values (common LLM output issue).
function fixLlmJsonQuotes(text) {
  let result = text
    .replace(/\u201C/g, '\\"')  // left double quotation mark "
    .replace(/\u201D/g, '\\"')  // right double quotation mark "
    .replace(/\u201E/g, '\\"')  // double low-9 quotation mark „
    .replace(/\u2033/g, '\\"')  // double prime ″
    .replace(/\uFF02/g, '\\"'); // fullwidth quotation mark ＂

  const lines = result.split('\n');
  const keyPattern = /^(\s*"(?:title|url|summary|category|source)"\s*:\s*")(.*)(",?\s*)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(keyPattern);
    if (m) {
      const [, prefix, value, suffix] = m;
      const fixed = value.replace(/(?<!\\)"/g, '\\"');
      if (fixed !== value) {
        lines[i] = prefix + fixed + suffix;
      }
    }
  }
  return lines.join('\n');
}

// Deduplicate structured items by URL and title similarity
function deduplicateItems(items) {
  const seen = new Map(); // normalized URL → item
  const result = [];

  const normalizeUrl = (url) => {
    try {
      const u = new URL(url);
      return (u.hostname + u.pathname).replace(/\/+$/, '').toLowerCase();
    } catch { return url?.toLowerCase() || ''; }
  };

  for (const item of items) {
    const normUrl = normalizeUrl(item.url);

    // Check URL duplication
    if (seen.has(normUrl)) {
      const existing = seen.get(normUrl);
      // Keep the one with higher category priority (重要动态 > 精选资讯)
      if (item.category === '重要动态' && existing.category !== '重要动态') {
        seen.set(normUrl, item);
        const idx = result.indexOf(existing);
        if (idx !== -1) result[idx] = item;
      }
      continue;
    }

    // Check title similarity against all existing items
    let isDup = false;
    for (const [existUrl, existItem] of seen) {
      if (titlesAreSimilar(item.title, existItem.title)) {
        if (item.category === '重要动态' && existItem.category !== '重要动态') {
          seen.delete(existUrl);
          const idx = result.indexOf(existItem);
          if (idx !== -1) result[idx] = item;
          seen.set(normUrl, item);
        }
        isDup = true;
        break;
      }
    }
    if (isDup) continue;

    seen.set(normUrl, item);
    result.push(item);
  }

  if (result.length < items.length) {
    log(`  去重: ${items.length} → ${result.length} 条（移除 ${items.length - result.length} 条重复）`);
  }
  return result;
}

async function generateDigest(allItems, digestType) {
  const TYPE_NAMES = { '4h': '4小时简报', daily: '日报', weekly: '周报', monthly: '月报' };
  const now = new Date();
  const dateStr = now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const itemLines = allItems.map((item, i) => {
    const parts = [`${i + 1}. [${item._sourceName}] ${item.title || '(无标题)'}`];
    if (item.url) parts.push(`   URL: ${item.url}`);
    if (item.description) parts.push(`   摘要: ${item.description.slice(0, 200)}`);
    return parts.join('\n');
  }).join('\n\n');

  const systemPrompt = `你是专业 AI 资讯编辑。从输入的新闻列表中精选最有价值的内容，输出 JSON 数组。

每个元素格式：
{
  "title": "中文标题（15字以内，动词开头，点明核心事件）",
  "url": "必须来自输入的真实链接，不可编造",
  "summary": "2-3 句话的 AI 简报，严格 ≤140 个汉字。第①句：谁做了什么（核心事实）。第②句：为什么重要/有何影响。第③句（可选）：行业启示或值得关注的延伸。不要用序号，用自然段落。语言简练有力，禁止空话套话。",
  "category": "重要动态 | 精选资讯",
  "source": "来源名称"
}

严格规则：
1. 输出 10-15 条。"重要动态"≤4 条（仅限：大额融资 >$100M、重大产品发布、突破性研究、重要政策）
2. summary 必须 ≤140 个汉字（约 3 句话）。每句话都必须有实际信息量，禁止出现"值得关注""引发热议"等空洞表述
3. title 必须是动宾结构，如"OpenAI 发布 GPT-5"而非"关于 GPT-5 的发布"
4. URL 必须完整且来自输入，不可编造或省略
5. 全部中文输出。去除广告、营销内容
6. **严格去重**（最重要的规则）：
   - 同一事件即使来自不同信息源也只保留一条，选择信息最丰富的来源
   - 同一事件的不同角度/反应也算重复。例如："特朗普禁用Anthropic"和"Anthropic拒绝军方要求"是同一事件链，只保留一条综合报道
   - 判断标准：涉及相同公司+相同事件/话题链（如同一笔融资、同一个政策及其反应、同一产品发布及其评测）即为重复
   - 合并同一事件链的多条来源，在一条 summary 中完整呈现事件全貌
7. summary 中的引号必须使用中文引号（「」或『』），严禁使用英文双引号（"），避免 JSON 格式错误
8. 只输出 JSON 数组，不加 markdown 代码块，不加任何前缀后缀说明文字`;

  const userPrompt = `以下是从 ${[...new Set(allItems.map(i => i._sourceName))].join('、')} 采集的 ${allItems.length} 条内容，请生成${TYPE_NAMES[digestType]}的 JSON 数组：\n\n${itemLines}`;

  const result = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], 6000);

  const rawContent = result.choices?.[0]?.message?.content?.trim();
  if (!rawContent) throw new Error(result.error?.message || result.error?.msg || 'DeepSeek 返回空内容');

  // Parse structured JSON items — try multiple cleanup strategies
  let structuredItems = null;
  const stripped = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const extracted = rawContent.replace(/^[^[]*(\[[\s\S]*\])[^}\]]*$/, '$1').trim();
  const aggressive = rawContent.replace(/^[\s\S]*?(?=\[)/, '').replace(/\][^}\]]*$/, ']').trim();
  const singleObj = (() => {
    const m = rawContent.match(/\{[\s\S]*"title"[\s\S]*"url"[\s\S]*\}/);
    return m ? `[${m[0]}]` : '';
  })();

  const baseCandidates = [rawContent, stripped, extracted, aggressive, singleObj].filter(Boolean);
  // For each base candidate, also try fixing unescaped quotes (common LLM issue)
  const jsonCandidates = [];
  for (const c of baseCandidates) {
    jsonCandidates.push(c);
    const fixed = fixLlmJsonQuotes(c);
    if (fixed !== c) jsonCandidates.push(fixed);
  }

  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const valid = items.filter(i => i.title && i.url && i.summary);
      if (valid.length > 0) {
        structuredItems = valid;
        break;
      }
    } catch {}
  }
  if (!structuredItems) {
    const objRe = /\{[^{}]*"title"\s*:\s*"[^"]*"[^{}]*"url"\s*:\s*"[^"]*"[^{}]*"summary"\s*:\s*"[^"]*"[^{}]*\}/g;
    const matches = rawContent.match(objRe);
    if (matches?.length > 0) {
      const rescued = [];
      for (const m of matches) {
        try {
          const obj = JSON.parse(m);
          if (obj.title && obj.url && obj.summary) rescued.push(obj);
        } catch {
          try {
            const obj = JSON.parse(fixLlmJsonQuotes(m));
            if (obj.title && obj.url && obj.summary) rescued.push(obj);
          } catch {}
        }
      }
      if (rescued.length > 0) {
        log(`⚠️  JSON 整体解析失败，逐条提取恢复了 ${rescued.length} 条`);
        structuredItems = rescued;
      }
    }
  }
  if (!structuredItems) {
    log(`⚠️  JSON 解析失败，回退纯文本。原始内容前 200 字: ${rawContent.slice(0, 200)}`);
    return { content: rawContent, metadata: {} };
  }

  // Deduplicate items by URL and similar titles
  structuredItems = deduplicateItems(structuredItems);

  // Build markdown from structured items (for web display)
  const hotItems = structuredItems.filter(i => i.category === '重要动态');
  const otherItems = structuredItems.filter(i => i.category !== '重要动态');
  const icons = { '4h': '☀️', daily: '📰', weekly: '📅', monthly: '📊' };
  let markdown = `${icons[digestType] || '☀️'} AI 快报 | ${dateStr} CST\n\n`;
  if (hotItems.length > 0) {
    markdown += `🔥 重要动态\n`;
    for (const item of hotItems) {
      markdown += `• [${item.title}] — ${item.summary} [链接](${item.url})\n`;
    }
    markdown += '\n';
  }
  if (otherItems.length > 0) {
    markdown += `📰 精选资讯\n`;
    for (const item of otherItems) {
      markdown += `• [${item.title}] — ${item.summary} [链接](${item.url})\n`;
    }
  }

  return { content: markdown, metadata: { items: structuredItems, dateStr, digestType } };
}

// ── Deep mode: article fetch + per-article summarization ──────────────────

// Domains that don't contain readable article text
const SKIP_ARTICLE_DOMAINS = new Set([
  'reddit.com', 'v.redd.it', 'i.redd.it', 'old.reddit.com',
  'twitter.com', 'x.com', 't.co',
  'youtube.com', 'youtu.be',
  'github.com', 'gist.github.com',
  'news.ycombinator.com',
  'instagram.com', 'linkedin.com', 'facebook.com',
  'imgur.com', 'giphy.com',
]);

const shouldFetchArticle = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return !SKIP_ARTICLE_DOMAINS.has(host);
  } catch { return false; }
};

async function fetchArticleText(url, maxChars = 12000) {
  try {
    const { body } = await httpFetch(url, { timeout: 15000 });

    // Strip noise elements
    let html = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Find best content container in priority order
    let contentHtml = '';
    const selectors = [
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      /<main[^>]*>([\s\S]*?)<\/main>/i,
      /<div[^>]*class="[^"]*(?:article-body|post-content|entry-content|story-body|article__body|post-body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*id="[^"]*(?:article|content|story|post)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ];
    for (const re of selectors) {
      const m = html.match(re);
      if (m && m[1].length > 400) { contentHtml = m[1]; break; }
    }
    if (!contentHtml) contentHtml = html;

    // Extract paragraph text
    const paragraphs = [];
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = pRe.exec(contentHtml))) {
      const text = m[1].replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (text.length > 40) paragraphs.push(text);
    }

    if (paragraphs.length >= 3) return paragraphs.join('\n\n').slice(0, maxChars);

    // Fallback: strip all HTML
    return contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  } catch {
    return '';
  }
}

async function summarizeArticle(title, url, sourceName, articleText) {
  if (!articleText || articleText.trim().length < 150) return null;

  const result = await callDeepSeek([
    {
      role: 'system',
      content:
        '你是专业文章摘要专家。将给定的文章内容总结成250字左右的中文摘要，严格按照以下格式输出：\n\n' +
        '**核心要点**: （1-2句话概括文章最重要的内容）\n\n' +
        '**关键信息**:\n• ...\n• ...\n• ...\n\n' +
        '**价值/影响**: （1句话说明这篇文章为什么值得关注）\n\n' +
        '只输出摘要内容，不要添加任何前缀或后记。',
    },
    {
      role: 'user',
      content: `来源: ${sourceName}\n标题: ${title}\n链接: ${url}\n\n文章内容:\n${articleText}`,
    },
  ], 1024);

  return result.choices?.[0]?.message?.content?.trim() || null;
}

async function generateDeepSummaries(digestContent, allItems) {
  // Extract all URLs from the generated digest
  const rawUrls = [];
  const urlRe = /https?:\/\/[^\s\)\]"'<>]+/g;
  let m;
  while ((m = urlRe.exec(digestContent))) {
    rawUrls.push(m[0].replace(/[.,;:!?）]+$/, ''));
  }
  const digestUrls = [...new Set(rawUrls)].filter(shouldFetchArticle);

  if (digestUrls.length === 0) {
    warn('深度模式：未从 Digest 中提取到可分析的文章链接');
    return null;
  }

  log(`\n🔍 深度模式：找到 ${digestUrls.length} 篇文章，开始并发抓取原文...`);

  // Build URL → item metadata map
  const urlToItem = new Map();
  for (const item of allItems) {
    if (item.url) urlToItem.set(item.url, item);
  }

  // Fetch all articles concurrently
  const fetchResults = await Promise.allSettled(
    digestUrls.map(url =>
      fetchArticleText(url).then(text => ({ url, text }))
    )
  );

  // Summarize sequentially (avoid rate limits)
  log('正在逐篇生成深度摘要...');
  const summaries = [];
  for (const result of fetchResults) {
    if (result.status !== 'fulfilled') continue;
    const { url, text } = result.value;
    const item = urlToItem.get(url);
    const title = item?.title || url;
    const sourceName = item?._sourceName || new URL(url).hostname.replace(/^www\./, '');

    process.stdout.write(`  📄 ${title.slice(0, 55).padEnd(55)} ... `);
    const summary = await summarizeArticle(title, url, sourceName, text);
    if (summary) {
      summaries.push({ title, url, sourceName, summary });
      console.log('✓');
    } else {
      console.log('✗ 无法获取原文');
    }
  }

  if (summaries.length === 0) return null;

  const deepSection = [
    '═'.repeat(50),
    '',
    '📖 深度摘要',
    `（共 ${summaries.length} 篇，由 DeepSeek 根据原文生成）`,
    '',
    summaries.map((s, i) =>
      `### ${i + 1}. ${s.title}\n> **来源**: ${s.sourceName} · [原文链接](${s.url})\n\n${s.summary}`
    ).join('\n\n---\n\n'),
  ].join('\n');

  return deepSection;
}

// Try to rescue JSON items from raw content string (safety net for Feishu push)
function tryRescueJsonItems(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!/[\[{]/.test(trimmed)) return null;
  const baseCandidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim(),
    trimmed.replace(/^[\s\S]*?(?=\[)/, '').replace(/\][^}\]]*$/, ']').trim(),
    trimmed.replace(/^[\s\S]*?(?=\{)/, '').replace(/\}[^}\]]*$/, '}').trim(),
  ].filter(Boolean);
  const candidates = [];
  for (const c of baseCandidates) {
    candidates.push(c);
    const fixed = fixLlmJsonQuotes(c);
    if (fixed !== c) candidates.push(fixed);
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const valid = items.filter(i => i.title && i.summary);
      if (valid.length > 0) return valid;
    } catch {}
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // Pre-flight checks
  if (!API_KEY) {
    console.error('❌ 请在 .env 中设置 API_KEY');
    process.exit(1);
  }
  if (!DEEPSEEK_API_KEY) {
    console.error('❌ 请在 .env 中设置 DEEPSEEK_API_KEY');
    process.exit(1);
  }

  log(`开始生成 ${DIGEST_TYPE} Digest...`);

  // 1. Load sources
  log('正在加载信息源...');
  const sources = await loadSources();
  if (sources.length === 0) {
    log('❌ 没有找到活跃的信息源。请先在 Web 界面添加 Source（RSS/HN/Reddit 等）。');
    log(`   打开浏览器访问 http://127.0.0.1:${PORT}`);
    process.exit(0);
  }
  log(`找到 ${sources.length} 个活跃信息源: ${sources.map(s => s.name).join(', ')}`);

  // 2. Fetch content from each source
  log('\n开始采集内容...');
  const allItems = [];
  for (const source of sources) {
    process.stdout.write(`  采集: ${source.name} (${source.type}) ... `);
    try {
      const items = await fetchSource(source);
      console.log(`✓ ${items.length} 条`);
      for (const item of items) {
        allItems.push({ ...item, _sourceName: source.name, _sourceType: source.type });
      }
    } catch (e) {
      console.log(`✗ 失败: ${e.message}`);
    }
  }

  if (allItems.length === 0) {
    log('❌ 所有信息源采集均失败，请检查 Source 配置或网络连接。');
    process.exit(1);
  }
  log(`\n共采集到 ${allItems.length} 条内容`);

  // 2.5. Load push history and filter out already-pushed items
  const pushDb = await getPushDbAsync();
  let pushHistory = { urlHashes: new Set(), titleHashes: new Set(), titles: [] };
  if (pushDb) {
    pushHistory = loadPushedHistory(pushDb, 72);
    log(`已加载推送历史: ${pushHistory.urlHashes.size} 条 URL, ${pushHistory.titleHashes.size} 条标题`);
    cleanOldPushedItems(pushDb, 7);
  }

  // 2.6. Pre-deduplicate raw items: same-batch URL dedup + history dedup + stale filter
  const seenUrls = new Set();
  const dedupedItems = [];
  let historySkipped = 0;
  let staleSkipped = 0;
  const now = Date.now();
  const maxAgeMs = MAX_ARTICLE_AGE_HOURS * 3600 * 1000;
  for (const item of allItems) {
    if (item.pubDate) {
      const pubTime = new Date(item.pubDate).getTime();
      if (!isNaN(pubTime) && (now - pubTime) > maxAgeMs) {
        staleSkipped++;
        continue;
      }
    }
    const normUrl = item.url ? item.url.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '').toLowerCase() : '';
    if (normUrl && seenUrls.has(normUrl)) continue;
    if (normUrl) seenUrls.add(normUrl);
    if (pushDb && isItemPushedBefore(pushHistory, item)) {
      historySkipped++;
      continue;
    }
    dedupedItems.push(item);
  }
  const batchSkipped = allItems.length - dedupedItems.length - historySkipped - staleSkipped;
  if (batchSkipped > 0 || historySkipped > 0 || staleSkipped > 0) {
    log(`预去重: ${allItems.length} → ${dedupedItems.length} 条（批内去重 ${batchSkipped}, 历史去重 ${historySkipped}, 过期过滤 ${staleSkipped}）`);
  }

  if (dedupedItems.length === 0) {
    log('⚠️  所有采集内容均已在近期推送过，本次跳过。');
    if (pushDb) pushDb.close();
    process.exit(0);
  }

  // 3. Generate standard digest via DeepSeek
  log('\n正在调用 DeepSeek 生成摘要（可能需要 20-60 秒）...');
  let { content, metadata } = await generateDigest(dedupedItems, DIGEST_TYPE);
  log(`✓ 摘要生成完成（${content.length} 字，${metadata.items?.length ?? 0} 条结构化条目）`);

  // 3.5. Post-generation dedup: filter DeepSeek output against push history
  if (pushDb && metadata.items?.length > 0) {
    const beforeCount = metadata.items.length;
    metadata.items = metadata.items.filter(item => !isItemPushedBefore(pushHistory, item));
    if (metadata.items.length < beforeCount) {
      log(`二次去重: ${beforeCount} → ${metadata.items.length} 条（过滤已推送 ${beforeCount - metadata.items.length} 条）`);
      // Rebuild markdown content from remaining items
      if (metadata.items.length > 0) {
        const hotItems = metadata.items.filter(i => i.category === '重要动态');
        const otherItems = metadata.items.filter(i => i.category !== '重要动态');
        const icons = { '4h': '☀️', daily: '📰', weekly: '📅', monthly: '📊' };
        let md = `${icons[DIGEST_TYPE] || '☀️'} AI 快报 | ${metadata.dateStr} CST\n\n`;
        if (hotItems.length > 0) {
          md += '🔥 重要动态\n';
          for (const item of hotItems) md += `• [${item.title}] — ${item.summary} [链接](${item.url})\n`;
          md += '\n';
        }
        if (otherItems.length > 0) {
          md += '📰 精选资讯\n';
          for (const item of otherItems) md += `• [${item.title}] — ${item.summary} [链接](${item.url})\n`;
        }
        content = md;
      }
    }
  }

  if (metadata.items?.length === 0) {
    log('⚠️  DeepSeek 输出的所有条目均已在近期推送过，本次跳过。');
    if (pushDb) pushDb.close();
    process.exit(0);
  }

  // 4. (Optional) Deep mode: fetch articles + per-article summaries
  if (DEEP_MODE) {
    log('\n启用深度模式，开始抓取原文生成深度摘要...');
    log('（每篇文章约需 5-15 秒，全程需 2-5 分钟）');
    const deepSection = await generateDeepSummaries(content, dedupedItems);
    if (deepSection) {
      content = content + '\n\n' + deepSection;
      log(`✓ 深度摘要追加完成，总内容 ${content.length} 字`);
    }
  }

  // 5. POST digest to ClawFeed
  log('\n正在保存 Digest 到 ClawFeed...');
  const postRes = await localPost(
    '/api/digests',
    { type: DIGEST_TYPE, content, metadata: JSON.stringify(metadata) },
    { Authorization: `Bearer ${API_KEY}` }
  );

  if (postRes.status === 201) {
    log(`✅ Digest 保存成功！id = ${postRes.data.id}`);
    log(`   查看: http://127.0.0.1:${PORT}`);

    // Push to Feishu group bot
    let pushedItems = [];
    if (FEISHU_WEBHOOK) {
      if (metadata.items?.length > 0) {
        await sendFeishuArticles(metadata.items, metadata);
        pushedItems = metadata.items;
      } else {
        const rescued = tryRescueJsonItems(content);
        if (rescued) {
          log('\n内容为 JSON 格式，已抢救解析为结构化卡片推送');
          const now = new Date();
          const rescuedMeta = {
            digestType: DIGEST_TYPE,
            dateStr: now.toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit',
            }),
          };
          await sendFeishuArticles(rescued, rescuedMeta);
          pushedItems = rescued;
        } else {
          log('\n正在推送到飞书群机器人（纯文本模式）...');
          await sendFeishuNotification(content);
        }
      }
    }

    // 6. Record pushed items to history (prevents future duplicates)
    if (pushDb && pushedItems.length > 0) {
      recordPushedItems(pushDb, pushedItems, DIGEST_TYPE);
      log(`📝 已记录 ${pushedItems.length} 条推送到历史（防止后续重复）`);
    }
  } else {
    console.error('❌ 保存失败:', JSON.stringify(postRes));
    if (pushDb) pushDb.close();
    process.exit(1);
  }

  if (pushDb) pushDb.close();

  // Print preview
  const preview = content.split('\n').slice(0, 20).join('\n');
  console.log('\n' + '─'.repeat(60));
  console.log(preview);
  if (content.split('\n').length > 20) console.log('...');
  console.log('─'.repeat(60));
}

main().catch(e => {
  console.error('❌ 致命错误:', e.message);
  process.exit(1);
});
