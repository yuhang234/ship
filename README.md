# ship

一个人的思想记录与写作空间。

- **想法**：随手记录，没有标题，按时间线浏览。
- **文章**：在网页里写成完整文章，保存即发布。
- **内容**：全部是仓库里的 Markdown 文件，随时可导出、可迁移、可版本回溯。

线上站点：`https://yuhang234.github.io/ship/`
写作后台：`https://yuhang234.github.io/ship/studio/`
CMS 后台：`https://yuhang234.github.io/ship/admin/`

---

## 1. 技术架构

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | Astro 7 + TypeScript | 纯静态输出，零服务端 |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite`） | 语义化色板 + 亮暗两套主题 |
| 内容 | Markdown + frontmatter | `src/content/thoughts`、`src/content/writing` |
| 内容管理 | Sveltia CMS | `/admin/`，Git 后端，直接提交 Markdown |
| 写作后台 | 自建 `/studio/` | 快速记录 + 文章编辑器 + 实时预览 |
| 托管 | GitHub Pages | 免费、HTTPS、全球 CDN |
| 部署 | GitHub Actions | push 到 main 自动构建发布 |
| 登录 | GitHub OAuth + Cloudflare Worker | 前端不存任何 client secret |
| 应用 | 响应式 Web + PWA | Windows / Android 均可安装到桌面 |

数据流：

```
浏览器 (studio / CMS)
      │  GitHub Contents API（用户自己的 OAuth token）
      ▼
GitHub 仓库 ship ──push──▶ GitHub Actions ──build──▶ GitHub Pages
      │                                              │
      └────────── 内容即 Markdown 文件 ◀──────────────┘
