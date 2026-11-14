/**
 * 写作后台的业务动作层：把 GitHub Contents API、frontmatter 序列化、日期工具粘在一起。
 *
 * 页面只调用这里的函数，不直接拼 Markdown 或直连 API；
 * 每个函数都从当前标签页的登录态里取 token（见 `./auth`），没登录就抛出中文提示。
 */
import { getSession } from './auth';
import { dayKey, isoStamp, isoUtc, toParts } from './date';
import {
  parseDoc,
  publicPathFromContentPath,
  serializeDoc,
  thoughtIdFromPath,
  thoughtPath,
  uploadPath,
  writingPath,
} from './frontmatter';
import { GitHubApi } from './github';
import { CONTENT_PATHS, REPO, url } from './site';
import { makeSlug, normalizeTags, randomId } from './text';

/** 想法条目（一条 Markdown 文件）。 */
export interface ThoughtRecord {
  /** 仓库内路径 */
  path: string;
  /** 当前 blob sha */
  sha: string;
  /** 文件名主干，即想法 id */
  id: string;
  /** ISO UTC，取自 frontmatter.createdAt */
  createdAt: string;
  /** ISO UTC，取自 frontmatter.updatedAt */
  updatedAt?: string;
  tags: string[];
  body: string;
}

/** 文章条目（一篇 Markdown 文件）。 */
export interface ArticleRecord {
  path: string;
  sha: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  published: boolean;
  /** ISO UTC */
  pubDate: string;
  /** ISO UTC */
  updatedDate?: string;
  cover?: string;
  body: string;
}

/** 保存文章时需要提交的表单数据。 */
export interface ArticleInput {
  title: string;
  description: string;
  category: string;
  tags: string[];
  body: string;
  published: boolean;
  /** ISO UTC 或可被 Date 解析的日期字符串 */
  pubDate: string;
  cover?: string;
  /** 已存在文章的 blob sha；不传表示新建 */
  sha?: string;
  /** 已存在文章的路径；不传则按 slug 生成 */
  path?: string;
}

/** 上传图片允许的 MIME 类型 → 扩展名。 */
const IMAGE_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/svg+xml', 'svg'],
]);

/** 图片体积上限：5MB。 */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 并发读取文件的上限，避免一次性打满 GitHub 的二级速率限制。 */
const FETCH_CONCURRENCY = 4;

/** 上传后确认部署的轮询次数与间隔。 */
const VERIFY_ATTEMPTS = 3;
const VERIFY_DELAY = 1200;

let cachedClient: { token: string; api: GitHubApi } | null = null;

/** 取当前登录态对应的 GitHub 客户端；未登录时抛出中文提示。 */
function client(): GitHubApi {
  const session = getSession();
  if (!session || !session.token) throw new Error('尚未登录 GitHub：请先完成登录');
  if (!cachedClient || cachedClient.token !== session.token) {
    cachedClient = {
      token: session.token,
      api: new GitHubApi({
        token: session.token,
        owner: REPO.owner,
        repo: REPO.name,
        branch: REPO.branch,
      }),
    };
  }
  return cachedClient.api;
}

/** 从任意值里取字符串。 */
function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** 把 frontmatter 里的日期字段统一成 ISO UTC；无法解析时返回空串。 */
function asIso(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  const text = asString(value);
  if (!text) return '';
  const time = Date.parse(text);
  return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

/** 把 frontmatter 里的标签字段整理成数组。 */
function asTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTags(value.filter((item): item is string => typeof item === 'string'));
  }
  const text = asString(value);
  return text ? normalizeTags(text) : [];
}

/** 时间排序值，解析失败按 0 处理（排到最后）。 */
function timeValue(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
}

/** 分批并发执行，返回与输入顺序一致的结果。 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    const settled = await Promise.all(chunk.map((item) => run(item)));
    results.push(...settled);
  }
  return results;
}

/** 延时，用于上传后确认图片可访问。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 从文章路径取 slug（去掉目录与 .md）。 */
function slugFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

