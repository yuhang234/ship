import { describe, expect, it } from 'vitest';
import {
  countWords,
  excerpt,
  makeSlug,
  normalizeTags,
  readingTime,
  slugify,
  stripMarkdown,
  tagCounts,
} from '../../src/lib/text';

describe('stripMarkdown', () => {
  it('去掉标题、强调、链接与行内代码', () => {
    const input = '# 标题\n\n**粗体** 和 [链接](https://example.com) 与 `代码`';
    expect(stripMarkdown(input)).toBe('标题\n粗体 和 链接 与');
  });

  it('去掉代码块、列表符号与引用符号', () => {
    const input = '```js\nconst a = 1;\n```\n- 第一项\n- 第二项\n> 引用';
    expect(stripMarkdown(input)).not.toContain('```');
    expect(stripMarkdown(input)).not.toContain('const a');
    expect(stripMarkdown(input)).toContain('第一项');
    expect(stripMarkdown(input)).toContain('引用');
    expect(stripMarkdown(input)).not.toContain('>');
  });

  it('去掉图片与 HTML 标签', () => {
    const input = '![封面](/uploads/a.png) 正文 <span>高亮</span>';
    const output = stripMarkdown(input);
    expect(output).not.toContain('![');
    expect(output).not.toContain('<span>');
    expect(output).toContain('正文');
    expect(output).toContain('高亮');
  });

  it('压缩多余空白并去掉首尾空白', () => {
    expect(stripMarkdown('  很多    空格  ')).toBe('很多 空格');
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\nb');
  });
});

describe('countWords', () => {
  it('分别统计中文与英文', () => {
    expect(countWords('中文 hello world')).toEqual({ cjk: 2, words: 2 });
  });

  it('忽略 markdown 语法后再统计', () => {
    expect(countWords('**中文**')).toEqual({ cjk: 2, words: 0 });
  });

  it('空文本返回零', () => {
    expect(countWords('')).toEqual({ cjk: 0, words: 0 });
  });
});

describe('readingTime', () => {
  it('中文 800 字约 2 分钟（400 字/分钟）', () => {
    expect(readingTime('字'.repeat(800))).toBe(2);
  });

  it('中文 400 字约 1 分钟', () => {
    expect(readingTime('字'.repeat(400))).toBe(1);
  });

  it('英文 220 词约 1 分钟，440 词约 2 分钟', () => {
    expect(readingTime('word '.repeat(220))).toBe(1);
    expect(readingTime('word '.repeat(440))).toBe(2);
  });

  it('空文本也至少 1 分钟，永不返回 0', () => {
    expect(readingTime('')).toBe(1);
    expect(readingTime('短')).toBe(1);
  });
});

describe('excerpt', () => {
  it('短文本原样返回', () => {
    expect(excerpt('一句很短的话', 140)).toBe('一句很短的话');
  });

  it('超长文本截断并补省略号', () => {
    const output = excerpt('长'.repeat(200));
    expect(output.length).toBe(141);
    expect(output.endsWith('…')).toBe(true);
    expect(output).toBe(`${'长'.repeat(140)}…`);
  });

  it('尊重自定义长度', () => {
    expect(excerpt('ABCDEFGHIJ', 4)).toBe('ABCD…');
  });

  it('换行折叠为空格并去掉 markdown', () => {
    const output = excerpt('## 标题\n第一段\n第二段', 140);
    expect(output).toBe('标题 第一段 第二段');
  });
});

describe('slugify', () => {
  it('纯中文标题得到空字符串（由调用方回退）', () => {
    expect(slugify('记录自由')).toBe('');
  });

  it('英文标题转小写并用连字符连接', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('Hello, World! 2026')).toBe('hello-world-2026');
  });

  it('去掉重音符号', () => {
    expect(slugify('Café au lait')).toBe('cafe-au-lait');
  });

  it('最长 60 个字符', () => {
    expect(slugify('a'.repeat(120)).length).toBe(60);
  });

  it('去掉首尾与重复的连字符', () => {
    expect(slugify('--Hello   World--')).toBe('hello-world');
  });
});

describe('makeSlug', () => {
  it('日期前缀来自北京时间的 dayKey', () => {
    expect(makeSlug('Hello World', '2026-11-14T09:41:00.000Z')).toBe('2026-11-14-hello-world');
    expect(makeSlug('Hello World', '2026-11-14T17:30:00.000Z')).toBe('2026-11-15-hello-world');
  });

  it('中文标题回退为 note', () => {
    expect(makeSlug('记录自由', '2026-11-14T09:41:00.000Z')).toBe('2026-11-14-note');
  });
});

describe('normalizeTags', () => {
  it('去掉 # 前缀与空白', () => {
    expect(normalizeTags(['#思考', ' 思考 ', ' 写作 '])).toEqual(['思考', '写作']);
  });

  it('忽略大小写去重', () => {
    expect(normalizeTags(['Astro', 'astro', 'ASTRO'])).toEqual(['Astro']);
  });

  it('过滤空标签', () => {
    expect(normalizeTags(['', '  ', '#'])).toEqual([]);
  });

  it('最多保留 12 个', () => {
    const many = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
    const output = normalizeTags(many);
    expect(output.length).toBe(12);
    expect(output[0]).toBe('tag-0');
    expect(output[11]).toBe('tag-11');
  });

  it('接受字符串输入并按分隔符拆分', () => {
    expect(normalizeTags('a, b、c  d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('单个标签最长 24 个字符', () => {
    const output = normalizeTags(['x'.repeat(40)]);
    expect(output[0]?.length).toBe(24);
  });

  it('空输入返回空数组', () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe('tagCounts', () => {
  it('按使用次数倒序排列', () => {
    expect(tagCounts([['写作', '思考'], ['思考', '电影'], ['思考']])).toEqual([
      { tag: '思考', count: 3 },
      { tag: '电影', count: 1 },
      { tag: '写作', count: 1 },
    ]);
  });

  it('同次数时按字典序稳定排序', () => {
    expect(tagCounts([['b'], ['a'], ['c']])).toEqual([
      { tag: 'a', count: 1 },
      { tag: 'b', count: 1 },
      { tag: 'c', count: 1 },
    ]);
  });

  it('空输入返回空数组', () => {
    expect(tagCounts([])).toEqual([]);
  });
});