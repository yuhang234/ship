/**
 * GitHub OAuth 弹窗登录。
 *
 * 流程：后台打开 Cloudflare Worker 的 `/auth` 页 → Worker 走 GitHub OAuth →
 * 用 `window.postMessage` 把 token 递回来（Netlify CMS 同款协议）。
 * token 只写 sessionStorage：关闭标签页即失效，任何日志、localStorage 都不碰。
 */
import { GitHubApi } from './github';
import { OAUTH_BASE, REPO } from './site';

export interface Session {
  /** GitHub personal/OAuth token */
  token: string;
  /** GitHub 登录名 */
  login: string;
}

const STORAGE_KEY = 'ship.session';
const POPUP_NAME = 'ship-oauth';
const POPUP_TIMEOUT = 120_000;
const POPUP_POLL = 200;

/** 读取当前标签页的登录态；没有或格式不对时返回 null。 */
export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const token = typeof record.token === 'string' ? record.token : '';
    const login = typeof record.login === 'string' ? record.login : '';
    if (!token || !login) return null;
    return { token, login };
  } catch {
    return null;
  }
}

/** 保存登录态（仅当前标签页）。 */
export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: session.token, login: session.login }));
  } catch {
    // 隐私模式下写不进去：忽略，用户下次仍需登录
  }
}

/** 清除登录态。 */
export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}

/** 是否已配置 OAuth 代理（PUBLIC_OAUTH_BASE）。 */
export function isOAuthConfigured(): boolean {
  return OAUTH_BASE.trim().length > 0;
}

/** 从 postMessage 字符串里解析出 token；格式不符时返回空字符串。 */
function parseSuccess(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return '';
    const record = parsed as Record<string, unknown>;
    const token = record.token;
    return typeof token === 'string' ? token.trim() : '';
  } catch {
    return '';
  }
}

/** 从 postMessage 字符串里解析出错误文案。 */
function parseFailure(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return '';
    const record = parsed as Record<string, unknown>;
    const message = record.message ?? record.error;
    return typeof message === 'string' ? message : '';
  } catch {
    return '';
  }
}

/**
 * 打开 OAuth 弹窗并等待 token。
 * 未配置 OAUTH_BASE、弹窗被拦截、120 秒超时都会抛出可直接展示的中文错误。
 */
export async function signIn(): Promise<Session> {
  if (!isOAuthConfigured()) {
    throw new Error('登录服务未配置：请先部署 Cloudflare Worker 并设置 PUBLIC_OAUTH_BASE');
  }

  const origin = new URL(OAUTH_BASE).origin;
  const width = 620;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const target = `${OAUTH_BASE}/auth?provider=github&site_id=ship&scope=repo`;

  const popup = window.open(
    target,
    POPUP_NAME,
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`,
  );
  if (!popup) {
    // 移动端浏览器与内嵌 WebView 常直接拦截 window.open：退化为整页跳转登录。
    redirectToAuth();
    throw new Error('登录窗口被浏览器拦截，已改用整页跳转登录…');
  }

  const token = await new Promise<string>((resolve, reject) => {
    let settled = false;
    let pollTimer = 0;
    let timeoutTimer = 0;

    const cleanup = (): void => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutTimer);
    };

    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        // 弹窗可能已被用户关闭
      }
      run();
    };

    const handle = (data: string): boolean => {
      if (!data.startsWith('authorization:github:')) return false;

      if (data === 'authorization:github:ready') {
        popup.postMessage('authorizing:github', origin);
        return true;
      }

      if (data.startsWith('authorization:github:success:')) {
        const value = parseSuccess(data.slice('authorization:github:success:'.length));
        if (!value) {
          finish(() => reject(new Error('登录回调里没有 token，请重试')));
          return true;
        }
        finish(() => resolve(value));
        return true;
      }

      if (data.startsWith('authorization:github:error:')) {
        const reason =
          parseFailure(data.slice('authorization:github:error:'.length)) || 'GitHub 登录失败，请重试';
        finish(() => reject(new Error(reason)));
        return true;
      }

      return false;
    };

    function onMessage(event: MessageEvent): void {
      if (event.origin !== origin) return;
      if (typeof event.data === 'string') {
        handle(event.data);
      }
    }

    window.addEventListener('message', onMessage);

    pollTimer = window.setInterval(() => {
      if (popup.closed) {
        finish(() => reject(new Error('登录窗口已关闭，未完成授权')));
      }
    }, POPUP_POLL);

    timeoutTimer = window.setTimeout(() => {
      finish(() => reject(new Error('登录超时（120 秒）：请重新点击登录')));
    }, POPUP_TIMEOUT);
  });

  // token 拿到后用 getUser() 校验一次，确认它真的能读写仓库。
  const api = new GitHubApi({
    token,
    owner: REPO.owner,
    repo: REPO.name,
    branch: REPO.branch,
  });
  let login = '';
  try {
    const user = await api.getUser();
    login = user.login;
  } catch (error) {
    const reason = error instanceof Error ? error.message : '无法验证 token';
    throw new Error(`登录失败：${reason}`);
  }

  const session: Session = { token, login };
  saveSession(session);
  return session;
}

/**
 * 整页跳转登录：不依赖弹窗，授权完成后 Worker 会把 token 放进 URL 片段回跳，
 * 由 restoreSession() 消费。手机上最稳的一条路径。
 */
export function redirectToAuth(): void {
  if (!isOAuthConfigured()) {
    throw new Error('登录服务未配置：请先部署 Cloudflare Worker 并设置 PUBLIC_OAUTH_BASE');
  }
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const target = `${OAUTH_BASE}/auth?provider=github&site_id=ship&scope=repo&mode=redirect&return_to=${encodeURIComponent(
    returnTo,
  )}`;
  window.location.assign(target);
}

/**
 * 页面启动时恢复登录态：
 * 1. 若 URL 片段里有 `gh_token`（整页跳转回跳），校验后写入 sessionStorage 并清掉片段；
 * 2. 否则直接读 sessionStorage。
 */
export async function restoreSession(): Promise<Session | null> {
  const hash = window.location.hash;
  if (!hash || !hash.includes('gh_token=')) return getSession();

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = (params.get('gh_token') ?? '').trim();

  // 立刻清掉片段，避免 token 留在地址栏与历史记录里。
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

  if (!token) return getSession();

  const api = new GitHubApi({
    token,
    owner: REPO.owner,
    repo: REPO.name,
    branch: REPO.branch,
  });
  const user = await api.getUser();
  const session: Session = { token, login: user.login };
  saveSession(session);
  return session;
}