/**
 * ship OAuth 代理 —— 一个零依赖的 Cloudflare Worker。
 *
 * 它同时服务两个前端：
 * 1. Sveltia CMS（`/admin/`）：`backend.base_url` + `auth_endpoint: auth`；
 * 2. 自建写作台（`/studio/`）：`src/lib/auth.ts` 打开弹窗，等待
 *    `authorization:github:success:{...}` 的 postMessage。
 *
 * GitHub 的 client secret 只存在于 Worker 的加密变量里，静态站点永远拿不到它。
 * 全流程只有三件事：签发带签名的 state、用 code 换 token、把 token 交回 opener。
 */

/** Worker 运行时变量（`wrangler.toml` 的 [vars] + `wrangler secret put` 的加密变量）。 */
interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_ORIGINS?: string;
  /** 允许登录的 GitHub 用户名（逗号分隔）；留空表示不限制（不推荐）。 */
  GITHUB_ALLOWED_LOGINS?: string;
}

/**
 * state 里携带的数据：o=站点 origin，s=site_id，n=一次性随机数，t=签发时间戳（毫秒），
 * r=授权后要回到的站内路径（整页跳转模式），m=回传方式（popup 用 postMessage，redirect 用 URL 片段）。
 */
interface StatePayload {
  o: string;
  s: string;
  n: string;
  t: number;
  r?: string;
  m?: string;
}

/** token 交换结果：成功带 token，失败只带一句安全的中文原因。 */
type TokenResult = { ok: true; token: string } | { ok: false; reason: string };

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
/** state 有效期：10 分钟。 */
const STATE_TTL_MS = 10 * 60 * 1000;
/** 允许的时钟偏差（state 时间戳最多领先当前时间 1 分钟）。 */
const CLOCK_SKEW_MS = 60 * 1000;
const SERVICE_NAME = 'ship-oauth';
const DEFAULT_SCOPE = 'repo';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const HTML_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const TEXT_HEADERS: Record<string, string> = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
};

/** Uint8Array → base64url（无填充）。 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → UTF-8 文本；解码失败返回 null。 */
function base64UrlToText(value: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** 用 client secret 对数据做 HMAC-SHA256（Web Crypto），返回 base64url 签名。 */
async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

/** 定长逐字符异或比较，避免签名校验被时间侧信道利用。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** 生成一次性随机数（base64url）。 */
function randomToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** 规范化 origin：去掉尾斜杠、只接受 http(s)，无法解析返回 null。 */
function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** 解析 ALLOWED_ORIGINS（英文逗号分隔）为规范化 origin 列表。 */
function parseAllowedOrigins(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => item !== null);
  return [...new Set(list)];
}

/** 判断 origin 是否在白名单内。 */
function isAllowedOrigin(origin: string, allowed: string[]): boolean {
  const normalized = normalizeOrigin(origin);
  return normalized !== null && allowed.includes(normalized);
}

/** 构造 state：base64url(payload) + '.' + HMAC-SHA256 签名。 */
async function createState(
  secret: string,
  origin: string,
  siteId: string,
  returnPath?: string,
  mode: 'popup' | 'redirect' = 'popup',
): Promise<string> {
  const payload: StatePayload = {
    o: origin,
    s: siteId,
    n: randomToken(12),
    t: Date.now(),
    ...(returnPath ? { r: returnPath } : {}),
    m: mode,
  };
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(secret, body);
  return `${body}.${signature}`;
}

/** 运行时校验 payload 形状，避免把随机 JSON 当成合法 state 使用。 */
function isStatePayload(value: unknown): value is StatePayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.o === 'string' &&
    typeof record.s === 'string' &&
    typeof record.n === 'string' &&
    typeof record.t === 'number' &&
    Number.isFinite(record.t)
  );
}

/**
 * 校验 state：签名一致、未过期（10 分钟，允许 1 分钟时钟偏差）、origin 在白名单内。
 * 任何一项不满足都返回 null，调用方只回一句 `invalid state`，绝不回显 code / token。
 */
async function verifyState(
  secret: string,
  raw: string,
  allowed: string[],
): Promise<StatePayload | null> {
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!body || !signature) return null;

  const expected = await sign(secret, body);
  if (!timingSafeEqual(signature, expected)) return null;

  const json = base64UrlToText(body);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isStatePayload(parsed)) return null;

  const age = Date.now() - parsed.t;
  if (age > STATE_TTL_MS || age < -CLOCK_SKEW_MS) return null;
  if (!isAllowedOrigin(parsed.o, allowed)) return null;

  return parsed;
}

/** 只保留 GitHub 错误码里的安全字符，防止把任意内容塞进页面。 */
function sanitizeReasonParam(value: string): string {
  const cleaned = value.replace(/[^\w.:-]/g, '').slice(0, 60);
  return cleaned || '授权失败';
}

