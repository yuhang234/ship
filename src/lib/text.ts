/** 纯文本工具：slug、阅读时长、摘要、标签整理。 */
import { dayKey } from './date';

/** 去掉 markdown 语法，得到用于搜索、摘要的纯文本。 */
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 中文字符数（含标点外的汉字）与英文单词数。 */
export function countWords(input: string): { cjk: number; words: number } {
  const text = stripMarkdown(input);
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  const words = (text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9'_-]+/g) ?? [])
    .length;
  return { cjk, words };
}

/** 阅读时长（分钟）：中文 400 字/分钟，英文 220 词/分钟，至少 1 分钟。 */
export function readingTime(input: string): number {
  const { cjk, words } = countWords(input);
  if (cjk + words === 0) return 1;
  return Math.max(1, Math.ceil(cjk / 400 + words / 220));
}

/** 摘要：优先用显式 description，否则截取正文开头。 */
export function excerpt(input: string, maxLength = 140): string {
  const text = stripMarkdown(input).replace(/\n/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/** URL 片段：保留 ASCII 字母数字，中文标题回退为 note。 */
export function slugify(input: string): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return ascii.slice(0, 60);
}

/**
 * 文章文件名/URL：日期前缀 + 标题片段，中文标题回退为 note，
 * 文件名同时作为文章永久链接，发布后保持稳定。
 */
export function makeSlug(title: string, date: Date | string | number = new Date()): string {
  const base = slugify(title);
  const prefix = dayKey(date);
  return `${prefix}-${base || 'note'}`;
}

/** 标签清洗：去重、去空白、限制长度与数量。 */
export function normalizeTags(tags: readonly string[] | string | undefined): string[] {
  if (!tags) return [];
  const list = typeof tags === 'string' ? tags.split(/[,，、\s]+/) : [...tags];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    const tag = String(raw).replace(/^#/, '').trim().slice(0, 24);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= 12) break;
  }
  return result;
}

/** 统计标签使用次数，按次数倒序。 */
export function tagCounts(items: readonly (readonly string[])[]): Array<{ tag: string; count: number }> {
  const counter = new Map<string, number>();
  for (const tags of items) {
    for (const tag of tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
}

/** 随机短 ID，用于文件名去重。 */
export function randomId(length = 4): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}