# ClawFeed

> **Stop scrolling. Start knowing.**

[![GitHub](https://img.shields.io/github/v/tag/kevinho/clawfeed?label=version)](https://github.com/kevinho/clawfeed)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AI 驱动的资讯摘要系统，自动从多信息源抓取内容，通过 DeepSeek 生成结构化中文简报（4小时/日报/周报/月报），并以 RSS / JSON Feed 格式推送到你的阅读器。

![Dashboard](docs/demo.gif)

## 功能特性

- 📰 **多频次摘要** — 4小时简报、日报、周报、月报，按需生成
- 📡 **信息源管理** — 支持 RSS/Atom、Hacker News、Reddit、GitHub Trending 等
- 📦 **Source Packs** — 一键安装精选信息源合集，快速上手
- 📌 **收藏 & 深度分析** — 书签功能，支持 AI 深度摘要（`--deep` 模式）
- 🔄 **Web 端手动生成** — 登录后可在 Tab 栏一键触发当前类型的 Digest 生成，支持深度模式
- 📲 **RSS / JSON Feed** — 每篇文章独立推送，含 AI 简析和原文链接
- 📱 **手机号登录** — 阿里云短信验证码，无需 Google 账号
- 🌐 **中英文 UI** — 支持切换语言
- 🌙 **深色 / 浅色模式** — 主题自动保存
- 💾 **SQLite 存储** — 零配置，单文件数据库
- 🤖 **飞书/Lark 推送** — Digest 生成后自动推送到群机器人

## 快速开始

### 1. 安装依赖

```bash
git clone https://github.com/kevinho/clawfeed.git
cd clawfeed
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env   # 按需修改
```

### 3. 启动服务

```bash
npm start
# → API running on http://127.0.0.1:8767
```

### 4. 设置定时任务

```bash
bash scripts/setup-cron.sh
```

## 环境变量说明

| 变量 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `API_KEY` | 创建 Digest 用的 API Key | 是 | - |
| `DEEPSEEK_API_KEY` | SiliconFlow DeepSeek API Key（生成摘要） | 是 | - |
| `DIGEST_PORT` | 服务端口 | 否 | `8767` |
| `ALLOWED_ORIGINS` | CORS 允许的来源（逗号分隔） | 否 | `localhost` |
| `HTTP_PROXY` | 抓取脚本代理（访问 GitHub/Reddit 等） | 否 | - |
| `SMS_ACCESS_KEY_ID` | 阿里云短信 AccessKey ID | 否* | - |
| `SMS_ACCESS_KEY_SECRET` | 阿里云短信 AccessKey Secret | 否* | - |
| `SMS_SIGN_NAME` | 短信签名名称 | 否* | - |
| `SMS_TEMPLATE_CODE` | 短信模板 Code | 否* | - |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | 否† | - |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | 否† | - |
| `SESSION_SECRET` | Session 加密密钥 | 否† | - |
| `RSSHUB_URL` | RSSHub 实例地址（用于 Twitter/X 抓取） | 否‡ | - |
| `TWITTER_AUTH_TOKEN` | Twitter auth_token Cookie 值 | 否‡ | - |
| `TWITTER_CT0` | Twitter ct0 Cookie 值（可选） | 否 | - |
| `FEISHU_WEBHOOK` | 飞书群机器人 Webhook URL | 否 | - |
| `FEISHU_SECRET` | 飞书签名密钥 | 否 | - |
| `HTTPS_MODE` | 设为 `true` 开启 Secure Cookie（HTTPS 环境） | 否 | - |

\* 配置后启用手机号短信登录  
† 配置后启用 Google OAuth 登录  
‡ 配置后启用 Twitter/X 内容抓取（需自建 RSSHub 并配置 Cookie，详见下方说明）

## 登录方式

### 手机号登录（推荐）

在 [阿里云短信服务](https://dysms.console.aliyun.com/) 创建签名和模板后，填写以下 `.env` 配置即可启用：

```env
SMS_ACCESS_KEY_ID=your_access_key_id
SMS_ACCESS_KEY_SECRET=your_access_key_secret
SMS_SIGN_NAME=你的签名
SMS_TEMPLATE_CODE=SMS_XXXXXXXX
```

短信模板变量格式：`${code}`（6位验证码，有效期5分钟）

### Google OAuth（可选）

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 创建 OAuth 应用
2. 添加回调地址：`https://yourdomain.com/api/auth/callback`
3. 填写 `.env` 中的 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

## 内容抓取 & Digest 生成

### 命令行生成

```bash
# 手动生成一次 4小时简报
node scripts/fetch-and-digest.mjs --type 4h

# 生成日报
node scripts/fetch-and-digest.mjs --type daily

# 深度模式：对精选文章抓取原文生成 250 字深度摘要
node scripts/fetch-and-digest.mjs --type 4h --deep
```

### Web 端手动生成

登录后，在 Digest Tab 栏右侧会出现 **🔄 手动生成** 按钮：

1. 切换到目标类型的 Tab（4H / 日报 / 周报 / 月报）
2. 可选勾选「深度模式」复选框
3. 点击「🔄 手动生成」按钮触发后台生成
4. 生成任务在后台异步执行，完成后刷新列表即可看到新 Digest

> **注意**：手动生成需要登录账号，生成过程通常需要 1-3 分钟。

### 定时任务（Cron）

```bash
bash scripts/setup-cron.sh
```

安装后的定时计划：

| 频率 | 时间 | 类型 |
|------|------|------|
| 每 4 小时 | 整点 | 4H 简报 |
| 每天 | 08:00 | 日报 |
| 每周一 | 09:00 | 周报 |

日志位于 `data/logs/`。

## RSS 订阅

登录后，你的专属 RSS 地址为：

```
https://yourdomain.com/feed/{slug}.rss   # RSS 2.0
https://yourdomain.com/feed/{slug}.json  # JSON Feed 1.1
```

每篇文章独立推送，包含：
- **中文标题**（AI 重写）
- **2-3 句 AI 简析**（发生了什么 + 为什么重要 + 行业影响）
- **原文链接**（直接跳转）
- **分类标签**（重要动态 / 精选资讯）

## Nginx 反向代理（HTTPS）

将服务挂载到已有 HTTPS 域名下（推荐，解决 RSS 阅读器要求 HTTPS 的问题）：

```nginx
# 在现有 HTTPS server block 中添加：

# RSS Feed（供阅读器订阅）
location /feed/ {
    proxy_pass http://127.0.0.1:18767/feed/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ClawFeed 完整 UI
location /cf/ {
    proxy_pass http://127.0.0.1:18767/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

访问地址：
- Web 界面：`https://yourdomain.com/cf/`
- RSS 订阅：`https://yourdomain.com/feed/{slug}.rss`

## API 参考

### 摘要

| Method | Endpoint | 说明 | 鉴权 |
|--------|----------|------|------|
| `GET` | `/api/digests` | 列表 `?type=4h&limit=20&offset=0` | - |
| `GET` | `/api/digests/:id` | 单条摘要 | - |
| `POST` | `/api/digests` | 创建摘要 | API Key |
| `POST` | `/api/digests/generate` | 手动触发生成 `{ type, deep? }` | 登录用户 / API Key |

### 认证

| Method | Endpoint | 说明 | 鉴权 |
|--------|----------|------|------|
| `GET` | `/api/auth/config` | 查询可用登录方式 | - |
| `POST` | `/api/auth/sms/send` | 发送短信验证码 `{ phone }` | - |
| `POST` | `/api/auth/sms/verify` | 验证登录 `{ phone, code }` | - |
| `GET` | `/api/auth/google` | 发起 Google OAuth | - |
| `GET` | `/api/auth/callback` | OAuth 回调 | - |
| `GET` | `/api/auth/me` | 当前用户信息 | 是 |
| `POST` | `/api/auth/logout` | 退出登录 | 是 |

### 收藏

| Method | Endpoint | 说明 | 鉴权 |
|--------|----------|------|------|
| `GET` | `/api/marks` | 收藏列表 | 是 |
| `POST` | `/api/marks` | 添加收藏 `{ url, title?, note? }` | 是 |
| `DELETE` | `/api/marks/:id` | 删除收藏 | 是 |

### 信息源

| Method | Endpoint | 说明 | 鉴权 |
|--------|----------|------|------|
| `GET` | `/api/sources` | 信息源列表 | 是 |
| `POST` | `/api/sources` | 创建信息源 `{ name, type, config }` | 是 |
| `PUT` | `/api/sources/:id` | 更新信息源 | 是 |
| `DELETE` | `/api/sources/:id` | 软删除信息源 | 是 |
| `POST` | `/api/sources/resolve` | 自动识别 URL 类型 | 是 |

### Source Packs

| Method | Endpoint | 说明 | 鉴权 |
|--------|----------|------|------|
| `GET` | `/api/packs` | 公开合集列表 | - |
| `GET` | `/api/packs/:slug` | 合集详情 | - |
| `POST` | `/api/packs` | 创建合集 | 是 |
| `POST` | `/api/packs/:slug/install` | 安装合集 | 是 |
| `DELETE` | `/api/packs/:id` | 删除合集 | 是 |

### Feed

| Method | Endpoint | 说明 | 鉴权 |
|--------|----------|------|------|
| `GET` | `/feed/:slug` | Digest API | - |
| `GET` | `/feed/:slug.json` | JSON Feed 1.1 | - |
| `GET` | `/feed/:slug.rss` | RSS 2.0 | - |

## 信息源类型

| 类型 | 示例 | 说明 |
|------|------|------|
| `rss` | 任意 RSS/Atom URL | RSS 订阅源 |
| `hackernews` | - | Hacker News 热门 |
| `reddit` | `/r/MachineLearning` | Subreddit |
| `github_trending` | `language=python` | GitHub 趋势 |
| `twitter_feed` | `@karpathy` | X/Twitter 用户 |
| `twitter_list` | List URL | X/Twitter 列表 |
| `website` | 任意 URL | 网站抓取 |
| `digest_feed` | ClawFeed slug | 订阅其他用户的 Digest |

### Twitter/X 抓取配置

Twitter/X 信息源（`twitter_feed` / `twitter_list`）需要自建 [RSSHub](https://github.com/DIYgod/RSSHub) 实例并配置 Twitter Cookie。

#### 1. 获取 Twitter Cookie

1. 在浏览器中登录 [x.com](https://x.com)
2. 打开 DevTools（`F12` 或 `Cmd+Opt+I`）
3. 进入 **Application** → **Cookies** → `https://x.com`
4. 复制以下 Cookie 值：
   - `auth_token`：40 位十六进制字符串（**必需**）
   - `ct0`：随机字符串（可选，部分 RSSHub 版本需要）

#### 2. 部署 RSSHub

**Docker 方式（推荐）：**

```bash
docker run -d --name rsshub -p 1200:1200 \
  -e TWITTER_AUTH_TOKEN=你的auth_token值 \
  diygod/rsshub
```

**本地安装方式：**

```bash
git clone https://github.com/DIYgod/RSSHub.git /opt/rsshub
cd /opt/rsshub && npm install --legacy-peer-deps && npm run build
TWITTER_AUTH_TOKEN=你的auth_token值 PORT=1200 node dist/index.mjs
```

#### 3. 配置 ClawFeed .env

```env
RSSHUB_URL=http://localhost:1200
TWITTER_AUTH_TOKEN=你的auth_token值
TWITTER_CT0=你的ct0值
```

> **注意**：公共 Nitter 实例已于 2024 年被 Twitter/X 全面封锁，不再可用。未配置 `RSSHUB_URL` 时，Twitter 类信息源将返回空结果。Cookie 有效期通常为数月，失效后需重新获取。

## 架构

```
┌─────────────────────────────────────────┐
│  Web Browser / RSS Reader               │
└──────────────┬──────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────┐
│  Nginx (443/80)                         │
│  /feed/ → ClawFeed  /cf/ → ClawFeed     │
└──────────────┬──────────────────────────┘
               │ HTTP (localhost)
┌──────────────▼──────────────────────────┐
│  ClawFeed Server (Node.js, port 18767)  │
│  src/server.mjs                         │
└──────┬───────────────────┬──────────────┘
       │                   │
┌──────▼──────┐   ┌────────▼────────┐
│  SQLite DB  │   │  DeepSeek API   │
│  data/      │   │  (SiliconFlow)  │
└─────────────┘   └─────────────────┘

Cron (每4h/每日/每周):
  scripts/fetch-and-digest.mjs
  → 抓取各信息源 → DeepSeek 生成 JSON 结构
  → 存入 DB → 推送飞书
```

## 开发

```bash
npm run dev   # 启动，文件变更自动重载
```

### 测试

```bash
cd test
./setup.sh    # 创建测试用户
./e2e.sh      # 运行 E2E 测试
./teardown.sh # 清理
```

## Roadmap

见 [ROADMAP.md](ROADMAP.md) 或应用内 Roadmap 页面。

## License

MIT License — see [LICENSE](LICENSE) for details.

Copyright 2026 Kevin He
