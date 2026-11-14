/**
 * GitHub Contents API 最小客户端。
 *
 * 写作后台在浏览器里直接调用 GitHub REST API 提交 Markdown：
 * token 只保存在 sessionStorage（见 `./auth`），不经过任何第三方服务。
 * 这里只实现后台需要的六个动作：读用户、读文件、写文件、删文件、列目录、传二进制。
 */

export interface GitHubFile {
  /** 仓库内相对路径，例如 src/content/writing/xxx.md */
  path: string;
  /** blob sha，更新文件时需要带上 */
  sha: string;
  /** 字节数 */
  size: number;
}

export interface PutOptions {
  /** 提交信息 */
  message: string;
  /** 更新已有文件时必须提供的 blob sha */
  sha?: string;
  /** 覆盖默认分支 */
  branch?: string;
}

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
/** 单次 String.fromCharCode 的字节上限，避免大文件触发调用栈溢出。 */
const BASE64_CHUNK = 0x8000;

/** GitHub API 请求失败；status 为 HTTP 状态码，0 表示网络层失败。 */
export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

/** token 失效或未授权（HTTP 401）：需要重新登录。 */
export class GitHubAuthError extends GitHubApiError {
  constructor(message = '登录状态已失效，请重新登录 GitHub。') {
    super(401, message);
    this.name = 'GitHubAuthError';
  }
}

