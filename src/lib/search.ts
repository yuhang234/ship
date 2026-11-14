/** 全站搜索：构建期生成索引，浏览器端按分词打分排序。 */

export interface SearchDoc {
  kind: 'thought' | 'writing';
  id: string;
  /** 想法为空字符串 */
  title: string;
  url: string;
  date: string;
  iso: string;
  tags: string[];
  text: string;
}

export interface SearchHit extends SearchDoc {
  score: number;
}

/** 查询分词：中英混排、去停用词、单字保留（中文检索更适合按字匹配）。 */
export function tokenize(query: string): string[] {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return [];
  const chunks = normalized.split(/[\s,，、。？?！!；;：:]+/).filter(Boolean);
  const tokens: string[] = [];
  for (const chunk of chunks) {
    if (/^[\u3400-\u9fff]+$/.test(chunk)) {
      for (const char of chunk) tokens.push(char);
    } else if (chunk.length >= 2) {
      tokens.push(chunk);
    } else {
      tokens.push(chunk);
    }
  }
  return [...new Set(tokens)].slice(0, 12);
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 8) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 打分规则：标题 8、标签 5、正文 2，出现次数额外加权（上限 8 次）。
 * 所有关键词都必须命中（AND），否则记 0 分。
 */
export function scoreDoc(doc: SearchDoc, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const title = doc.title.toLowerCase();
  const tags = doc.tags.join(' ').toLowerCase();
  const text = doc.text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const inTitle = occurrences(title, token);
    const inTags = occurrences(tags, token);
    const inText = occurrences(text, token);
    if (inTitle === 0 && inTags === 0 && inText === 0) return 0;
    score += inTitle * 8 + inTags * 5 + Math.min(inText, 4) * 2;
    if (inTitle > 0) score += 4;
    if (doc.kind === 'writing') score += 1;
  }
  return score;
}

export function searchDocs(docs: readonly SearchDoc[], query: string, limit = 20): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return docs
    .map((doc) => ({ ...doc, score: scoreDoc(doc, tokens) }))
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score || b.iso.localeCompare(a.iso))
    .slice(0, limit);
}

/** 生成高亮片段：命中词周围取一段文本。 */
export function snippet(text: string, query: string, radius = 40): string {
  const tokens = tokenize(query);
  const lower = text.toLowerCase();
  let hit = -1;
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index !== -1 && (hit === -1 || index < hit)) hit = index;
  }
  if (hit === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, hit - radius);
  const end = Math.min(text.length, hit + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}