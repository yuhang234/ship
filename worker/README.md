# ship-oauth

`ship` 的 GitHub OAuth 代理，跑在 Cloudflare Workers（免费额度足够个人站点使用）。

它只做三件事：

1. `GET /auth` —— 签发带 HMAC 签名的 state，302 跳转到 GitHub 授权页；
2. `GET /callback` —— 校验 state，用 `code` + `client_secret` 换 `access_token`；
3. 把 token 通过 `postMessage` 交给打开弹窗的页面（`/admin/` 的 Sveltia CMS，或 `/studio/` 的写作台）。

`client_secret` 只存在于 Worker 的加密变量里，静态站点与浏览器永远看不到它。

| 路由 | 说明 |
| --- | --- |
| `GET /health` | `{ "ok": true, "service": "ship-oauth" }`，可用于探活 |
| `GET /auth?provider=github&site_id=...&scope=repo` | 302 到 GitHub 授权页 |
| `GET /callback?code=...&state=...` | 校验 state、换 token、把结果交给 opener |
| 其他 | `404` |

失败时 `state` 校验一律返回 `400 invalid state`（不会回显 `code` 或 token）；授权被拒等业务失败会
`postMessage` 一条 `authorization:github:error:{"message":"..."}`。

---

## 1. 创建 GitHub OAuth App

打开 <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**，填：

| 字段 | 值 |
| --- | --- |
| Application name | `ship`（随便取） |
| Homepage URL | `https://<owner>.github.io/ship/` |
| Authorization callback URL | `https://ship-oauth.<你的子域>.workers.dev/callback` |

注意：

- callback URL 必须**完全一致**（含协议、域名、`/callback`，不带尾斜杠）。自定义域名请同步修改。
- 创建后记下 **Client ID**；再点 **Generate a new client secret** 生成 **Client secret**（只显示一次）。

## 2. 安装 wrangler（本地）

```bash
cd worker
npm install          # 只装 wrangler，不进主项目依赖
npx wrangler login   # 浏览器里授权 Cloudflare 账号
```

## 3. 填 `wrangler.toml`

```toml
[vars]
GITHUB_CLIENT_ID = "Iv1.xxxxxxxxxxxx"          # 第 1 步的 Client ID
ALLOWED_ORIGINS = "https://<owner>.github.io"  # 站点 origin，多个用英文逗号分隔
```

`ALLOWED_ORIGINS` 是**站点 origin**（协议 + 域名 + 端口），不是完整的 `/ship/` 路径，也**不要**带尾斜杠。
本地调试可以把它写成 `http://localhost:4321`。

**`GITHUB_CLIENT_SECRET` 绝对不要写进 `wrangler.toml`，也不要提交到仓库。**（`.gitignore` 已忽略
`worker/node_modules/`、`worker/.wrangler/`。）

## 4. 写入加密变量

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
# 粘贴第 1 步生成的 Client secret，回车
```

以后改 secret 再执行一次同样的命令即可。

## 5. 部署

```bash
npx wrangler deploy
```

输出会给出 Worker 地址，形如：

```
https://ship-oauth.<你的子域>.workers.dev
```

自检：

```bash
curl https://ship-oauth.<你的子域>.workers.dev/health
# {"ok":true,"service":"ship-oauth"}
```

本地预览（可选）：`npx wrangler dev`，再用 `curl http://127.0.0.1:8787/health` 探活。

## 6. 让站点用上它

1. GitHub 仓库 → **Settings → Secrets and variables → Actions → Variables → New repository variable**
   - Name：`PUBLIC_OAUTH_BASE`
   - Value：`https://ship-oauth.<你的子域>.workers.dev`（不带尾斜杠）
2. 重新触发一次部署（push 到 `main`，或 **Actions → Deploy to GitHub Pages → Run workflow**）。
3. 构建时 `src/lib/site.ts` 会读取 `PUBLIC_OAUTH_BASE`：
   - `/admin/config.yml` 的 `backend.base_url` 变成上面的地址；
   - `/admin/` 的状态条显示"登录代理：<地址>"；
   - `/studio/` 的弹窗登录也走同一个 Worker。

如果状态条显示"登录服务未配置"，说明 `PUBLIC_OAUTH_BASE` 没生效（变量名拼错、没重新部署，或
构建日志里 `PUBLIC_OAUTH_BASE` 为空）。

## 7. 排错

| 现象 | 原因 |
| --- | --- |
| 弹窗一闪而过 | OAuth App 的 callback URL 与 `https://<worker>/callback` 不一致 |
| `400 invalid state` | state 过期（>10 分钟）、签名不匹配，或 `ALLOWED_ORIGINS` 没包含站点 origin |
| `redirect_uri` 报错 | OAuth App 里填的域名与 Worker 实际域名（含自定义域）不同 |
| 登录后仍显示未授权 | `ALLOWED_ORIGINS` 少了站点 origin；浏览器拦截了 postMessage 的 targetOrigin 不匹配 |
| `500 OAuth 代理未配置` | 忘了 `wrangler secret put GITHUB_CLIENT_SECRET`，或 `GITHUB_CLIENT_ID` 为空 |

安全约定：Worker 不写日志、不回显 token，`/callback` 的响应头是 `Cache-Control: no-store` +
`Referrer-Policy: no-referrer`，`state` 里的 origin 必须命中白名单才会被回传 token。