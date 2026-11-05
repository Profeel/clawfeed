import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expandOpenRouterAutoProviders,
  isOpenRouterAutoFreeModel,
  normalizeOpenRouterAutoModel,
  selectLatestOpenRouterFreeModels,
} from '../src/openrouter-free.mjs';

test('treats OpenRouter auto aliases as latest-free selectors', () => {
  assert.equal(isOpenRouterAutoFreeModel('openrouter/free-latest'), true);
  assert.equal(isOpenRouterAutoFreeModel('openrouter/free'), true);
  assert.equal(isOpenRouterAutoFreeModel('auto'), true);
  assert.equal(isOpenRouterAutoFreeModel('anthropic/claude-sonnet-4'), false);
  assert.equal(
    normalizeOpenRouterAutoModel('https://openrouter.ai/api/v1', 'auto'),
    'openrouter/free-latest',
  );
  assert.equal(
    normalizeOpenRouterAutoModel('https://api.siliconflow.cn/v1', 'auto'),
    'auto',
  );
});

test('selects newest usable free chat models and keeps the router last', () => {
  const selected = selectLatestOpenRouterFreeModels([
    {
      id: 'vendor/old-free:free',
      created: 100,
      context_length: 32_000,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    {
      id: 'vendor/new-free:free',
      created: 300,
      context_length: 64_000,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    {
      id: 'vendor/image-only:free',
      created: 400,
      context_length: 64_000,
      architecture: { input_modalities: ['image'], output_modalities: ['image'] },
    },
    {
      id: 'vendor/flash-vl:free',
      created: 600,
      context_length: 64_000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    },
    {
      id: 'vendor/embed:free',
      created: 500,
      context_length: 64_000,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    {
      id: 'openrouter/free',
      created: 1,
      context_length: 128_000,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
  ], { limit: 1 });

  assert.deepEqual(selected, ['vendor/new-free:free', 'openrouter/free']);
});

test('expands OpenRouter auto providers into concrete free models', () => {
  const expanded = expandOpenRouterAutoProviders([
    {
      apiKey: 'or-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free-latest',
      source: 'llm',
    },
    {
      apiKey: 'sf-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V3',
      source: 'deepseek',
    },
  ], ['vendor/new-free:free', 'openrouter/free']);

  assert.deepEqual(expanded.map(({ model, source }) => ({ model, source })), [
    { model: 'vendor/new-free:free', source: 'llm' },
    { model: 'openrouter/free', source: 'llm' },
    { model: 'deepseek-ai/DeepSeek-V3', source: 'deepseek' },
  ]);
});