/** 生成 ASCII 安全的图片文件名主干（中文名会被折叠成 image）。 */
function asciiFileName(name: string): string {
  const withoutExt = name.replace(/\.[^.]*$/, '');
  const safe = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return safe.slice(0, 40) || 'image';
}

/** 北京时区的时间戳前缀，例如 20261114-203900。 */
function fileStamp(date: Date): string {
  const { hour, minute, second } = toParts(date);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${dayKey(date).replace(/-/g, '')}-${pad(hour)}${pad(minute)}${pad(second)}`;
}

/** 读取全部想法，按时间倒序（最近的在最前）。 */
export async function loadThoughts(): Promise<ThoughtRecord[]> {
  const github = client();
  const files = await github.listFiles(CONTENT_PATHS.thoughts);
  const records = await mapLimit(files, FETCH_CONCURRENCY, async (file) => {
    const content = await github.getFile(file.path);
    if (!content) return null;
    const doc = parseDoc(content.content);
    const id = thoughtIdFromPath(file.path);
    const createdAt = asIso(doc.data.createdAt) || '';
    const updatedAt = asIso(doc.data.updatedAt);
    const record: ThoughtRecord = {
      path: file.path,
      sha: content.sha,
      id,
      createdAt,
      ...(updatedAt ? { updatedAt } : {}),
      tags: asTags(doc.data.tags),
      body: doc.body,
    };
    return record;
  });
  return records
    .filter((record): record is ThoughtRecord => record !== null)
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
}

/** 读取全部文章：已发布的排在最前，其余按 pubDate 倒序。 */
export async function loadArticles(): Promise<ArticleRecord[]> {
  const github = client();
  const files = await github.listFiles(CONTENT_PATHS.writing);
  const records = await mapLimit(files, FETCH_CONCURRENCY, async (file) => {
    const content = await github.getFile(file.path);
    if (!content) return null;
    const doc = parseDoc(content.content);
    const updatedDate = asIso(doc.data.updatedDate);
    const cover = asString(doc.data.cover);
    const record: ArticleRecord = {
      path: file.path,
      sha: content.sha,
      slug: slugFromPath(file.path),
      title: asString(doc.data.title),
      description: asString(doc.data.description),
      category: asString(doc.data.category) || '随笔',
      tags: asTags(doc.data.tags),
      published: doc.data.published === true,
      pubDate: asIso(doc.data.pubDate) || '',
      ...(updatedDate ? { updatedDate } : {}),
      ...(cover ? { cover } : {}),
      body: doc.body,
    };
    return record;
  });
  return records
    .filter((record): record is ArticleRecord => record !== null)
    .sort((a, b) => {
      if (a.published !== b.published) return a.published ? -1 : 1;
      return timeValue(b.pubDate) - timeValue(a.pubDate);
    });
}

/** 新建一条想法；文件名为「北京时区时间 + 随机后缀」。 */
export async function createThought(input: {
  body: string;
  tags: string[];
  createdAt?: Date;
}): Promise<ThoughtRecord> {
  const github = client();
  const createdAt = input.createdAt ?? new Date();
  const path = thoughtPath(createdAt, randomId(4));
  const tags = normalizeTags(input.tags);
  const body = input.body.trim();
  if (!body) throw new Error('想法内容不能为空');

  const content = serializeDoc({ createdAt: isoUtc(createdAt), tags }, body);
  const result = await github.putFile(path, content, { message: `想法：${isoStamp(createdAt)}` });

  return {
    path,
    sha: result.sha,
    id: thoughtIdFromPath(path),
    createdAt: isoUtc(createdAt),
    tags,
    body,
  };
}

/** 更新已存在的想法（保留原 createdAt，追加 updatedAt）。 */
export async function updateThought(
  record: ThoughtRecord,
  input: { body: string; tags: string[] },
): Promise<ThoughtRecord> {
  const github = client();
  const body = input.body.trim();
  if (!body) throw new Error('想法内容不能为空');

  const tags = normalizeTags(input.tags);
  const now = new Date();
  const createdAt = record.createdAt || isoUtc(now);
  const content = serializeDoc({ createdAt, updatedAt: isoUtc(now), tags }, body);
  const result = await github.putFile(record.path, content, {
    message: `想法：${isoStamp(now)}（更新）`,
    sha: record.sha,
  });

  return {
    ...record,
    sha: result.sha,
    createdAt,
    updatedAt: isoUtc(now),
    tags,
    body,
  };
}

/** 删除一条想法。 */
export async function deleteThought(record: ThoughtRecord): Promise<void> {
  const github = client();
  await github.deleteFile(record.path, record.sha, `删除想法：${record.id}`);
}

/** 新建或更新文章；没有 sha 视为新建。 */
export async function saveArticle(input: ArticleInput): Promise<ArticleRecord> {
  const github = client();
  const title = input.title.trim();
  if (!title) throw new Error('请先填写标题');

  const now = new Date();
  const parsedDate = Date.parse(input.pubDate);
  const pubDate = Number.isNaN(parsedDate) ? now : new Date(parsedDate);
  const slug = input.path ? slugFromPath(input.path) : slugFor(title, pubDate);
  const path = input.path?.trim() || writingPath(slug);
  const tags = normalizeTags(input.tags);
  const category = input.category.trim() || '随笔';
  const description = input.description.trim();
  const cover = input.cover?.trim() ?? '';

  // 更新时先读一次旧文件：既拿到最新 sha（避免冲突），也保留 featured 原值。
  let sha = input.sha?.trim() ?? '';
  let featured = false;
  if (sha) {
    const existing = await github.getFile(path);
    if (existing) {
      sha = existing.sha;
      const parsed = parseDoc(existing.content);
      featured = parsed.data.featured === true;
    }
  }

  const front: Record<string, unknown> = {
    title,
    description,
    category,
    tags,
    published: input.published,
    pubDate: isoUtc(pubDate),
  };
  if (sha) front.updatedDate = isoUtc(now);
  if (cover) front.cover = cover;
  front.featured = featured;

  const message = `文章：${title}${input.published ? '' : '（草稿）'}`;
  const result = await github.putFile(path, serializeDoc(front, input.body), {
    message,
    ...(sha ? { sha } : {}),
  });

  return {
    path,
    sha: result.sha,
    slug,
    title,
    description,
    category,
    tags,
    published: input.published,
    pubDate: isoUtc(pubDate),
    ...(sha ? { updatedDate: isoUtc(now) } : {}),
    ...(cover ? { cover } : {}),
    body: input.body,
  };
}

/** 删除文章文件（重命名链接、清理草稿时用）。 */
export async function deleteArticle(record: {
  path: string;
  sha: string;
  title?: string;
}): Promise<void> {
  const github = client();
  const name = record.title?.trim() || slugFromPath(record.path);
  await github.deleteFile(record.path, record.sha, `删除文章：${name}`);
}

/**
 * 上传图片到 public/uploads 并返回站内绝对路径（含 base，例如 /ship/uploads/...）。
 * 限制类型与体积；提交后会短暂轮询确认文件可读，确认失败也不阻断（Pages 部署有延迟）。
 */
export async function uploadImage(file: File): Promise<string> {
  const type = file.type.toLowerCase();
  const extension = IMAGE_TYPES.get(type);
  if (!extension) throw new Error('只能上传 PNG / JPEG / WebP / GIF / SVG 图片');
  if (file.size > IMAGE_MAX_BYTES) throw new Error('图片不能超过 5MB');

  const github = client();
  const now = new Date();
  const fileName = `${asciiFileName(file.name)}-${fileStamp(now)}.${extension}`;
  const path = uploadPath(fileName, now);

  const data = await file.arrayBuffer();
  await github.putBinary(path, data, `图片：${fileName}`);

  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    await sleep(VERIFY_DELAY);
    try {
      const found = await github.getFile(path);
      if (found) break;
    } catch {
      // 部署延迟或限流都不影响最终路径，继续按成功返回
    }
  }

  const publicPath = publicPathFromContentPath(path).replace(/^\/+/, '');
  return url(publicPath);
}

/** 由标题与日期生成文章 slug（文件名与永久链接共用）。 */
export function slugFor(title: string, date: Date): string {
  return makeSlug(title, date);
}