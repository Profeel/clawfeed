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
]);

const stripNonLanguageContent = (text) => String(text || '')
  .replace(/https?:\/\/\S+/gi, ' ')
  .replace(/`[^`]*`/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const chineseCharCount = (text) => (String(text || '').match(/[\u3400-\u9fff]/g) || []).length;

export function needsZhTranslation(text) {
  const content = stripNonLanguageContent(text);
  if (!content) return false;

  const chinese = chineseCharCount(content);
  const latinLetters = (content.match(/[A-Za-z]/g) || []).length;
  if (chinese === 0) return true;

  const words = content.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const proseWords = words.filter((word) => ENGLISH_WORDS.has(word.toLowerCase())).length;
  if (proseWords >= 1) return true;

  const lowercaseProse = words.filter((word) =>
    word === word.toLowerCase() && !ALLOWED_LOWERCASE_NAMES.has(word)
  );
  if (lowercaseProse.length) return true;
  if (words.length >= 3 && chinese < 4) return true;

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

const isAcceptableChinese = (text, field) =>
  chineseCharCount(text) >= (field === 'title' ? 2 : 6) && !needsZhTranslation(text);

const requiredFields = (item) => ({
  title: needsZhTranslation(item.title),
  summary: needsZhTranslation(item.summary),
});

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
} = {}) {
  const requirements = items.map(requiredFields);
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

  const remaining = unresolvedFields(completed, requirements);
  const detail = remaining.map(({ i, field }) => `${i + 1}.${field}`).join(', ');
  const cause = lastError?.message ? `：${lastError.message}` : '';
  throw new Error(`飞书中文翻译未完成（${detail}）${cause}，已阻止英文推送`);
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
