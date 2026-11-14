import { describe, expect, it } from 'vitest';
import type { SearchDoc } from '../../src/lib/search';
import { scoreDoc, searchDocs, snippet, tokenize } from '../../src/lib/search';

function makeDoc(overrides: Partial<SearchDoc> = {}): SearchDoc {
  return {
    kind: 'writing',
    id: 'doc',
    title: '',
    url: '/ship/writing/doc/',
    date: '2026-11-14',
    iso: '2026-11-14T09:41:00.000Z',
    tags: [],
    text: '',
    ...overrides,
  };
}

describe('tokenize', () => {
  it('中文按字拆开', () => {
    expect(tokenize('记录自由')).toEqual(['记', '录', '自', '由']);
  });

  it('英文保留整词并转小写', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
    expect(tokenize('Astro')).toEqual(['astro']);
  });

  it('中英混排分别处理', () => {
    expect(tokenize('Astro 中文')).toEqual(['astro', '中', '文']);
  });

  it('按中英文标点与空格分词', () => {
    expect(tokenize('记录，自由、写作;电影')).toEqual(['记', '录', '自', '由', '写', '作', '电', '影']);
  });

  it('去重且最多 12 个 token', () => {
    expect(tokenize('记录记录')).toEqual(['记', '录']);
    expect(tokenize('记录自由写作电影音乐阅读旅行摄影咖啡设计编程')).toHaveLength(12);
  });

  it('空查询返回空数组', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('scoreDoc', () => {
  it('标题命中权重高于正文命中', () => {
    const inTitle = makeDoc({ kind: 'thought', title: 'astro' });
    const inBody = makeDoc({ kind: 'thought', text: 'astro' });
    expect(scoreDoc(inTitle, ['astro'])).toBeGreaterThan(scoreDoc(inBody, ['astro']));
    expect(scoreDoc(inBody, ['astro'])).toBeGreaterThan(0);
  });

  it('标签命中的权重介于标题与正文之间', () => {
    const inTitle = makeDoc({ kind: 'thought', title: 'astro' });
    const inTags = makeDoc({ kind: 'thought', tags: ['astro'] });
    const inBody = makeDoc({ kind: 'thought', text: 'astro' });
    expect(scoreDoc(inTitle, ['astro'])).toBeGreaterThan(scoreDoc(inTags, ['astro']));
    expect(scoreDoc(inTags, ['astro'])).toBeGreaterThan(scoreDoc(inBody, ['astro']));
  });

  it('AND 语义：缺任意一个 token 记 0 分', () => {
    const doc = makeDoc({ title: '记录自由', text: '记录自由是重要的' });
    expect(scoreDoc(doc, tokenize('记录'))).toBeGreaterThan(0);
    expect(scoreDoc(doc, tokenize('记录 不存在'))).toBe(0);
  });

  it('空 token 列表记 0 分', () => {
    expect(scoreDoc(makeDoc({ title: 'astro' }), [])).toBe(0);
  });

  it('文章比想法多一分（同等命中下优先展示文章）', () => {
    const writing = makeDoc({ kind: 'writing', title: 'astro' });
    const thought = makeDoc({ kind: 'thought', title: 'astro' });
    expect(scoreDoc(writing, ['astro'])).toBe(scoreDoc(thought, ['astro']) + 1);
  });

  it('命中次数有加权上限，长文不会无脑刷分', () => {
    const once = makeDoc({ kind: 'thought', text: 'astro' });
    const many = makeDoc({ kind: 'thought', text: 'astro '.repeat(20) });
    expect(scoreDoc(many, ['astro'])).toBeGreaterThan(scoreDoc(once, ['astro']));
    expect(scoreDoc(many, ['astro'])).toBe(scoreDoc(once, ['astro']) + 6);
  });
});

describe('searchDocs', () => {
  const docs: SearchDoc[] = [
    makeDoc({ id: 'a', kind: 'thought', title: '记录自由', iso: '2026-11-01T00:00:00.000Z' }),
    makeDoc({
      id: 'b',
      kind: 'writing',
      title: '记录自由，写作才算自由',
      text: '记录',
      iso: '2026-11-02T00:00:00.000Z',
    }),
    makeDoc({ id: 'c', kind: 'writing', title: '无关内容', text: '完全不相关', iso: '2026-11-03T00:00:00.000Z' }),
  ];

  it('只返回至少命中一次的结果并按分数倒序', () => {
    const hits = searchDocs(docs, '记录自由');
    expect(hits.map((hit) => hit.id)).toEqual(['b', 'a']);
    expect(hits.every((hit) => hit.score > 0)).toBe(true);
  });

  it('同分时按时间倒序', () => {
    const hits = searchDocs(
      [
        makeDoc({ id: 'old', title: 'astro', iso: '2026-01-01T00:00:00.000Z' }),
        makeDoc({ id: 'new', title: 'astro', iso: '2026-11-01T00:00:00.000Z' }),
      ],
      'astro',
    );
    expect(hits.map((hit) => hit.id)).toEqual(['new', 'old']);
  });

  it('尊重 limit', () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      makeDoc({ id: `d${index}`, title: '记录', iso: `2026-11-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z` }),
    );
    expect(searchDocs(many, '记录', 5)).toHaveLength(5);
    expect(searchDocs(many, '记录', 100)).toHaveLength(25);
    expect(searchDocs(many, '记录')).toHaveLength(20);
  });

  it('空查询返回空数组', () => {
    expect(searchDocs(docs, '')).toEqual([]);
  });

  it('无命中返回空数组', () => {
    expect(searchDocs(docs, 'zzzz')).toEqual([]);
  });
});

describe('snippet', () => {
  it('命中在中间时两侧补省略号', () => {
    const text = `${'前言'.repeat(40)}记录自由${'后记'.repeat(40)}`;
    const output = snippet(text, '记录');
    expect(output.startsWith('…')).toBe(true);
    expect(output.endsWith('…')).toBe(true);
    expect(output).toContain('记录');
  });

  it('命中在开头时不留前置省略号', () => {
    const text = `记录自由${'后记'.repeat(40)}`;
    const output = snippet(text, '记录');
    expect(output.startsWith('记录')).toBe(true);
    expect(output.endsWith('…')).toBe(true);
  });

  it('短文本命中时不补省略号', () => {
    expect(snippet('记录自由', '记录')).toBe('记录自由');
  });

  it('未命中时截取开头且不加省略号', () => {
    const text = 'a'.repeat(200);
    const output = snippet(text, 'zzz');
    expect(output).toHaveLength(80);
    expect(output).not.toContain('…');
  });
});