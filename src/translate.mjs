import https from 'https';

const SILICONFLOW_HOST = 'api.siliconflow.cn';
const SILICONFLOW_PATH = '/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V3';
const REQUEST_TIMEOUT_MS = 60000;

/**
 * Call SiliconFlow (DeepSeek) API with given messages.
 * @param {string} apiKey
 * @param {{ model?: string, messages: object[], temperature?: number, max_tokens?: number }} options
 */
function callApi(apiKey, { model = DEFAULT_MODEL, messages, temperature = 0.3, max_tokens = 2048 }) {
  const payload = JSON.stringify({ model, messages, temperature, max_tokens });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: SILICONFLOW_HOST,
        path: SILICONFLOW_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON from SiliconFlow: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Translation request timed out'));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Translate a single piece of text to Chinese (or targetLang).
 * @param {string} apiKey - SiliconFlow API key
 * @param {string} text
 * @param {{ model?: string, targetLang?: string }} options
 * @returns {Promise<string>}
 */
export async function translateText(apiKey, text, { model = DEFAULT_MODEL, targetLang = '中文' } = {}) {
  if (!apiKey) throw new Error('DeepSeek API key not configured');
  if (!text || !text.trim()) return text;

  const result = await callApi(apiKey, {
    model,
    messages: [
      {
        role: 'system',
        content: `你是专业翻译助手。请将用户提供的内容翻译成${targetLang}，保持原文格式和语气，只返回翻译结果，不添加任何解释或注释。`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });

  const translated = result.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error(result.error?.message || 'Empty translation response');
  return translated;
}

/**
 * Translate an array of RSS items (title + description) to Chinese in one API call.
 * Preserves the original item structure, only replacing title and description.
 * @param {string} apiKey - SiliconFlow API key
 * @param {Array<{ title?: string, description?: string, url?: string, [key: string]: any }>} items
 * @param {{ model?: string }} options
 * @returns {Promise<typeof items>}
 */
export async function translateRssItems(apiKey, items, { model = DEFAULT_MODEL } = {}) {
  if (!apiKey) throw new Error('DeepSeek API key not configured');
  if (!items || items.length === 0) return items;

  // Build a numbered list for efficient batch translation
  const numbered = items.map((item, i) => {
    const lines = [`[${i + 1}]`];
    lines.push(`标题: ${item.title || '(无标题)'}`);
    const excerpt = (item.description || item.content || '').slice(0, 600);
    if (excerpt) lines.push(`摘要: ${excerpt}`);
    return lines.join('\n');
  });

  const prompt = numbered.join('\n\n');

  const result = await callApi(apiKey, {
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是专业的新闻翻译助手。请将下列编号文章的标题和摘要翻译成中文。\n' +
          '严格保持以下输出格式（每篇用空行分隔）：\n' +
          '[编号]\n标题: <翻译后标题>\n摘要: <翻译后摘要>\n\n' +
          '若原文无摘要则省略摘要行。只返回翻译结果，不添加任何其他内容。',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const translated = result.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error(result.error?.message || 'Empty translation response');

  // Parse the numbered output back into structured items
  const translatedItems = items.map((item) => ({ ...item }));

  // Split by [N] markers
  const blocks = translated.split(/(?=\[\d+\])/);
  for (const block of blocks) {
    const numMatch = block.match(/^\[(\d+)\]/);
    if (!numMatch) continue;
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx < 0 || idx >= items.length) continue;

    const titleMatch = block.match(/标题[:：]\s*(.+)/);
    const descMatch = block.match(/摘要[:：]\s*([\s\S]+?)(?=\n\[|$)/);

    if (titleMatch) translatedItems[idx].title = titleMatch[1].trim();
    if (descMatch) translatedItems[idx].description = descMatch[1].trim();
  }

  return translatedItems;
}
