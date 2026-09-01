const SILICONFLOW = {
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'deepseek-ai/DeepSeek-V3',
};

const normalizeModel = (baseUrl, model, fallbackModel) => {
  const configured = model || fallbackModel;
  return /openrouter/i.test(baseUrl) && /^(?:auto|openrouter\/free-latest)$/i.test(configured)
    ? 'openrouter/free'
    : configured;
};

const addProvider = (providers, seen, { apiKey, baseUrl, model, source }) => {
  if (!apiKey || !baseUrl || !model) return;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedModel = normalizeModel(normalizedBaseUrl, model, SILICONFLOW.model);
  const identity = `${normalizedBaseUrl}\n${normalizedModel}\n${apiKey}`;
  if (seen.has(identity)) return;
  seen.add(identity);
  providers.push({ apiKey, baseUrl: normalizedBaseUrl, model: normalizedModel, source });
};

export function resolveDigestProviders({
  digestApiKey = '',
  digestBaseUrl = '',
  digestModel = '',
  llmApiKey = '',
  llmBaseUrl = '',
  llmModel = '',
  deepseekApiKey = '',
} = {}) {
  const providers = [];
  const seen = new Set();

  if (digestApiKey) {
    const baseUrl = digestBaseUrl || llmBaseUrl || SILICONFLOW.baseUrl;
    const fallbackModel = /openrouter/i.test(baseUrl) ? 'openrouter/free' : SILICONFLOW.model;
    addProvider(providers, seen, {
      apiKey: digestApiKey,
      baseUrl,
      model: digestModel || llmModel || fallbackModel,
      source: 'digest',
    });
  }

  if (llmApiKey && llmBaseUrl) {
    addProvider(providers, seen, {
      apiKey: llmApiKey,
      baseUrl: llmBaseUrl,
      model: llmModel || (/openrouter/i.test(llmBaseUrl) ? 'openrouter/free' : SILICONFLOW.model),
      source: 'llm',
    });
  }

  if (deepseekApiKey) {
    addProvider(providers, seen, {
      apiKey: deepseekApiKey,
      baseUrl: SILICONFLOW.baseUrl,
      model: SILICONFLOW.model,
      source: 'deepseek',
    });
  }

  return providers;
}

export function extractCompletionText(result) {
  const message = result?.choices?.[0]?.message || {};
  return String(message.content || message.reasoning_content || message.reasoning || '').trim();
}

const providerLabel = (provider) => `${provider.source}:${provider.model}`;

export async function completeWithProviderFallback(providers, {
  request,
  attempts = 3,
  onFailure = () => {},
  wait = () => Promise.resolve(),
} = {}) {
  if (!providers?.length) throw new Error('摘要 LLM 未配置');
  if (typeof request !== 'function') throw new Error('摘要 LLM 请求器不可用');

  const errors = [];
  for (let round = 1; round <= attempts; round++) {
    for (const provider of providers) {
      try {
        const result = await request(provider, round);
        if (result?.error) {
          throw new Error(result.error.message || result.error.msg || '服务返回错误');
        }
        const content = extractCompletionText(result);
        if (!content) throw new Error('返回空内容');
        return { result, content, provider };
      } catch (error) {
        const message = error?.message || String(error);
        errors.push(`${providerLabel(provider)} ${message}`);
        await onFailure({ provider, round, error });
      }
    }
    if (round < attempts) await wait(round);
  }

  throw new Error(`摘要 LLM 全部失败：${errors.slice(-providers.length * 2).join('；')}`);
}

export function getDigestPushHealth({
  enabled,
  lastPushedAt,
  now = Date.now(),
  maxAgeHours = 8,
} = {}) {
  if (!enabled) return { status: 'disabled', lastPushedAt: lastPushedAt || null };
  if (!lastPushedAt) return { status: 'unknown', lastPushedAt: null };

  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(lastPushedAt)
    ? lastPushedAt
    : `${lastPushedAt.replace(' ', 'T')}Z`;
  const pushedAtMs = new Date(normalized).getTime();
  if (!Number.isFinite(pushedAtMs)) return { status: 'invalid', lastPushedAt };

  const ageHours = Math.max(0, (now - pushedAtMs) / 3_600_000);
  return {
    status: ageHours <= maxAgeHours ? 'ok' : 'stale',
    lastPushedAt,
    ageHours: Number(ageHours.toFixed(1)),
    maxAgeHours,
  };
}
