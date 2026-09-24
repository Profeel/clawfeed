export const OPENROUTER_AUTO_FREE_RE = /^(?:auto|openrouter\/free(?:-latest)?)$/i;
export const SKIP_FREE_MODEL_RE = /safety|embed|tts|whisper|lyria|ocr|rerank|moderation|[-_/]vl(?:[-_:]|$)|vision/;

export function isOpenRouterAutoFreeModel(model) {
  return OPENROUTER_AUTO_FREE_RE.test(String(model || ''));
}

export function normalizeOpenRouterAutoModel(baseUrl, model) {
  if (!/openrouter/i.test(String(baseUrl || ''))) return model;
  return isOpenRouterAutoFreeModel(model) ? 'openrouter/free-latest' : model;
}

export function isOpenRouterFreeModel(model) {
  const id = model?.id || '';
  const pricing = model?.pricing || {};
  return id.endsWith(':free')
    || id === 'openrouter/free'
    || (String(pricing.prompt) === '0' && String(pricing.completion) === '0');
}

export function isUsableFreeChatModel(model) {
  const id = String(model?.id || '').toLowerCase();
  if (!id || SKIP_FREE_MODEL_RE.test(id)) return false;
  const architecture = model?.architecture || {};
  const outputs = architecture.output_modalities || [];
  const inputs = architecture.input_modalities || [];
  if (outputs.length && !outputs.includes('text')) return false;
  if (inputs.length && !inputs.includes('text')) return false;
  return (model?.context_length || 0) >= 16_000;
}

export function selectLatestOpenRouterFreeModels(models, { limit = 4 } = {}) {
  const ids = (models || [])
    .filter((model) => isOpenRouterFreeModel(model) && isUsableFreeChatModel(model))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map((model) => model.id)
    .filter((id) => id && id !== 'openrouter/free');
  const selected = [...new Set(ids)].slice(0, limit);
  return [...selected.slice(0, 2), 'openrouter/free', ...selected.slice(2)];
}

export function expandOpenRouterAutoProviders(providers, modelIds) {
  const expanded = [];
  const seen = new Set();
  const fallbackIds = modelIds?.length ? modelIds : ['openrouter/free'];

  for (const provider of providers || []) {
    const shouldExpand = /openrouter/i.test(provider?.baseUrl || '')
      && isOpenRouterAutoFreeModel(provider?.model);
    const models = shouldExpand ? fallbackIds : [provider?.model];
    for (const model of models) {
      if (!provider?.apiKey || !provider?.baseUrl || !model) continue;
      const identity = `${provider.baseUrl}\n${model}\n${provider.apiKey}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      expanded.push({ ...provider, model });
    }
  }

  return expanded;
}
