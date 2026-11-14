/**
 * Markdown 文档的 frontmatter 读写工具。
 * 写作后台在浏览器里序列化文件内容并通过 GitHub API 提交，
 * 因此这里的实现必须在浏览器与 Node 中都能运行。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { dayKey, toParts } from './date';

export const THOUGHT_DIR = 'src/content/thoughts';
export const WRITING_DIR = 'src/content/writing';
export const UPLOAD_DIR = 'public/uploads';

export interface Doc<T extends Record<string, unknown> = Record<string, unknown>> {
  data: T;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** 组装成带 frontmatter 的 Markdown 文件内容。 */
export function serializeDoc<T extends Record<string, unknown>>(data: T, body: string): string {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0 && key !== 'tags') continue;
    cleaned[key] = value;
  }
  const yaml = stringifyYaml(cleaned, { lineWidth: 0, nullStr: '' }).trimEnd();
  const content = body.replace(/\r\n/g, '\n').trim();
  return `---\n${yaml}\n---\n\n${content}\n`;
}

/** 解析 Markdown 文件内容，缺少 frontmatter 时 data 为空对象。 */
export function parseDoc<T extends Record<string, unknown> = Record<string, unknown>>(raw: string): Doc<T> {
  const text = raw.replace(/\r\n/g, '\n');
  const match = text.match(FRONTMATTER);
  if (!match) return { data: {} as T, body: text.trim() };
  const parsed = parseYaml(match[1] ?? '');
  const data = (parsed && typeof parsed === 'object' ? parsed : {}) as T;
  const body = text.slice(match[0].length).trim();
  return { data, body };
}

/** 想法文件名：2026-11-14-174100-cdef.md（时间按北京时区，便于人工翻阅）。 */
export function thoughtFileName(createdAt: Date | string | number, suffix: string): string {
  const { hour, minute, second } = toParts(createdAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${dayKey(createdAt)}-${pad(hour)}${pad(minute)}${pad(second)}-${suffix}.md`;
}

export function thoughtPath(createdAt: Date | string | number, suffix: string): string {
  return `${THOUGHT_DIR}/${thoughtFileName(createdAt, suffix)}`;
}

/** 从文件名还原想法 id（不含扩展名与目录）。 */
export function thoughtIdFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

/** 文章文件路径：src/content/writing/<slug>.md */
export function writingPath(slug: string): string {
  return `${WRITING_DIR}/${slug}.md`;
}

/** 上传目录：public/uploads/YYYY/MM/xxx.png */
export function uploadPath(fileName: string, date: Date = new Date()): string {
  const { year, month } = toParts(date);
  const safe = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${UPLOAD_DIR}/${year}/${String(month).padStart(2, '0')}/${safe || 'image.png'}`;
}

/** 内容文件在站点内的公开地址（用于封面、图片）。 */
export function publicPathFromContentPath(path: string): string {
  return `/${path.replace(/^public\//, '')}`;
}