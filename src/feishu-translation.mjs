import { normalizeOpenRouterAutoModel } from './openrouter-free.mjs';

const ENGLISH_WORDS = new Set([
  'a', 'after', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'before', 'but', 'by',
  'can', 'for', 'from', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'more',
  'new', 'now', 'of', 'on', 'or', 'over', 'that', 'the', 'their', 'this', 'than',
  'to', 'under', 'using', 'was', 'were', 'will', 'with',
  'acquires', 'acquired', 'adds', 'announces', 'builds', 'company', 'features',
  'funding', 'improves', 'launches', 'model', 'opens', 'plans', 'raises', 'report',
  'releases', 'round', 'says', 'tools', 'users',
]);

const ALLOWED_LOWERCASE_NAMES = new Set([
  'ai', 'api', 'css', 'html', 'ios', 'javascript', 'llm', 'macos', 'npm',
  'openai', 'python', 'sdk', 'sql', 'typescript',
  // 中文科技资讯中约定俗成保留英文的技术名词，避免门禁误杀
  'agi', 'app', 'apps', 'asr', 'bot', 'bots', 'cli', 'cpu', 'docker', 'git',
  'github', 'gpu', 'gpus', 'ide', 'java', 'linux', 'mcp', 'nlp', 'ocr',
  'rag', 'rust', 'saas', 'token', 'tokens', 'tpu', 'tts', 'ui', 'ux', 'web',
]);

