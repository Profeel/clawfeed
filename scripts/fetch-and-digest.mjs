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
import { ProxyAgent, fetch as undiciFetch } from 'undici';

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
  const fetchOpts = {
    headers: { 'User-Agent': 'ClawFeed-Fetcher/1.0', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  };
  if (proxyDispatcher) fetchOpts.dispatcher = proxyDispatcher;

  const res = await undiciFetch(url, fetchOpts);
  // Read body with size limit
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
  const body = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
  return { status: res.status, body, headers: Object.fromEntries(res.headers) };
}

// POST JSON to any HTTPS URL (used for Feishu webhook)
async function postJson(url, body) {
  const payload = JSON.stringify(body);
  const fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ClawFeed-Bot/1.0' },
    body: payload,
    signal: AbortSignal.timeout(10000),
  };
  if (proxyDispatcher) fetchOpts.dispatcher = proxyDispatcher;
  const res = await undiciFetch(url, fetchOpts);
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return { status: res.status, body: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8') };
}

// ── Feishu / Lark Webhook Push ─────────────────────────────────────────────
// 飞书自定义机器人签名算法：HMAC-SHA256(key = timestamp+"\n"+secret, message = "")，base64 编码
async function sendFeishuNotification(content) {
  if (!FEISHU_WEBHOOK) return;

  const { createHmac } = await import('crypto');

  // Truncate to 4000 chars to keep the message readable in group chat
  const text = content.length > 4000
    ? content.slice(0, 4000) + '\n\n…（内容已截断，完整内容请访问 ClawFeed）'
    : content;

  const msgBody = { msg_type: 'text', content: { text } };

  if (FEISHU_SECRET) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const stringToSign = `${timestamp}\n${FEISHU_SECRET}`;
    const sign = createHmac('sha256', stringToSign).update('').digest('base64');
    msgBody.timestamp = timestamp;
    msgBody.sign = sign;
  }

  try {
    const resp = await postJson(FEISHU_WEBHOOK, msgBody);
    const result = JSON.parse(resp.body);
    if (result.code === 0 || result.StatusCode === 0) {
      log('✅ 飞书推送成功');
    } else {
      warn(`飞书推送失败 (code=${result.code ?? result.StatusCode}): ${result.msg || result.StatusMessage || JSON.stringify(result)}`);
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
async function fetchHackerNews({ filter = 'top', min_score = 50, limit = 20 } = {}) {
  const typeMap = { top: 'topstories', new: 'newstories', best: 'beststories', ask: 'askstories', show: 'showstories' };
  const listType = typeMap[filter] || 'topstories';
  const { body } = await httpFetch(`https://hacker-news.firebaseio.com/v2/${listType}.json`, { timeout: 8000 });
  const parsed = JSON.parse(body);
  const ids = (Array.isArray(parsed) ? parsed : []).slice(0, Math.min(limit * 3, 60));

  const results = await Promise.allSettled(
    ids.map(id => httpFetch(`https://hacker-news.firebaseio.com/v2/item/${id}.json`, { timeout: 5000 }).then(r => JSON.parse(r.body)))
  );

  return results
    .filter(r => r.status === 'fulfilled' && r.value?.title)
    .map(r => r.value)
    .filter(s => (s.score || 0) >= (min_score || 0))
    .slice(0, limit)
    .map(s => ({
      title: s.title,
      url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      description: s.text
        ? stripHtml(s.text).slice(0, 300)
        : `${s.score} 分 · ${s.descendants || 0} 评论`,
      author: s.by,
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

async function generateDigest(allItems, digestType) {
  const TYPE_NAMES = { '4h': '4小时简报', daily: '日报', weekly: '周报', monthly: '月报' };
  const now = new Date();
  const dateStr = now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  // Format items as numbered list for the prompt
  const itemLines = allItems.map((item, i) => {
    const parts = [`${i + 1}. [${item._sourceName}] ${item.title || '(无标题)'}`];
    if (item.url) parts.push(`   链接: ${item.url}`);
    if (item.description) parts.push(`   简介: ${item.description}`);
    return parts.join('\n');
  }).join('\n\n');

  const systemPrompt = `你是专业 AI 资讯编辑，从多信息源中精选最有价值内容，生成简洁有力的中文${TYPE_NAMES[digestType]}。

输出格式（严格遵守，不添加额外说明）：
☀️ AI 快报 | ${dateStr} CST

🔥 重要动态
• [标题] — 一句话点评 [链接]
（仅 2-4 条真正重要的行业新闻：大额融资、重大产品发布、突破性研究）

📰 精选资讯
• [内容摘要] — 为什么值得看 [链接]
（8-12 条，覆盖技术/产品/行业等多个维度）

编辑规则：
- 全部输出中文
- 每条必须附上原始链接
- 去除广告、营销内容、重复条目
- 优先选信息密度高的原创内容
- 总条目不超过 15 条`;

  const userPrompt = `以下是从 ${[...new Set(allItems.map(i => i._sourceName))].join('、')} 等 ${allItems.length} 条内容，请生成${TYPE_NAMES[digestType]}：\n\n${itemLines}`;

  const result = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  const content = result.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(result.error?.message || result.error?.msg || 'DeepSeek 返回空内容');
  return content;
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

  // 3. Generate standard digest via DeepSeek
  log('\n正在调用 DeepSeek 生成摘要（可能需要 20-60 秒）...');
  let content = await generateDigest(allItems, DIGEST_TYPE);
  log(`✓ 摘要生成完成（${content.length} 字）`);

  // 4. (Optional) Deep mode: fetch articles + per-article summaries
  if (DEEP_MODE) {
    log('\n启用深度模式，开始抓取原文生成深度摘要...');
    log('（每篇文章约需 5-15 秒，全程需 2-5 分钟）');
    const deepSection = await generateDeepSummaries(content, allItems);
    if (deepSection) {
      content = content + '\n\n' + deepSection;
      log(`✓ 深度摘要追加完成，总内容 ${content.length} 字`);
    }
  }

  // 5. POST digest to ClawFeed
  log('\n正在保存 Digest 到 ClawFeed...');
  const postRes = await localPost(
    '/api/digests',
    { type: DIGEST_TYPE, content },
    { Authorization: `Bearer ${API_KEY}` }
  );

  if (postRes.status === 201) {
    log(`✅ Digest 保存成功！id = ${postRes.data.id}`);
    log(`   查看: http://127.0.0.1:${PORT}`);

    // Push to Feishu group bot
    if (FEISHU_WEBHOOK) {
      log('\n正在推送到飞书群机器人...');
      await sendFeishuNotification(content);
    }
  } else {
    console.error('❌ 保存失败:', JSON.stringify(postRes));
    process.exit(1);
  }

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
