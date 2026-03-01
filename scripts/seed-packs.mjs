#!/usr/bin/env node
/**
 * 添加精选 Source Packs 到 Explore 市场
 * 用法: node scripts/seed-packs.mjs
 *
 * 新增：思想领袖、AI 资本、AI 公司、AI 开发者等精选合集
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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

const dbPath = process.env.DIGEST_DB || env.DIGEST_DB || join(ROOT, 'data', 'digest.db');

if (!existsSync(dbPath)) {
  console.error('❌ 数据库不存在，请先启动服务器: npm start');
  process.exit(1);
}

const { default: Database } = await import('better-sqlite3');
const db = new Database(dbPath);

// 获取一个有效用户 ID 作为创建者（优先用已存在 pack 的 created_by）
const systemUser = db.prepare('SELECT created_by FROM source_packs LIMIT 1').get();
const createdBy = systemUser?.created_by ?? db.prepare('SELECT id FROM users LIMIT 1').get()?.id ?? 1;

const NEW_PACKS = [
  // ── 原有 Packs ──────────────────────────────────────────────────────────
  {
    name: '🧠 思想领袖与宏观思维',
    slug: 'thought-leaders',
    description: '瑞·达利欧、Paul Graham、Naval 等顶尖思想家与投资人的洞见，宏观视角看经济与科技',
    sources: [
      { name: 'Ray Dalio', type: 'twitter_feed', config: { handle: '@RayDalio' }, icon: '📊' },
      { name: 'Paul Graham', type: 'rss', config: { url: 'https://filipesilva.github.io/paulgraham-rss/feed.rss' }, icon: '📝' },
      { name: 'Naval Ravikant', type: 'twitter_feed', config: { handle: '@naval' }, icon: '🐦' },
      { name: 'Marc Andreessen', type: 'twitter_feed', config: { handle: '@pmarca' }, icon: '🐦' },
      { name: 'Reid Hoffman', type: 'twitter_feed', config: { handle: '@reidhoffman' }, icon: '🐦' },
    ],
  },
  {
    name: '💰 AI 资本与投资人',
    slug: 'ai-capital',
    description: 'a16z、Elad Gil、Chris Dixon 等顶级 VC 与投资人视角，把握 AI 投资风向',
    sources: [
      { name: 'a16z News', type: 'rss', config: { url: 'https://a16z.news/feed' }, icon: '📡' },
      { name: 'Elad Gil', type: 'rss', config: { url: 'https://blog.eladgil.com/feed' }, icon: '📡' },
      { name: 'Chris Dixon', type: 'twitter_feed', config: { handle: '@cdixon' }, icon: '🐦' },
      { name: 'Sarah Guo', type: 'twitter_feed', config: { handle: '@saranormous' }, icon: '🐦' },
      { name: 'Elad Gil (X)', type: 'twitter_feed', config: { handle: '@eladgil' }, icon: '🐦' },
      { name: 'Nat Friedman', type: 'twitter_feed', config: { handle: '@natfriedman' }, icon: '🐦' },
    ],
  },
  {
    name: '🏢 AI 公司与实验室',
    slug: 'ai-companies',
    description: 'OpenAI、Anthropic、DeepMind、Google 等 AI 巨头的官方动态',
    sources: [
      { name: 'OpenAI Blog', type: 'rss', config: { url: 'https://openai.com/news/rss.xml' }, icon: '📡' },
      { name: 'DeepMind Blog', type: 'rss', config: { url: 'https://deepmind.google/blog/rss.xml' }, icon: '📡' },
      { name: 'Anthropic', type: 'twitter_feed', config: { handle: '@AnthropicAI' }, icon: '🐦' },
      { name: 'OpenAI', type: 'twitter_feed', config: { handle: '@OpenAI' }, icon: '🐦' },
      { name: 'Google DeepMind', type: 'twitter_feed', config: { handle: '@GoogleDeepMind' }, icon: '🐦' },
      { name: 'Microsoft AI', type: 'twitter_feed', config: { handle: '@MSFTResearch' }, icon: '🐦' },
    ],
  },
  {
    name: '👨‍💻 AI 开发者与研究者',
    slug: 'ai-builders',
    description: 'Karpathy、LeCun、Hinton、Demis 等顶尖 AI 研究者与工程师的一手洞察',
    sources: [
      { name: 'Andrej Karpathy', type: 'twitter_feed', config: { handle: '@karpathy' }, icon: '🐦' },
      { name: 'Yann LeCun', type: 'twitter_feed', config: { handle: '@ylecun' }, icon: '🐦' },
      { name: 'Geoffrey Hinton', type: 'twitter_feed', config: { handle: '@geoffreyhinton' }, icon: '🐦' },
      { name: 'Demis Hassabis', type: 'twitter_feed', config: { handle: '@demishassabis' }, icon: '🐦' },
      { name: 'Sam Altman', type: 'twitter_feed', config: { handle: '@sama' }, icon: '🐦' },
      { name: 'Dario Amodei', type: 'twitter_feed', config: { handle: '@darioamodei' }, icon: '🐦' },
      { name: 'Andrew Ng', type: 'twitter_feed', config: { handle: '@AndrewYNg' }, icon: '🐦' },
      { name: 'Ilya Sutskever', type: 'twitter_feed', config: { handle: '@ilyasut' }, icon: '🐦' },
    ],
  },

  // ── 新增 Packs ──────────────────────────────────────────────────────────

  {
    name: '🚀 AI 明星产品',
    slug: 'ai-star-products',
    description: 'Cursor、Vercel v0、Midjourney、Perplexity、Replit 等现象级 AI 产品的官方动态',
    sources: [
      { name: 'Cursor', type: 'twitter_feed', config: { handle: '@cursor_ai' }, icon: '🐦' },
      { name: 'Vercel', type: 'rss', config: { url: 'https://vercel.com/atom' }, icon: '📡' },
      { name: 'Vercel v0', type: 'twitter_feed', config: { handle: '@v0' }, icon: '🐦' },
      { name: 'Midjourney', type: 'twitter_feed', config: { handle: '@midjourney' }, icon: '🐦' },
      { name: 'Perplexity AI', type: 'twitter_feed', config: { handle: '@perplexity_ai' }, icon: '🐦' },
      { name: 'Replit', type: 'twitter_feed', config: { handle: '@Replit' }, icon: '🐦' },
      { name: 'Replit Blog', type: 'rss', config: { url: 'https://blog.replit.com/feed.xml' }, icon: '📡' },
      { name: 'Notion', type: 'twitter_feed', config: { handle: '@NotionHQ' }, icon: '🐦' },
      { name: 'Linear', type: 'twitter_feed', config: { handle: '@linear' }, icon: '🐦' },
      { name: 'Supabase', type: 'rss', config: { url: 'https://supabase.com/blog/rss.xml' }, icon: '📡' },
    ],
  },
  {
    name: '🤖 AI Coding 工具',
    slug: 'ai-coding-tools',
    description: 'GitHub Copilot、Cursor、Devin、Windsurf、Codeium 等 AI 编程工具的最新动态',
    sources: [
      { name: 'GitHub Blog', type: 'rss', config: { url: 'https://github.blog/feed/' }, icon: '📡' },
      { name: 'GitHub Copilot', type: 'twitter_feed', config: { handle: '@GitHubCopilot' }, icon: '🐦' },
      { name: 'Cursor', type: 'twitter_feed', config: { handle: '@cursor_ai' }, icon: '🐦' },
      { name: 'Cognition (Devin)', type: 'twitter_feed', config: { handle: '@cognition_labs' }, icon: '🐦' },
      { name: 'Codeium / Windsurf', type: 'twitter_feed', config: { handle: '@codeiumdev' }, icon: '🐦' },
      { name: 'Sourcegraph (Cody)', type: 'rss', config: { url: 'https://sourcegraph.com/blog.atom' }, icon: '📡' },
      { name: 'Tabnine', type: 'twitter_feed', config: { handle: '@Tabnine' }, icon: '🐦' },
      { name: 'Bolt (StackBlitz)', type: 'twitter_feed', config: { handle: '@stackblitz' }, icon: '🐦' },
    ],
  },
  {
    name: '🦄 AI 独角兽与新锐',
    slug: 'ai-unicorns',
    description: 'xAI、Mistral、Cohere、Stability AI、Runway 等最受关注的 AI 新兴公司',
    sources: [
      { name: 'xAI (Elon Musk)', type: 'twitter_feed', config: { handle: '@xai' }, icon: '🐦' },
      { name: 'Mistral AI', type: 'twitter_feed', config: { handle: '@MistralAI' }, icon: '🐦' },
      { name: 'Cohere', type: 'twitter_feed', config: { handle: '@cohere' }, icon: '🐦' },
      { name: 'Stability AI', type: 'twitter_feed', config: { handle: '@StabilityAI' }, icon: '🐦' },
      { name: 'Runway', type: 'twitter_feed', config: { handle: '@runwayml' }, icon: '🐦' },
      { name: 'Hugging Face', type: 'twitter_feed', config: { handle: '@huggingface' }, icon: '🐦' },
      { name: 'Hugging Face Blog', type: 'rss', config: { url: 'https://huggingface.co/blog/feed.xml' }, icon: '📡' },
      { name: 'Together AI', type: 'twitter_feed', config: { handle: '@togetherai' }, icon: '🐦' },
      { name: 'Replicate', type: 'twitter_feed', config: { handle: '@replicate' }, icon: '🐦' },
      { name: 'Character AI', type: 'twitter_feed', config: { handle: '@character_ai' }, icon: '🐦' },
    ],
  },
  {
    name: '🇨🇳 中国 AI 力量',
    slug: 'china-ai',
    description: '百度、阿里、字节跳动、DeepSeek、智谱、MiniMax、月之暗面等中国 AI 公司动态',
    sources: [
      { name: '机器之心', type: 'rss', config: { url: 'https://www.jiqizhixin.com/rss' }, icon: '📡' },
      { name: '量子位', type: 'rss', config: { url: 'https://www.qbitai.com/feed' }, icon: '📡' },
      { name: '36氪 AI', type: 'rss', config: { url: 'https://36kr.com/feed' }, icon: '📡' },
      { name: 'DeepSeek', type: 'twitter_feed', config: { handle: '@deepseek_ai' }, icon: '🐦' },
      { name: 'Moonshot AI (月之暗面)', type: 'twitter_feed', config: { handle: '@MoonshotAI' }, icon: '🐦' },
      { name: 'MiniMax', type: 'twitter_feed', config: { handle: '@MiniMaxAI' }, icon: '🐦' },
      { name: '01.AI (零一万物)', type: 'twitter_feed', config: { handle: '@01ai_yi' }, icon: '🐦' },
      { name: '智谱 AI', type: 'twitter_feed', config: { handle: '@zhipuai' }, icon: '🐦' },
    ],
  },
  {
    name: '📰 顶级科技媒体',
    slug: 'top-tech-media',
    description: 'The Verge、TechCrunch、Ars Technica、Wired、The Information 等权威科技媒体',
    sources: [
      { name: 'The Verge', type: 'rss', config: { url: 'https://www.theverge.com/rss/index.xml' }, icon: '📡' },
      { name: 'TechCrunch', type: 'rss', config: { url: 'https://techcrunch.com/feed/' }, icon: '📡' },
      { name: 'Ars Technica', type: 'rss', config: { url: 'https://feeds.arstechnica.com/arstechnica/index' }, icon: '📡' },
      { name: 'Wired', type: 'rss', config: { url: 'https://www.wired.com/feed/rss' }, icon: '📡' },
      { name: 'VentureBeat', type: 'rss', config: { url: 'https://venturebeat.com/feed/' }, icon: '📡' },
      { name: 'The Information', type: 'twitter_feed', config: { handle: '@TheInformation' }, icon: '🐦' },
      { name: 'Semafor Tech', type: 'twitter_feed', config: { handle: '@SemaforTech' }, icon: '🐦' },
      { name: 'Bloomberg Technology', type: 'twitter_feed', config: { handle: '@technology' }, icon: '🐦' },
    ],
  },
  {
    name: '📝 顶级技术博客',
    slug: 'top-tech-blogs',
    description: 'Simon Willison、Lilian Weng、Chip Huyen、Colah 等技术大牛的深度博客',
    sources: [
      { name: 'Simon Willison', type: 'rss', config: { url: 'https://simonwillison.net/atom/everything/' }, icon: '📡' },
      { name: 'Lilian Weng (OpenAI)', type: 'rss', config: { url: 'https://lilianweng.github.io/index.xml' }, icon: '📡' },
      { name: 'Chip Huyen', type: 'rss', config: { url: 'https://huyenchip.com/feed.xml' }, icon: '📡' },
      { name: 'Sebastian Raschka', type: 'rss', config: { url: 'https://magazine.sebastianraschka.com/feed' }, icon: '📡' },
      { name: 'Jay Alammar', type: 'rss', config: { url: 'https://jalammar.github.io/feed.xml' }, icon: '📡' },
      { name: 'Eugene Yan', type: 'rss', config: { url: 'https://eugeneyan.com/rss/' }, icon: '📡' },
      { name: 'Lenny Rachitsky', type: 'rss', config: { url: 'https://www.lennysnewsletter.com/feed' }, icon: '📡' },
      { name: 'swyx (Latent Space)', type: 'rss', config: { url: 'https://www.latent.space/feed' }, icon: '📡' },
      { name: 'The Pragmatic Engineer', type: 'rss', config: { url: 'https://blog.pragmaticengineer.com/rss/' }, icon: '📡' },
    ],
  },
  {
    name: '☁️ 云计算与 Infra',
    slug: 'cloud-infra',
    description: 'AWS、Cloudflare、Vercel、Fly.io、Railway 等云平台与基础设施的最新动态',
    sources: [
      { name: 'AWS Blog', type: 'rss', config: { url: 'https://aws.amazon.com/blogs/aws/feed/' }, icon: '📡' },
      { name: 'Cloudflare Blog', type: 'rss', config: { url: 'https://blog.cloudflare.com/rss/' }, icon: '📡' },
      { name: 'Vercel Blog', type: 'rss', config: { url: 'https://vercel.com/atom' }, icon: '📡' },
      { name: 'Fly.io Blog', type: 'rss', config: { url: 'https://fly.io/blog/feed.xml' }, icon: '📡' },
      { name: 'Railway', type: 'twitter_feed', config: { handle: '@Railway' }, icon: '🐦' },
      { name: 'Netlify Blog', type: 'rss', config: { url: 'https://www.netlify.com/blog/feed.xml' }, icon: '📡' },
      { name: 'PlanetScale', type: 'rss', config: { url: 'https://planetscale.com/blog/rss.xml' }, icon: '📡' },
      { name: 'Neon (Serverless Postgres)', type: 'rss', config: { url: 'https://neon.tech/blog/rss.xml' }, icon: '📡' },
    ],
  },
  {
    name: '⚛️ 前端与全栈框架',
    slug: 'frontend-fullstack',
    description: 'React、Next.js、Svelte、Vue、Astro、Tailwind 等主流框架的官方博客与更新',
    sources: [
      { name: 'React Blog', type: 'rss', config: { url: 'https://react.dev/blog/rss.xml' }, icon: '📡' },
      { name: 'Next.js Blog', type: 'rss', config: { url: 'https://nextjs.org/feed.xml' }, icon: '📡' },
      { name: 'Svelte Blog', type: 'rss', config: { url: 'https://svelte.dev/blog/rss.xml' }, icon: '📡' },
      { name: 'Astro Blog', type: 'rss', config: { url: 'https://astro.build/rss.xml' }, icon: '📡' },
      { name: 'Tailwind CSS Blog', type: 'rss', config: { url: 'https://tailwindcss.com/feeds/feed.xml' }, icon: '📡' },
      { name: 'Deno Blog', type: 'rss', config: { url: 'https://deno.com/blog/rss.xml' }, icon: '📡' },
      { name: 'Bun Blog', type: 'rss', config: { url: 'https://bun.sh/blog/rss.xml' }, icon: '📡' },
      { name: 'web.dev', type: 'rss', config: { url: 'https://web.dev/feed.xml' }, icon: '📡' },
    ],
  },
  {
    name: '🔬 AI 学术与前沿研究',
    slug: 'ai-research',
    description: 'arXiv AI 论文、Google Research、Meta AI、Papers With Code 等学术前沿',
    sources: [
      { name: 'Google Research Blog', type: 'rss', config: { url: 'https://blog.research.google/feeds/posts/default?alt=rss' }, icon: '📡' },
      { name: 'Meta AI Blog', type: 'rss', config: { url: 'https://ai.meta.com/blog/rss/' }, icon: '📡' },
      { name: 'NVIDIA AI Blog', type: 'rss', config: { url: 'https://blogs.nvidia.com/feed/' }, icon: '📡' },
      { name: 'Apple Machine Learning', type: 'rss', config: { url: 'https://machinelearning.apple.com/rss.xml' }, icon: '📡' },
      { name: 'Papers With Code', type: 'twitter_feed', config: { handle: '@paperswithcode' }, icon: '🐦' },
      { name: 'AK (ML 论文精选)', type: 'twitter_feed', config: { handle: '@_akhaliq' }, icon: '🐦' },
      { name: 'r/MachineLearning', type: 'reddit', config: { subreddit: 'MachineLearning', sort: 'hot', limit: 15 }, icon: '🔗' },
    ],
  },
  {
    name: '🎨 AI 创意与设计',
    slug: 'ai-creative',
    description: 'Midjourney、Runway、Pika、ElevenLabs、Suno 等 AI 创意工具的最新动态',
    sources: [
      { name: 'Midjourney', type: 'twitter_feed', config: { handle: '@midjourney' }, icon: '🐦' },
      { name: 'Runway', type: 'twitter_feed', config: { handle: '@runwayml' }, icon: '🐦' },
      { name: 'Pika', type: 'twitter_feed', config: { handle: '@pika_labs' }, icon: '🐦' },
      { name: 'ElevenLabs', type: 'twitter_feed', config: { handle: '@elevenlabsio' }, icon: '🐦' },
      { name: 'Suno AI', type: 'twitter_feed', config: { handle: '@suno_ai_' }, icon: '🐦' },
      { name: 'Kling AI', type: 'twitter_feed', config: { handle: '@KlingAIOfficial' }, icon: '🐦' },
      { name: 'Figma Blog', type: 'rss', config: { url: 'https://www.figma.com/blog/feed/' }, icon: '📡' },
      { name: 'Adobe Blog', type: 'rss', config: { url: 'https://blog.adobe.com/en/publish/feed.xml' }, icon: '📡' },
    ],
  },
  {
    name: '🔐 网络安全与隐私',
    slug: 'cybersecurity',
    description: 'Krebs on Security、Schneier、The Hacker News 等安全领域权威信息源',
    sources: [
      { name: 'Krebs on Security', type: 'rss', config: { url: 'https://krebsonsecurity.com/feed/' }, icon: '📡' },
      { name: 'Schneier on Security', type: 'rss', config: { url: 'https://www.schneier.com/feed/atom/' }, icon: '📡' },
      { name: 'The Hacker News (Security)', type: 'rss', config: { url: 'https://feeds.feedburner.com/TheHackersNews' }, icon: '📡' },
      { name: 'r/netsec', type: 'reddit', config: { subreddit: 'netsec', sort: 'hot', limit: 15 }, icon: '🔗' },
      { name: 'Dark Reading', type: 'rss', config: { url: 'https://www.darkreading.com/rss.xml' }, icon: '📡' },
      { name: 'Troy Hunt', type: 'rss', config: { url: 'https://www.troyhunt.com/rss/' }, icon: '📡' },
    ],
  },
  {
    name: '🎮 开源与 GitHub 热门',
    slug: 'open-source-trending',
    description: 'GitHub Trending、Hacker News、r/SelfHosted 等开源社区的热门项目与讨论',
    sources: [
      { name: 'GitHub Trending (All)', type: 'github_trending', config: { language: 'all', since: 'daily' }, icon: '⭐' },
      { name: 'GitHub Trending (Python)', type: 'github_trending', config: { language: 'python', since: 'daily' }, icon: '🐍' },
      { name: 'GitHub Trending (TypeScript)', type: 'github_trending', config: { language: 'typescript', since: 'daily' }, icon: '📘' },
      { name: 'GitHub Trending (Rust)', type: 'github_trending', config: { language: 'rust', since: 'daily' }, icon: '🦀' },
      { name: 'Hacker News', type: 'hackernews', config: { filter: 'top', min_score: 80, limit: 25 }, icon: '🔶' },
      { name: 'r/SelfHosted', type: 'reddit', config: { subreddit: 'selfhosted', sort: 'hot', limit: 15 }, icon: '🔗' },
      { name: 'r/opensource', type: 'reddit', config: { subreddit: 'opensource', sort: 'hot', limit: 10 }, icon: '🔗' },
    ],
  },
  {
    name: '🐳 DevOps 与平台工程',
    slug: 'devops-platform',
    description: 'Docker、Kubernetes、Terraform、HashiCorp 等 DevOps 与平台工程的信息源',
    sources: [
      { name: 'Docker Blog', type: 'rss', config: { url: 'https://www.docker.com/blog/feed/' }, icon: '📡' },
      { name: 'Kubernetes Blog', type: 'rss', config: { url: 'https://kubernetes.io/feed.xml' }, icon: '📡' },
      { name: 'HashiCorp Blog', type: 'rss', config: { url: 'https://www.hashicorp.com/blog/feed.xml' }, icon: '📡' },
      { name: 'Grafana Blog', type: 'rss', config: { url: 'https://grafana.com/blog/index.xml' }, icon: '📡' },
      { name: 'r/devops', type: 'reddit', config: { subreddit: 'devops', sort: 'hot', limit: 15 }, icon: '🔗' },
      { name: 'CNCF Blog', type: 'rss', config: { url: 'https://www.cncf.io/blog/feed/' }, icon: '📡' },
    ],
  },
  {
    name: '📊 数据与 LLMOps',
    slug: 'data-llmops',
    description: 'LangChain、LlamaIndex、Weights & Biases、dbt 等数据与 LLM 工具链的动态',
    sources: [
      { name: 'LangChain Blog', type: 'rss', config: { url: 'https://blog.langchain.dev/rss/' }, icon: '📡' },
      { name: 'LlamaIndex Blog', type: 'rss', config: { url: 'https://www.llamaindex.ai/blog/rss.xml' }, icon: '📡' },
      { name: 'Weights & Biases', type: 'rss', config: { url: 'https://wandb.ai/fully-connected/rss.xml' }, icon: '📡' },
      { name: 'LangChain', type: 'twitter_feed', config: { handle: '@LangChainAI' }, icon: '🐦' },
      { name: 'LlamaIndex', type: 'twitter_feed', config: { handle: '@llama_index' }, icon: '🐦' },
      { name: 'r/LangChain', type: 'reddit', config: { subreddit: 'LangChain', sort: 'hot', limit: 10 }, icon: '🔗' },
      { name: 'r/LocalLLaMA', type: 'reddit', config: { subreddit: 'LocalLLaMA', sort: 'hot', limit: 15 }, icon: '🔗' },
    ],
  },
  {
    name: '💼 SaaS 创业与产品',
    slug: 'saas-startup',
    description: 'Indie Hackers、Product Hunt、Lenny、First Round Review 等创业与产品管理精选',
    sources: [
      { name: 'Product Hunt', type: 'rss', config: { url: 'https://www.producthunt.com/feed' }, icon: '📡' },
      { name: 'Indie Hackers', type: 'rss', config: { url: 'https://www.indiehackers.com/feed.xml' }, icon: '📡' },
      { name: "Lenny's Newsletter", type: 'rss', config: { url: 'https://www.lennysnewsletter.com/feed' }, icon: '📡' },
      { name: 'First Round Review', type: 'rss', config: { url: 'https://review.firstround.com/feed.xml' }, icon: '📡' },
      { name: 'Y Combinator Blog', type: 'rss', config: { url: 'https://www.ycombinator.com/blog/rss/' }, icon: '📡' },
      { name: 'r/SaaS', type: 'reddit', config: { subreddit: 'SaaS', sort: 'hot', limit: 10 }, icon: '🔗' },
      { name: 'r/startups', type: 'reddit', config: { subreddit: 'startups', sort: 'hot', limit: 10 }, icon: '🔗' },
    ],
  },
  {
    name: '🌐 Web3 与区块链',
    slug: 'web3-crypto',
    description: 'Vitalik、a16z crypto、CoinDesk 等 Web3 与加密货币领域的权威信息源',
    sources: [
      { name: 'Vitalik Buterin', type: 'rss', config: { url: 'https://vitalik.eth.limo/feed.xml' }, icon: '📡' },
      { name: 'a16z Crypto', type: 'rss', config: { url: 'https://a16zcrypto.com/posts/rss/' }, icon: '📡' },
      { name: 'CoinDesk', type: 'rss', config: { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' }, icon: '📡' },
      { name: 'The Block', type: 'twitter_feed', config: { handle: '@TheBlock__' }, icon: '🐦' },
      { name: 'r/ethereum', type: 'reddit', config: { subreddit: 'ethereum', sort: 'hot', limit: 10 }, icon: '🔗' },
      { name: 'r/CryptoCurrency', type: 'reddit', config: { subreddit: 'CryptoCurrency', sort: 'hot', limit: 10 }, icon: '🔗' },
    ],
  },
  {
    name: '🧑‍💼 AI 网红 KOL',
    slug: 'ai-kol',
    description: 'Jim Fan、Emad、swyx、TheAIGRID 等 AI 领域最活跃的内容创作者与 KOL',
    sources: [
      { name: 'Jim Fan (NVIDIA)', type: 'twitter_feed', config: { handle: '@DrJimFan' }, icon: '🐦' },
      { name: 'Emad Mostaque', type: 'twitter_feed', config: { handle: '@EMostaque' }, icon: '🐦' },
      { name: 'swyx', type: 'twitter_feed', config: { handle: '@swyx' }, icon: '🐦' },
      { name: 'Shawn Wang (Latent Space)', type: 'rss', config: { url: 'https://www.latent.space/feed' }, icon: '📡' },
      { name: 'Riley Brown', type: 'twitter_feed', config: { handle: '@rileygobrn' }, icon: '🐦' },
      { name: 'Matt Shumer', type: 'twitter_feed', config: { handle: '@mattshumer_' }, icon: '🐦' },
      { name: 'Ethan Mollick', type: 'twitter_feed', config: { handle: '@emollick' }, icon: '🐦' },
      { name: 'Ethan Mollick Blog', type: 'rss', config: { url: 'https://www.oneusefulthing.org/feed' }, icon: '📡' },
      { name: 'AI Jason', type: 'twitter_feed', config: { handle: '@jxnlco' }, icon: '🐦' },
      { name: 'The Rundown AI', type: 'twitter_feed', config: { handle: '@TheRundownAI' }, icon: '🐦' },
    ],
  },
];

const insertStmt = db.prepare(
  `INSERT INTO source_packs (name, description, slug, sources_json, created_by, is_public)
   VALUES (?, ?, ?, ?, ?, 1)`
);

const getBySlug = db.prepare('SELECT id FROM source_packs WHERE slug = ?');

console.log('正在添加精选 Source Packs...\n');

let added = 0;
let skipped = 0;

for (const pack of NEW_PACKS) {
  const existing = getBySlug.get(pack.slug);
  if (existing) {
    console.log(`  ⏭  已存在: ${pack.name} (${pack.slug})`);
    skipped++;
    continue;
  }

  const sourcesJson = JSON.stringify(pack.sources);
  insertStmt.run(pack.name, pack.description || '', pack.slug, sourcesJson, createdBy);
  console.log(`  ✅ 添加: ${pack.name} — ${pack.sources.length} 个信息源`);
  added++;
}

db.close();

console.log(`\n完成！新增 ${added} 个 Pack，跳过 ${skipped} 个（已存在）。`);
console.log('\n在 Web 界面 Explore → Source Packs Market 中可安装这些合集。');