const stripNonLanguageContent = (text) => String(text || '')
  .replace(/https?:\/\/\S+/gi, ' ')
  .replace(/`[^`]*`/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const chineseCharCount = (text) => (String(text || '').match(/[\u3400-\u9fff]/g) || []).length;

const normalizeProviderModel = (baseUrl, model, fallbackModel) =>
  normalizeOpenRouterAutoModel(baseUrl, model || fallbackModel);

export function resolveTranslationProvider({
  translateApiKey = '',
  translateBaseUrl = '',
  translateModel = '',
  llmApiKey = '',
  llmBaseUrl = '',
  llmModel = '',
  deepseekApiKey = '',
} = {}) {
  const siliconFlow = {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  };

  if (translateApiKey) {
    const baseUrl = (translateBaseUrl || siliconFlow.baseUrl).replace(/\/+$/, '');
    return {
      apiKey: translateApiKey,
      baseUrl,
      model: normalizeProviderModel(baseUrl, translateModel, siliconFlow.model),
      source: 'translate',
    };
  }

  if (llmApiKey && llmBaseUrl) {
    const baseUrl = llmBaseUrl.replace(/\/+$/, '');
    return {
      apiKey: llmApiKey,
      baseUrl,
      model: normalizeProviderModel(baseUrl, llmModel, /openrouter/i.test(baseUrl) ? 'openrouter/free-latest' : siliconFlow.model),
      source: 'llm',
    };
  }

  return {
    apiKey: deepseekApiKey,
    baseUrl: siliconFlow.baseUrl,
    model: siliconFlow.model,
    source: 'deepseek',
  };
}

export function needsZhTranslation(text) {
  if (/\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(String(text || ''))) {
    return true;
  }
  const content = stripNonLanguageContent(text);
  if (!content) return false;

  const chinese = chineseCharCount(content);
  const latinLetters = (content.match(/[A-Za-z]/g) || []).length;
  if (chinese === 0) return true;

  // 字母数字混合的品牌名（如 a16z、GPT-6）不应被拆出英文单词（a16z 会被拆成冠词 a 导致误判）
  const words = content.match(/(?<![A-Za-z0-9])[A-Za-z][A-Za-z'-]*(?![0-9])/g) || [];
  const proseWords = words.filter((word) => ENGLISH_WORDS.has(word.toLowerCase())).length;
  if (proseWords >= 1) return true;

  const lowercaseProse = words.filter((word) =>
    word === word.toLowerCase() && !ALLOWED_LOWERCASE_NAMES.has(word)
  );
  if (lowercaseProse.length) return true;
  // 中文标题常含多个大写产品名（如「OpenAI发布GPT-6 Sol与Luna」仅 3 个汉字），
  // 只要无英文虚词/小写散文词且含少量汉字即视为中文文案
  if (words.length >= 3 && chinese < 2) return true;

  return latinLetters >= 20 && chinese / (chinese + latinLetters) < 0.12;
}

export function parseTranslatedItems(raw) {
  const stripped = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const extracted = stripped.replace(/^[\s\S]*?(?=\[)/, '').replace(/\][^]*$/, ']');
  for (const candidate of [stripped, extracted]) {
    try {
      const parsed = JSON.parse(candidate);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (items.length) return items;
    } catch {
      // Try the next extraction candidate.
    }
  }
  return null;
}

export function isGarbledChinese(text) {
  const value = String(text || '');
  if (/\uFFFD/.test(value)) return true;
  if (/[\u3400-\u9fff](?:[ \t]+[\u3400-\u9fff]){3,}/.test(value)) return true;
  if (/[\u3400-\u9fff][\u200b\u200c\u200d\ufeff\u2060]/.test(value)) return true;
  return false;
}

const isAcceptableChinese = (text, field) =>
  chineseCharCount(text) >= (field === 'title' ? 2 : 6)
  && !needsZhTranslation(text)
  && !isGarbledChinese(text);

export const FEISHU_SOURCE_TEXT_MAX = 1800;

export const FEISHU_CARD_PROMPT =
  '你是资讯编辑，为飞书卡片写简体中文标题和简述。' +
  '根据每条的 title、summary 和 sourceText（原文要点，通常更完整）做总结，不要把开头几句翻译或扩写成标题/简述。' +
  'title：一句话点明整篇的核心事件，动宾结构；可保留公司名、产品名、人名等专有名词，但必须用中文动词概括在做什么。' +
  'summary（简述）：2-3 句概括全文关键信息——谁做了什么、结果或影响是什么；禁止复述或翻译原文前几句，也不要只改写已有 summary。' +
  '只写原文能支持的事实，禁止编造融资额、产品版本、排名、机构名或未出现的事件。' +
  '汉字必须连续书写，禁止在汉字之间插入空格、符号或多余汉字。' +
  '不要添加评论，不要翻译或改写 URL。必须保留每个 i，只输出 JSON 数组，格式：[{"i":0,"title":"...","summary":"..."}]';

const cleanFeishuText = (value, max) => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#8217;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ')
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const rawItemBody = (item) => String(
  item?.sourceText || item?.description || item?.content || item?.body || ''
).trim();

const itemSourceText = (item) => {
  const body = rawItemBody(item);
  const title = String(item?.title || '').trim();
  if (title && body && !body.startsWith(title)) return `${title}\n${body}`;
  return body || title;
};

export function prepareFeishuCardItem(item) {
  return {
    ...item,
    title: cleanFeishuText(item?.title, 80),
    summary: cleanFeishuText(item?.summary, 400),
    sourceText: cleanFeishuText(itemSourceText(item), FEISHU_SOURCE_TEXT_MAX),
  };
}

export function normalizeFeishuItemUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

export function attachFeishuSourceText(items, rawItems = []) {
  const byUrl = new Map();
  for (const raw of rawItems) {
    const key = normalizeFeishuItemUrl(raw?.url);
    if (!key) continue;
    const text = itemSourceText(raw).trim();
    if (!text) continue;
    const existing = byUrl.get(key) || '';
    if (text.length > existing.length) byUrl.set(key, text);
  }

  return (items || []).map((item) => {
    const fromRaw = byUrl.get(normalizeFeishuItemUrl(item?.url)) || '';
    const fallback = String(item?.sourceText || item?.description || item?.content || '').trim();
    const sourceText = fromRaw.length >= fallback.length ? fromRaw : fallback;
    return { ...item, sourceText };
  });
}

const requiredFields = (item, rewriteAll = false) => (
  rewriteAll
    ? { title: true, summary: true }
    : {
      title: needsZhTranslation(item.title),
      summary: needsZhTranslation(item.summary),
    }
);

const unresolvedFields = (completed, requirements) => {
  const unresolved = [];
  for (let i = 0; i < completed.length; i++) {
    for (const field of ['title', 'summary']) {
      if (requirements[i][field] && !completed[i][field]) unresolved.push({ i, field });
    }
  }
  return unresolved;
};

export async function translateFeishuItems(items, {
  apiKey,
  requestTranslation,
  attempts = 3,
  onRetry = () => {},
  rewriteAll = false,
} = {}) {
  const requirements = items.map((item) => requiredFields(item, rewriteAll));
  if (!requirements.some((fields) => fields.title || fields.summary)) return items;
  if (!apiKey) throw new Error('飞书中文翻译未配置 API Key，已阻止英文推送');
  if (typeof requestTranslation !== 'function') throw new Error('飞书中文翻译服务不可用，已阻止英文推送');

  let translatedItems = items.map((item) => ({ ...item }));
  const completed = requirements.map((fields) => ({
    title: !fields.title,
    summary: !fields.summary,
  }));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const unresolved = unresolvedFields(completed, requirements);
    if (!unresolved.length) return translatedItems;

    const pendingIndexes = [...new Set(unresolved.map(({ i }) => i))];
    const payload = pendingIndexes.map((i) => ({
      i,
      title: translatedItems[i].title || '',
      summary: translatedItems[i].summary || '',
      sourceText: translatedItems[i].sourceText || '',
    }));

    try {
      const raw = await requestTranslation(payload, attempt);
      const translated = parseTranslatedItems(raw);
      if (!translated?.length) throw new Error('译文不是有效的 JSON 数组');

      const byIndex = new Map(translated.map((item) => [Number(item.i), item]));
      translatedItems = translatedItems.map((item, i) => {
        const candidate = byIndex.get(i);
        if (!candidate) return item;
        const next = { ...item };
        for (const field of ['title', 'summary']) {
          if (!requirements[i][field]) continue;
          const value = String(candidate[field] || '').trim();
          if (isAcceptableChinese(value, field)) {
            next[field] = value;
            completed[i][field] = true;
          }
        }
        return next;
      });
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    const remaining = unresolvedFields(completed, requirements);
    if (!remaining.length) return translatedItems;
    if (attempt < attempts) await onRetry({ attempt, remaining, error: lastError });
  }

  const remaining = unresolvedFields(completed, requirements).filter(({ i, field }) => {
    const original = String(items[i]?.[field] || '').trim();
    if (isAcceptableChinese(original, field)) {
      translatedItems[i][field] = translatedItems[i][field] || original;
      completed[i][field] = true;
      return false;
    }
    return true;
  });
  if (!remaining.length) return translatedItems;
  const detail = remaining.map(({ i, field }) => `${i + 1}.${field}`).join(', ');
  const cause = lastError?.message ? `：${lastError.message}` : '';
  throw new Error(`飞书中文翻译未完成（${detail}）${cause}，已阻止英文推送`);
}

const FEISHU_WEBHOOK_HOSTS = new Set([
  'open.feishu.cn',
  'www.feishu.cn',
  'open.larksuite.com',
  'open.larkoffice.com',
]);

export function isFeishuWebhookUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'https:'
      && FEISHU_WEBHOOK_HOSTS.has(parsed.hostname)
      && /\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function maskFeishuWebhookUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    const token = parsed.pathname.split('/').pop() || '';
    const visible = token.slice(-4);
    parsed.pathname = parsed.pathname.replace(/[^/]+$/, `****${visible}`);
    return parsed.toString();
  } catch {
    return '';
  }
}

export async function translateFeishuText(text, {
  apiKey,
  requestTranslation,
  attempts = 3,
  onRetry = () => {},
} = {}) {
  if (!needsZhTranslation(text)) return text;
  if (!apiKey) throw new Error('飞书中文翻译未配置 API Key，已阻止英文推送');
  if (typeof requestTranslation !== 'function') throw new Error('飞书中文翻译服务不可用，已阻止英文推送');

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const translated = String(await requestTranslation(text, attempt) || '').trim();
      if (chineseCharCount(translated) >= 8 && !needsZhTranslation(translated)) return translated;
      throw new Error('译文缺少足够的中文内容');
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await onRetry({ attempt, error });
    }
  }
  throw new Error(`飞书纯文本中文翻译失败：${lastError?.message || '未知错误'}，已阻止英文推送`);
}
