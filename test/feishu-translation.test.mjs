import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEISHU_CARD_PROMPT,
  attachFeishuSourceText,
  isFeishuWebhookUrl,
  isGarbledChinese,
  maskFeishuWebhookUrl,
  needsZhTranslation,
  parseTranslatedItems,
  prepareFeishuCardItem,
  resolveTranslationProvider,
  translateFeishuItems,
  translateFeishuText,
} from '../src/feishu-translation.mjs';

test('prefers configured LLM translation provider and normalizes OpenRouter auto model', () => {
  assert.deepEqual(resolveTranslationProvider({
    llmApiKey: 'openrouter-key',
    llmBaseUrl: 'https://openrouter.ai/api/v1/',
    llmModel: 'openrouter/free-latest',
    deepseekApiKey: 'siliconflow-key',
  }), {
    apiKey: 'openrouter-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free-latest',
    source: 'llm',
  });
});

test('explicit translation provider overrides LLM provider', () => {
  const provider = resolveTranslationProvider({
    translateApiKey: 'translation-key',
    translateBaseUrl: 'https://translation.example/v1/',
    translateModel: 'stable-model',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://openrouter.ai/api/v1',
  });
  assert.equal(provider.apiKey, 'translation-key');
  assert.equal(provider.baseUrl, 'https://translation.example/v1');
  assert.equal(provider.model, 'stable-model');
  assert.equal(provider.source, 'translate');
});

test('normalizes OpenRouter auto model for explicit translation provider only', () => {
  const openRouter = resolveTranslationProvider({
    translateApiKey: 'translation-key',
    translateBaseUrl: 'https://openrouter.ai/api/v1',
    translateModel: 'openrouter/free-latest',
  });
  assert.equal(openRouter.model, 'openrouter/free-latest');

  const otherProvider = resolveTranslationProvider({
    translateApiKey: 'translation-key',
    translateBaseUrl: 'https://translation.example/v1',
    translateModel: 'auto',
  });
  assert.equal(otherProvider.model, 'auto');
});

test('detects English prose but permits English proper nouns in Chinese copy', () => {
  assert.equal(needsZhTranslation('OpenAI launches GPT-5 with new coding features'), true);
  assert.equal(needsZhTranslation('OpenAI 发布 GPT-5 编程模型'), false);
  assert.equal(needsZhTranslation('Anthropic raises funding 新消息'), true);
  assert.equal(needsZhTranslation('OpenAI unveils Codex 升级'), true);
  assert.equal(needsZhTranslation('Anthropic expands Claude 全球布局'), true);
  assert.equal(needsZhTranslation('Google introduces Gemini 新功能'), true);
  assert.equal(needsZhTranslation('GPT wins 大赛'), true);
  assert.equal(needsZhTranslation('AI boom 来袭'), true);
  assert.equal(needsZhTranslation('AI News'), true);
  assert.equal(needsZhTranslation('Python SDK 发布新版本'), false);
  assert.equal(needsZhTranslation('Luna 输入定价仅 0.1 美元/百万 token，主打高并发场景'), false);
  assert.equal(needsZhTranslation('OpenAI发布GPT-6 Sol与Luna'), false);
  assert.equal(needsZhTranslation('a16z创办Horowitz Andreessen学院'), false);
  assert.equal(needsZhTranslation('a16z宣布在旧金山创办面向高中毕业生的全日制线下学校'), false);
  assert.equal(needsZhTranslation('新款智���手机可检测隐藏摄像头'), true);
});

test('rewrites corrupted Chinese fields before Feishu delivery', async () => {
  const result = await translateFeishuItems([
    { title: '智能手机检测隐藏摄像头', summary: '新款智���手机通过光谱分析识别隐藏设备。' },
  ], {
    apiKey: 'test-key',
    requestTranslation: async () =>
      '[{"i":0,"title":"智能手机检测隐藏摄像头","summary":"新款智能手机通过光谱分析识别隐藏设备。"}]',
  });
  assert.equal(result[0].summary, '新款智能手机通过光谱分析识别隐藏设备。');
});

test('parses JSON returned inside a markdown fence', () => {
  assert.deepEqual(
    parseTranslatedItems('```json\n[{"i":0,"title":"中文标题","summary":"这是一段中文摘要内容"}]\n```'),
    [{ i: 0, title: '中文标题', summary: '这是一段中文摘要内容' }],
  );
});