/** scope 只允许字母数字与下划线，避免把任意参数带到 GitHub。 */
function sanitizeScope(value: string | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return DEFAULT_SCOPE;
  return /^[A-Za-z0-9_,]{1,200}$/.test(trimmed) ? trimmed : DEFAULT_SCOPE;
}
/**
 * 整页跳转模式下的回跳路径：只接受站内绝对路径（`/` 开头且不是 `//`），
 * 防止把 token 重定向到第三方站点。
 */
function sanitizeReturnPath(value: string | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  const withoutHash = trimmed.split('#')[0] ?? '/';
  return withoutHash.slice(0, 300) || '/';
}


/**
 * 决定授权完成后 token 回传给哪个 origin：
 * 显式 `origin` 参数 → 请求的 Origin 头 → Referer 的 origin，都必须命中白名单；
 * 都解析不到时退回白名单第一项（单站点部署的常见情形）。
 */
function resolveRequestOrigin(request: Request, url: URL, allowed: string[]): string | null {
  const candidates: string[] = [];
  const explicit = url.searchParams.get('origin');
  if (explicit) candidates.push(explicit);
  const headerOrigin = request.headers.get('Origin');
  if (headerOrigin) candidates.push(headerOrigin);
  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      candidates.push(new URL(referer).origin);
    } catch {
      // Referer 不合法时忽略即可。
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate);
    if (normalized !== null && allowed.includes(normalized)) return normalized;
  }
  return allowed.length > 0 ? allowed[0] : null;
}

/** HTML 文本转义，用于把原因文案渲染进页面。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把字符串转成可安全嵌入 <script> 的 JS 字面量（含 `</script>` 防护）。 */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** 成功消息：`authorization:github:success:{"token":"...","provider":"github"}`。 */
function successMessage(token: string): string {
  return `authorization:github:success:${JSON.stringify({ token, provider: 'github' })}`;
}

/** 失败消息：`authorization:github:error:{"message":"..."}`，原因只放安全短文案。 */
function errorMessage(reason: string): string {
  return `authorization:github:error:${JSON.stringify({ message: reason })}`;
}

/**
 * 授权结果页：把消息交给 opener，并兼容 Decap / Sveltia 的握手
 * （它们会先发 `authorization:github:ready` 或 `authorizing:github`，收到后再重发）。
 */