/** 把 UTF-8 字节编码成 base64（分块处理，避免中文被 btoa 破坏）。 */
function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    const chunk = bytes.subarray(index, index + BASE64_CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** 把 base64 解回 UTF-8 文本（GitHub 返回的内容每 60 个字符带一个换行）。 */
function decodeBase64Text(base64: string): string {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

/** 读取响应体 JSON，空响应或非 JSON 时返回 undefined。 */
async function readJson(response: Response): Promise<unknown> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 从任意值里取字符串字段。 */
function pickString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : '';
}

/** 从任意值里取数字字段。 */
function pickNumber(value: unknown, key: string): number {
  if (!value || typeof value !== 'object') return 0;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : 0;
}

/** 从任意值里取对象字段。 */
function pickObject(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === 'object' ? (field as Record<string, unknown>) : undefined;
}

/** 错误描述文本，用于网络异常提示。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 判断是否属于 sha 冲突（需要重新取最新 sha 后重试）。 */
function isShaConflict(error: unknown): boolean {
  if (!(error instanceof GitHubApiError)) return false;
  if (error.status === 409 || error.status === 422) return true;
  return /sha/i.test(error.message);
}

/** GitHub Contents API 客户端；一个实例对应一个仓库分支。 */
export class GitHubApi {
  private readonly _token: string;
  private readonly _owner: string;
  private readonly _repo: string;
  private readonly _branch: string;

  constructor(options: { token: string; owner: string; repo: string; branch?: string }) {
    this._token = options.token.trim();
    this._owner = options.owner;
    this._repo = options.repo;
    this._branch = options.branch?.trim() || 'main';
  }

  /** 当前使用的 token（不会写日志）。 */
  get token(): string {
    return this._token;
  }

  /** 是否已有 token；为空时应先登录。 */
  hasToken(): boolean {
    return this._token.length > 0;
  }

  /** 读取 token 对应的 GitHub 用户，用于校验登录状态。 */
  async getUser(): Promise<{ login: string; name?: string; avatar_url?: string }> {
    const response = await this.send(`${API_ROOT}/user`, { method: 'GET' });
    const payload = await readJson(response);
    const login = pickString(payload, 'login');
    if (!login) throw new GitHubApiError(response.status, 'GitHub 没有返回用户信息，请重新登录。');
    const name = pickString(payload, 'name');
    const avatar = pickString(payload, 'avatar_url');
    return {
      login,
      ...(name ? { name } : {}),
      ...(avatar ? { avatar_url: avatar } : {}),
    };
  }

  /** 读取单个文件；文件不存在（404）时返回 null。 */
  async getFile(path: string): Promise<{ sha: string; content: string } | null> {
    let response: Response;
    try {
      response = await this.send(this.contentsUrl(path, this._branch), { method: 'GET' });
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return null;
      throw error;
    }
    const payload = await readJson(response);
    const sha = pickString(payload, 'sha');
    if (!sha) throw new GitHubApiError(response.status, `无法解析 GitHub 返回的文件信息：${path}`);
    const raw = pickString(payload, 'content');
    return { sha, content: raw ? decodeBase64Text(raw) : '' };
  }

  /** 新建或更新文本文件；遇到 sha 冲突时自动取最新 sha 重试一次。 */
  async putFile(path: string, content: string, options: PutOptions): Promise<{ sha: string }> {
    const branch = options.branch?.trim() || this._branch;
    const body: Record<string, unknown> = {
      message: options.message,
      content: encodeBase64Bytes(new TextEncoder().encode(content)),
      branch,
    };
    if (options.sha) body.sha = options.sha;
    return this.commitWithRetry(path, body);
  }

  /** 新建或更新二进制文件（图片等）。 */
  async putBinary(path: string, data: ArrayBuffer, message: string): Promise<{ sha: string }> {
    const body: Record<string, unknown> = {
      message,
      content: encodeBase64Bytes(new Uint8Array(data)),
      branch: this._branch,
    };
    return this.commitWithRetry(path, body);
  }

  /** 删除文件；sha 必须是当前最新值。 */
  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    const response = await this.send(this.contentsUrl(path), {
      method: 'DELETE',
      body: { message, sha, branch: this._branch },
    });
    // 只需要确认状态码，响应体内容无关紧要；提前读取以免连接挂起。
    await readJson(response);
  }

  /** 列出目录下的文件；目录不存在时返回空数组。 */
  async listFiles(dir: string): Promise<GitHubFile[]> {
    let response: Response;
    try {
      response = await this.send(this.contentsUrl(dir, this._branch), { method: 'GET' });
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return [];
      throw error;
    }
    const payload = await readJson(response);
    if (!Array.isArray(payload)) return [];
    const files: GitHubFile[] = [];
    for (const item of payload) {
      if (pickString(item, 'type') !== 'file') continue;
      const path = pickString(item, 'path');
      const sha = pickString(item, 'sha');
      if (!path || !sha) continue;
      files.push({ path, sha, size: pickNumber(item, 'size') });
    }
    return files;
  }

  /** 拼接 contents 端点地址，逐段编码路径，避免中文/空格破坏 URL。 */
  private contentsUrl(path: string, ref?: string): string {
    const clean = path.replace(/^\/+/, '');
    const encoded = clean
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const base = `${API_ROOT}/repos/${this._owner}/${this._repo}/contents/${encoded}`;
    return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
  }

  /** 执行一次提交；sha 冲突时重新读取最新 sha 再试一次。 */
  private async commitWithRetry(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ sha: string }> {
    try {
      return await this.commit(path, body);
    } catch (error) {
      if (!isShaConflict(error)) throw error;
      const latest = await this.getFile(path);
      const retryBody: Record<string, unknown> = { ...body };
      if (latest) retryBody.sha = latest.sha;
      else delete retryBody.sha;
      return this.commit(path, retryBody);
    }
  }

  /** PUT contents，返回提交后的文件 sha。 */
  private async commit(path: string, body: Record<string, unknown>): Promise<{ sha: string }> {
    const response = await this.send(this.contentsUrl(path), { method: 'PUT', body });
    const payload = await readJson(response);
    const content = pickObject(payload, 'content');
    const sha = content ? pickString(content, 'sha') : '';
    if (!sha) throw new GitHubApiError(response.status, `GitHub 没有返回提交结果：${path}`);
    return { sha };
  }

  /** 统一发包：注入鉴权头，并把 HTTP 错误翻译成中文提示。 */
  private async send(
    target: string,
    init: { method: string; body?: Record<string, unknown> },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (this._token) headers.Authorization = `Bearer ${this._token}`;

    let response: Response;
    try {
      response = await fetch(target, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
      });
    } catch (error) {
      throw new GitHubApiError(0, `网络请求失败：${describeError(error)}`);
    }

    if (response.ok) return response;

    const payload = await readJson(response);
    const detail = pickString(payload, 'message');
    const status = response.status;

    if (status === 401) throw new GitHubAuthError(detail || undefined);

    if (status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const resetSeconds = Number(response.headers.get('x-ratelimit-reset') ?? 0);
        const reset = resetSeconds > 0 ? new Date(resetSeconds * 1000) : null;
        const when = reset ? `，请于 ${reset.toLocaleString('zh-CN')} 后重试` : '';
        throw new GitHubApiError(403, `GitHub API 调用次数已用尽${when}。`);
      }
      throw new GitHubApiError(403, detail || '没有权限执行该操作：请确认 token 具备 repo 权限。');
    }

    if (status === 404) throw new GitHubApiError(404, detail || '仓库或文件不存在，请检查仓库设置。');
    if (status === 409 || status === 422) {
      throw new GitHubApiError(status, detail || '提交发生冲突（文件 sha 已变化），请重试。');
    }

    throw new GitHubApiError(status, detail || `GitHub 请求失败（HTTP ${status}）。`);
  }
}