```

没有数据库，没有服务器，没有后台进程需要维护。

---

## 2. 目录结构

```
src/
  content.config.ts          # 两个集合的 schema（thoughts / writing）
  content/
    thoughts/*.md            # 想法，文件名即 ID：2026-11-14-174100-cdef.md
    writing/*.md             # 文章，文件名即永久链接
  lib/
    site.ts                  # 站点配置、base 拼接（url / absoluteUrl）
    date.ts                  # 固定北京时区的日期格式化
    text.ts                  # slug、阅读时长、摘要、标签
    frontmatter.ts           # Markdown frontmatter 序列化 / 解析 / 路径构造
    search.ts                # 搜索分词与打分
    github.ts                # GitHub Contents API 封装（浏览器端）
    idb.ts                   # IndexedDB 草稿与离线存储
    auth.ts                  # OAuth 弹窗登录
    editor.ts                # Markdown 编辑器交互（预览、工具栏、快捷键）
    studio-api.ts            # 业务动作：新建/编辑/删除/发布/上传图片
  layouts/BaseLayout.astro   # 头信息、主题、PWA 注册
  components/                # Header、Footer、ThoughtEntry、PostCard、Toc…
  pages/
    index.astro              # 首页
    thoughts/index.astro     # 想法时间线（年 / 月 / 日）
    writing/index.astro      # 文章列表
    writing/[id].astro       # 文章详情（TOC、上一篇/下一篇、JSON-LD）
    archives/…               # 归档
    about/index.astro        # 关于
    search/index.astro       # 站内搜索
    studio/                  # 写作后台（快速记录 / 文章编辑器）
    admin/                   # Sveltia CMS 入口 + config.yml 端点
    rss.xml.ts               # RSS
    search.json.ts           # 搜索索引
    manifest.webmanifest.ts  # PWA manifest
    sw.js.ts                 # Service Worker
worker/                      # Cloudflare Worker：GitHub OAuth 代理
tests/                       # vitest 单元测试 + 构建产物 E2E 校验
.github/workflows/           # deploy.yml（构建发布）、ci.yml（类型检查与单测）
```

---

## 3. 本地开发

```bash
npm install
npm run dev        # http://localhost:4321/ship/
```

本地不需要登录也能查看站点。要在本地调试写作后台，复制 `.env.example` 为 `.env`：

```dotenv
PUBLIC_GITHUB_REPO=<owner>/ship
PUBLIC_SITE_URL=https://<owner>.github.io
PUBLIC_GITHUB_BRANCH=main
PUBLIC_OAUTH_BASE=https://ship-oauth.<your-subdomain>.workers.dev
```

这些变量都是**公开**的，构建时会被内联到前端，不要放 secret。

可用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发服务器 |
| `npm run build` | 生成静态站点到 `dist/` |
| `npm run preview` | 预览构建产物（带 base 路径） |
| `npm run check` | Astro / TypeScript 类型检查 |
| `npm test` | 单元测试 |
| `npm run build && npm run test:e2e` | 构建产物 E2E 校验 |
| `npm run verify` | 类型检查 + 构建 + 全部测试 |

---

## 4. 部署（GitHub Pages）

### 4.1 一次性设置

1. **仓库变量**（Settings → Secrets and variables → Actions → Variables）

   | 变量 | 值 |
   | --- | --- |
   | `PUBLIC_OAUTH_BASE` | Cloudflare Worker 地址，例如 `https://ship-oauth.example.workers.dev` |

2. **Pages**：Settings → Pages → Source 选择 **GitHub Actions**（不是分支）。

3. 之后每次 `git push` 到 `main`，[deploy.yml](.github/workflows/deploy.yml) 会自动构建并发布。
   首次部署会在 Actions 里出现 "Deploy to GitHub Pages" 任务，完成后站点地址为
   `https://<owner>.github.io/ship/`。

站点部署在项目子路径下，因此 `astro.config.mjs` 里固定了 `base: '/ship'`。所有站内链接都通过
`url()` 生成，不要在组件里手写 `/xxx/` 绝对路径。

---

## 5. 登录（GitHub OAuth）——已配置完成

> **当前状态：已接入并实测通过。** 下面 5.1–5.3 保留为"重建/迁移时的参考步骤"。
>
> | 项 | 实际值 |
> | --- | --- |
> | OAuth App | `ship`（owner `yuhang234`，Client ID `Ov23liPCcOFzf3e8DAxM`） |
> | 回调地址 | `https://ship-oauth.ship-oauth-yuhang234.workers.dev/callback` |
> | Worker | `https://ship-oauth.ship-oauth-yuhang234.workers.dev`（`/health` 返回 `{"ok":true}`） |
> | 仓库变量 | `PUBLIC_OAUTH_BASE` = 上面 Worker 地址 |
>
> 登录方式有两条，页面会按能力自动选择：
> 1. 桌面浏览器：弹窗 + `postMessage` 回传 token（Netlify CMS / Sveltia 同款协议）；
> 2. 弹窗被拦截时（移动端 Chrome、内嵌 WebView）：自动整页跳转授权，完成后带
>    `#gh_token=...` 回跳，前端校验后立刻写入 `sessionStorage` 并清除 URL 片段。
>
> token 只存在于当前标签页的 `sessionStorage`，关闭标签页即失效，不进仓库、不进 localStorage。

### 5.0 设计要点（为什么要一个 Worker）
Sveltia CMS 和自建写作后台都需要一个 OAuth 代理来换取 GitHub token：静态站点不能保存 client
secret，也不能在浏览器里硬编码 token。`worker/` 就是这个代理，零依赖、跑在 Cloudflare Workers
免费额度上。
### 5.1 创建 GitHub OAuth App

GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App：

| 字段 | 值 |
| --- | --- |
| Application name | `ship` |
| Homepage URL | `https://<owner>.github.io/ship/` |
| Authorization callback URL | `https://ship-oauth.<your-subdomain>.workers.dev/callback` |

记下 **Client ID**，生成 **Client secret**（只显示一次）。

### 5.2 部署 Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET   # 粘贴上一步的 secret
# 编辑 wrangler.toml：[vars] GITHUB_CLIENT_ID / ALLOWED_ORIGINS
npx wrangler deploy
```

`wrangler deploy` 会输出 Worker 地址，例如
`https://ship-oauth.<your-subdomain>.workers.dev`。

### 5.3 回填地址

- 仓库变量 `PUBLIC_OAUTH_BASE` = 上面的 Worker 地址；
- 或在本地 `.env` 里设置同一变量；
- 重新触发一次部署（push 或 Actions → Run workflow）。

打开 `/ship/studio/` 点"登录 GitHub"，或打开 `/ship/admin/` 用 Sveltia CMS 登录，都应该能弹出 GitHub
授权页。授权后 token 只保存在当前浏览器会话（`sessionStorage` / CMS 自身存储），不会写进仓库。

> 没有配置 OAuth 时：站点前台完全正常，只是写作后台会明确提示"登录服务未配置"，不会假装成功。

---

## 6. 写作流程

### 6.1 记想法（`/studio/`）

1. 在输入框写下想法，可加标签。
2. `Ctrl / Cmd + Enter` 保存，或点"记下来"。
3. 内容以 `src/content/thoughts/2026-11-14-174100-cdef.md` 提交到仓库，Actions 自动重新部署。
4. 输入过程每 1.2 秒自动存一份草稿到浏览器 IndexedDB，断网或关页面都不会丢。

### 6.2 写文章（`/studio/write/`）

1. 填标题 → 自动生成永久链接（`/writing/<日期>-<标题片段>/`）。
2. 正文支持 Markdown、实时预览（DOMPurify 清洗）、工具栏与常用快捷键。
3. "存草稿"写 `published: false`，"发布"写 `published: true`。
4. 已发布文章的修改：在后台文章列表里打开，保存即更新，`updatedDate` 自动刷新。

### 6.3 用 CMS 编辑（`/admin/`）

Sveltia CMS 适合在手机或平板上做小幅修改：它能直接新建/编辑/删除两个集合的 Markdown 文件，图片
上传到 `public/uploads/`。字段与 `src/content.config.ts` 完全一致。

---

## 7. 内容格式

想法（`src/content/thoughts/*.md`）：

```markdown
---
createdAt: 2026-11-14T09:41:00.000Z
tags:
  - 思考
pinned: false
---

记录不是为了记住，是为了看见自己在想什么。
```

文章（`src/content/writing/*.md`）：

```markdown
---
title: 记录自由，写作才算自由
description: 为什么把速记和文章分开存放。
category: 写作
tags:
  - 写作
published: true
pubDate: 2026-11-06T13:00:00.000Z
featured: true
---

正文……
```

- 时间统一以 UTC 存储，展示时固定换算到 `Asia/Shanghai`，手机与电脑看到完全一致的日期。
- `published: false` 的内容不会出现在列表、RSS、搜索索引和 sitemap 中。
- 文件名即永久链接，发布后不要改名（改名等于换链接）。

---

## 8. 导出与迁移

- 所有内容就是仓库里的 `.md` 文件：`git clone` 即完整备份。
- 单篇导出：打开
  `https://github.com/<owner>/ship/blob/main/src/content/writing/<文件名>.md`，点 Raw / Download。
- 写作后台提供"导出全部草稿"（JSON），用于把浏览器里未提交的内容备份出来。
- 换框架、换托管都不影响内容：frontmatter 是标准 YAML，正文是标准 Markdown。

---

## 9. 测试

```bash
npm test                    # 单元：日期、文本、frontmatter、搜索
npm run build && npm run test:e2e   # 构建产物：页面存在、base 路径正确、RSS/搜索索引内容
npm run check               # 类型检查
```

`tests/e2e/build.test.ts` 会检查：

- 所有路由产物存在（首页、想法、文章、归档、关于、搜索、404、admin）；
- 站内链接全部带 `/ship/` 前缀；
- `search.json` 含全部已发布内容且不含草稿；
- `rss.xml` 条目数与已发布文章数一致。

---

## 10. 常见问题

**Actions 构建失败**：多半是某篇 Markdown 的 frontmatter 不符合 schema（缺 `title`、日期格式错误、
`tags` 写成字符串）。报错信息会指向具体文件。

**页面 404**：目录式输出（`writing/<slug>/index.html`）在 GitHub Pages 上应正常访问；确认
Settings → Pages 的 Source 为 GitHub Actions，并且 `base` 与仓库名一致。

**登录弹窗一闪而过**：OAuth App 的 callback URL 必须与 Worker 的 `/callback` 完全一致（含协议与
域名，不带尾斜杠）；`ALLOWED_ORIGINS` 要包含站点 origin（如 `https://<owner>.github.io`）。

**手机上写字很痛苦？** 后台针对移动端做了 44px 触控区、安全区内边距与全屏编辑器；也可以把站点
"添加到主屏幕"（PWA），从桌面图标直接进入写作。

---

MIT License · 内容与代码都属于你自己。