function htmlDocument(targetOrigin: string, message: string, heading: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ship · GitHub 授权</title>
</head>
<body>
<p>${escapeHtml(heading)}</p>
<script>
(function () {
  var origin = ${scriptLiteral(targetOrigin)};
  var message = ${scriptLiteral(message)};
  function deliver() {
    if (!window.opener) return;
    try {
      window.opener.postMessage(message, origin);
    } catch (error) {
      // 跨域被拒时保持安静，用户仍可手动关闭窗口。
    }
  }
  deliver();
  window.addEventListener('message', function (e) {
    if (e.origin !== origin) return;
    var d = typeof e.data === 'string' ? e.data : '';
    if (d === 'authorization:github:ready' || d === 'authorizing:github') deliver();
    if (d === 'authorization:github:close') window.close();
  }, false);
  setTimeout(function () { window.close(); }, 6000);
})();
</script>
</body>
</html>`;
}

/** 纯文本响应（错误路径专用，不回显任何凭据）。 */
function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: TEXT_HEADERS });
}

/** 健康检查：`GET /health` → `{ ok: true, service: 'ship-oauth' }`，允许任意来源读取。 */
function handleHealth(): Response {
  return new Response(JSON.stringify({ ok: true, service: SERVICE_NAME }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/** `GET /auth`：签一个 state 并 302 到 GitHub 授权页。 */
async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const provider = (url.searchParams.get('provider') ?? 'github').trim().toLowerCase();
  if (provider !== 'github') return textResponse('unsupported provider', 400);

  const clientId = (env.GITHUB_CLIENT_ID ?? '').trim();
  const secret = (env.GITHUB_CLIENT_SECRET ?? '').trim();
  if (!clientId || !secret) {
    return textResponse('OAuth 代理未配置：缺少 GITHUB_CLIENT_ID 或 GITHUB_CLIENT_SECRET', 500);
  }

  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const origin = resolveRequestOrigin(request, url, allowed);
  if (origin === null) return textResponse('no allowed origin configured', 400);

  const siteId = (url.searchParams.get('site_id') ?? '').trim() || 'ship';
  // mode=redirect 时（弹窗被拦截的移动端浏览器），授权完成后 302 回站内并把 token 放在 URL 片段里。
  const mode = url.searchParams.get('mode') === 'redirect' ? 'redirect' : 'popup';
  const returnPath = sanitizeReturnPath(url.searchParams.get('return_to'));
  const state = await createState(secret, origin, siteId, mode === 'redirect' ? returnPath : undefined, mode);
  const redirectUri = `${new URL(request.url).origin}/callback`;

  const authorize = new URL(GITHUB_AUTHORIZE_URL);
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', sanitizeScope(url.searchParams.get('scope')));
  authorize.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: { Location: authorize.toString(), 'Cache-Control': 'no-store' },
  });
}

/** 用 code 换 access_token（client secret 只在服务端使用）。 */
async function exchangeToken(clientId: string, secret: string, code: string): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': SERVICE_NAME,
      },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
    });
  } catch {
    return { ok: false, reason: '无法连接 GitHub' };
  }

  if (!response.ok) {
    return { ok: false, reason: `GitHub 返回 ${response.status}` };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: 'GitHub 响应无法解析' };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'GitHub 响应格式错误' };
  }

  const record = data as Record<string, unknown>;
  const token = typeof record.access_token === 'string' ? record.access_token.trim() : '';
  if (token) return { ok: true, token };

  const rawError = typeof record.error === 'string' ? record.error : '';
  return { ok: false, reason: rawError ? sanitizeReasonParam(rawError) : 'token 交换失败' };
}

/** 解析允许登录的用户名列表（小写）。 */
function parseAllowedLogins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 校验换到的 token 属于允许的账号。
 *
 * 为什么必须在服务端校验：OAuth 授权拿到的 token 属于**授权者自己**，
 * 任何 GitHub 用户都能完成授权；真正决定能不能写仓库的是仓库权限。
 * 但与其让陌生人拿到一个"能读到他自己仓库"的 token，不如直接在此拒绝，
 * 这样即便站点被分享出去，也不会出现别人的内容落到你仓库里的可能。
 */
async function ensureLoginAllowed(
  token: string,
  rawAllowlist: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const allowlist = parseAllowedLogins(rawAllowlist);
  if (allowlist.length === 0) return { ok: true };

  let login = '';
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': SERVICE_NAME,
      },
    });
    if (!response.ok) return { ok: false, reason: '无法确认 GitHub 账号' };
    const data = (await response.json()) as { login?: unknown };
    login = typeof data.login === 'string' ? data.login.toLowerCase() : '';
  } catch {
    return { ok: false, reason: '无法确认 GitHub 账号' };
  }

  if (!login) return { ok: false, reason: '无法确认 GitHub 账号' };
  if (!allowlist.includes(login)) return { ok: false, reason: '这个 GitHub 账号没有写作权限' };
  return { ok: true };
}

/** `GET /callback`：校验 state → 换 token → 把结果交给 opener。 */
async function handleCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const clientId = (env.GITHUB_CLIENT_ID ?? '').trim();
  const secret = (env.GITHUB_CLIENT_SECRET ?? '').trim();
  if (!clientId || !secret) {
    return textResponse('OAuth 代理未配置：缺少 GITHUB_CLIENT_ID 或 GITHUB_CLIENT_SECRET', 500);
  }

  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const rawState = url.searchParams.get('state') ?? '';
  const payload = rawState ? await verifyState(secret, rawState, allowed) : null;
  if (payload === null) {
    // 校验失败统一一句话，不透露签名细节，也不回显 code。
    return textResponse('invalid state', 400);
  }

  const targetOrigin = payload.o;
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const message = errorMessage(sanitizeReasonParam(oauthError));
    return new Response(htmlDocument(targetOrigin, message, '授权未完成，可以关闭此窗口。'), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }

  const code = (url.searchParams.get('code') ?? '').trim();
  if (!code) {
    const message = errorMessage('缺少授权码');
    return new Response(htmlDocument(targetOrigin, message, '授权未完成，可以关闭此窗口。'), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }

  const result = await exchangeToken(clientId, secret, code);
  if (!result.ok) {
    const message = errorMessage(result.reason);
    return new Response(htmlDocument(targetOrigin, message, '授权未完成，可以关闭此窗口。'), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }

  const loginCheck = await ensureLoginAllowed(result.token, env.GITHUB_ALLOWED_LOGINS);
  if (!loginCheck.ok) {
    if (payload.m === 'redirect') {
      const location = `${payload.o}${payload.r ?? '/'}#gh_error=${encodeURIComponent(loginCheck.reason)}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: location,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    const denied = errorMessage(loginCheck.reason);
    return new Response(htmlDocument(targetOrigin, denied, '授权未通过，可以关闭此窗口。'), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }
  const message = successMessage(result.token);
  if (payload.m === 'redirect') {
    const location = `${payload.o}${payload.r ?? '/'}#gh_token=${encodeURIComponent(result.token)}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  return new Response(htmlDocument(targetOrigin, message, '授权完成，可以关闭此窗口。'), {
    status: 200,
    headers: HTML_HEADERS,
  });
}

/** 把路径规范化成 `/health` 这样的形式（忽略尾斜杠与多余的斜杠）。 */
function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export default {
  /** Worker 入口：所有请求都从这里分发。 */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'GET') {
      return textResponse('method not allowed', 405);
    }

    if (path === '/health') return handleHealth();
    if (path === '/auth') return handleAuth(request, env, url);
    if (path === '/callback') return handleCallback(request, env, url);

    return textResponse('not found', 404);
  },
};