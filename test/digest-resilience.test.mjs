import test from 'node:test';
import assert from 'node:assert/strict';

import {
  completeWithProviderFallback,
  getDigestPushHealth,
  resolveDigestProviders,
} from '../src/digest-resilience.mjs';

test('digest generation prefers the configured shared LLM and keeps DeepSeek as fallback', () => {
  const providers = resolveDigestProviders({
    llmApiKey: 'openrouter-key',
    llmBaseUrl: 'https://openrouter.ai/api/v1/',
    llmModel: 'openrouter/free-latest',
    deepseekApiKey: 'deepseek-key',
  });

  assert.deepEqual(providers.map(({ baseUrl, model, source }) => ({ baseUrl, model, source })), [
    { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', source: 'llm' },
    { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', source: 'deepseek' },
  ]);
});

test('explicit digest provider takes priority and duplicate providers are removed', () => {
  const providers = resolveDigestProviders({
    digestApiKey: 'same-key',
    digestBaseUrl: 'https://openrouter.ai/api/v1',
    digestModel: 'openrouter/free',
    llmApiKey: 'same-key',
    llmBaseUrl: 'https://openrouter.ai/api/v1',
    llmModel: 'openrouter/free',
  });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].source, 'digest');
});

test('completion automatically falls back after an empty primary response', async () => {
  const providers = resolveDigestProviders({
    llmApiKey: 'primary-key',
    llmBaseUrl: 'https://primary.example/v1',
    llmModel: 'primary-model',
    deepseekApiKey: 'fallback-key',
  });
  const calls = [];
  const completed = await completeWithProviderFallback(providers, {
    request: async (provider) => {
      calls.push(provider.source);
      return provider.source === 'llm'
        ? { choices: [{ message: { content: '' } }] }
        : { choices: [{ message: { content: '中文摘要' } }] };
    },
  });

  assert.deepEqual(calls, ['llm', 'deepseek']);
  assert.equal(completed.content, '中文摘要');
  assert.equal(completed.provider.source, 'deepseek');
});

test('completion retries the provider chain after transient failures', async () => {
  const providers = resolveDigestProviders({
    llmApiKey: 'key',
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'model',
  });
  let calls = 0;
  const completed = await completeWithProviderFallback(providers, {
    attempts: 2,
    request: async () => {
      calls++;
      if (calls === 1) throw new Error('rate limited');
      return { choices: [{ message: { content: '恢复成功' } }] };
    },
  });

  assert.equal(calls, 2);
  assert.equal(completed.content, '恢复成功');
});

test('completion accepts provider reasoning when content is empty', async () => {
  const providers = resolveDigestProviders({
    llmApiKey: 'key',
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'reasoning-model',
  });
  const completed = await completeWithProviderFallback(providers, {
    request: async () => ({ choices: [{ message: { content: '', reasoning: '中文结果' } }] }),
  });
  assert.equal(completed.content, '中文结果');
});

test('digest push health reports stale Feishu delivery without breaking disabled environments', () => {
  assert.deepEqual(getDigestPushHealth({ enabled: false }), {
    status: 'disabled',
    lastPushedAt: null,
  });
  assert.equal(getDigestPushHealth({ enabled: true }).status, 'unknown');
  assert.equal(getDigestPushHealth({
    enabled: true,
    lastPushedAt: '2026-08-30 00:05:22',
    now: Date.parse('2026-09-01T00:05:22Z'),
    maxAgeHours: 8,
  }).status, 'stale');
});