test('retries incomplete items and returns fully translated cards', async () => {
  const calls = [];
  const result = await translateFeishuItems([
    { title: 'OpenAI launches GPT-5', summary: 'The model improves coding and reasoning.' },
    { title: '已有中文标题', summary: '这是一段已经完整的中文摘要。' },
  ], {
    apiKey: 'test-key',
    requestTranslation: async (payload) => {
      calls.push(payload);
      if (calls.length === 1) return '[{"i":0,"title":"OpenAI 发布 GPT-5","summary":""}]';
      return '[{"i":0,"title":"OpenAI 发布 GPT-5","summary":"该模型提升了编程和推理能力。"}]';
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].map(({ i }) => i), [0]);
  assert.equal(result[0].title, 'OpenAI 发布 GPT-5');
  assert.equal(result[0].summary, '该模型提升了编程和推理能力。');
  assert.equal(result[1].title, '已有中文标题');
});

test('fails closed after repeated translation errors', async () => {
  await assert.rejects(
    translateFeishuItems([
      { title: 'OpenAI launches GPT-5', summary: 'The model improves coding and reasoning.' },
    ], {
      apiKey: 'test-key',
      attempts: 2,
      requestTranslation: async () => { throw new Error('rate limited'); },
    }),
    /已阻止英文推送/,
  );
});

test('blocks English before provider call when translation key is missing', async () => {
  let called = false;
  await assert.rejects(
    translateFeishuItems([
      { title: 'OpenAI launches GPT-5', summary: 'The model improves coding and reasoning.' },
    ], {
      requestTranslation: async () => { called = true; },
    }),
    /未配置 API Key.*已阻止英文推送/,
  );
  assert.equal(called, false);
});

test('rejects partially translated mixed-language fields', async () => {
  await assert.rejects(
    translateFeishuItems([
      { title: 'Anthropic raises funding 新消息', summary: 'The company raised a new round of funding.' },
    ], {
      apiKey: 'test-key',
      attempts: 1,
      requestTranslation: async () =>
        '[{"i":0,"title":"Anthropic raises funding 新消息","summary":"公司完成了新一轮融资。"}]',
    }),
    /1.title.*已阻止英文推送/,
  );
});

test('plain-text fallback is also fail-closed', async () => {
  await assert.rejects(
    translateFeishuText('This is an English digest that must not be pushed.', {
      apiKey: 'test-key',
      attempts: 2,
      requestTranslation: async () => 'still English',
    }),
    /已阻止英文推送/,
  );
});

test('Feishu card prompt asks for a whole-piece summary, not a lead translation', () => {
  assert.match(FEISHU_CARD_PROMPT, /总结|概括/);
  assert.match(FEISHU_CARD_PROMPT, /sourceText/);
  assert.match(FEISHU_CARD_PROMPT, /开头几句/);
  assert.match(FEISHU_CARD_PROMPT, /禁止编造/);
  assert.doesNotMatch(FEISHU_CARD_PROMPT, /把标题和摘要译成/);
});

test('prepares Feishu payload with source text instead of a short lead excerpt', () => {
  const prepared = prepareFeishuCardItem({
    title: 'OpenAI launches GPT-5',
    summary: 'OpenAI today announced GPT-5.',
    description: 'OpenAI today announced GPT-5. The model improves coding, reasoning, and long-context work. Researchers say it changes evaluation baselines across several public benchmarks.',
  });
  assert.equal(prepared.title, 'OpenAI launches GPT-5');
  assert.match(prepared.sourceText, /evaluation baselines/);
  assert.ok(prepared.sourceText.length > prepared.summary.length);
});

test('attaches longer source text from the original feed item by URL', () => {
  const [item] = attachFeishuSourceText(
    [{ title: '发布 GPT-5', url: 'https://example.com/gpt5/', summary: 'OpenAI today announced GPT-5.' }],
    [{
      title: 'OpenAI launches GPT-5',
      url: 'https://example.com/gpt5',
      description: 'The model improves coding and reasoning. It also changes how teams evaluate long-context tasks.',
    }],
  );
  assert.match(item.sourceText, /long-context tasks/);
  assert.match(item.sourceText, /OpenAI launches GPT-5/);
});

test('rewriteAll summarizes already-Chinese cards using sourceText', async () => {
  const calls = [];
  const result = await translateFeishuItems([
    {
      title: 'OpenAI 今日宣布 GPT-5',
      summary: 'OpenAI 今日宣布了 GPT-5。',
      sourceText: 'OpenAI launches GPT-5. The model improves coding and reasoning and resets several public benchmarks. Enterprise customers get a new evaluation suite.',
    },
  ], {
    apiKey: 'test-key',
    rewriteAll: true,
    requestTranslation: async (payload) => {
      calls.push(payload);
      return '[{"i":0,"title":"OpenAI 发布 GPT-5","summary":"该模型提升编程与推理，并重置多项公开评测基准。企业用户同时获得新的评估套件。"}]';
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0][0].sourceText, /evaluation suite/);
  assert.equal(result[0].title, 'OpenAI 发布 GPT-5');
  assert.match(result[0].summary, /评测基准/);
});

test('rejects spaced Chinese and accepts a normal Feishu webhook', () => {
  assert.equal(isGarbledChinese('马 斯 克 系 列 D 融 资'), true);
  assert.equal(isGarbledChinese('马斯克系列D融资3亿美元'), false);
  assert.equal(isFeishuWebhookUrl('https://open.feishu.cn/open-apis/bot/v2/hook/abc-123'), true);
  assert.equal(isFeishuWebhookUrl('https://example.com/open-apis/bot/v2/hook/abc-123'), false);
  assert.match(maskFeishuWebhookUrl('https://open.feishu.cn/open-apis/bot/v2/hook/abcd1234'), /\*\*\*\*1234/);
});

test('rewriteAll keeps original Chinese when the model inserts junk characters', async () => {
  const result = await translateFeishuItems([
    { title: '马斯克系列D融资', summary: '特斯拉完成新一轮融资，资金将用于储能业务。' },
  ], {
    apiKey: 'test-key',
    rewriteAll: true,
    attempts: 1,
    requestTranslation: async () =>
      '[{"i":0,"title":"马 斯 克 系 列 D 融 资","summary":"特 斯 拉 完 成 新 一 轮 融 资，资 金 将 用 于 储 能 业 务。"}]',
  });
  assert.equal(result[0].title, '马斯克系列D融资');
  assert.match(result[0].summary, /特斯拉完成新一轮融资/);
});

test('default mode still skips already-Chinese cards', async () => {
  let called = false;
  const result = await translateFeishuItems([
    { title: '已有中文标题', summary: '这是一段已经完整的中文摘要。' },
  ], {
    apiKey: 'test-key',
    requestTranslation: async () => {
      called = true;
      return '[]';
    },
  });
  assert.equal(called, false);
  assert.equal(result[0].title, '已有中文标题');
});
