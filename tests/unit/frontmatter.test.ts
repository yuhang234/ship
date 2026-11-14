import { describe, expect, it } from 'vitest';
import {
  THOUGHT_DIR,
  UPLOAD_DIR,
  WRITING_DIR,
  parseDoc,
  publicPathFromContentPath,
  serializeDoc,
  thoughtFileName,
  thoughtIdFromPath,
  thoughtPath,
  uploadPath,
  writingPath,
} from '../../src/lib/frontmatter';

const AT = '2026-11-14T09:41:00.000Z';

describe('serializeDoc / parseDoc 往返', () => {
  it('中文、多行、tags 数组、冒号与引号都能原样往返', () => {
    const data = {
      createdAt: AT,
      tags: ['思考', '写作'],
      pinned: true,
      note: '引用: "引号" 与 「直角引号」: 多行\n第二行',
    };
    const body = '第一段正文，含中文标点：句号。\n\n## 小标题\n\n第二段正文';
    const raw = serializeDoc(data, body);

    expect(raw.startsWith('---\n')).toBe(true);
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain(`---\n\n${body}\n`);

    const parsed = parseDoc(raw);
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe(body);
  });

  it('数组包含中文与空格也能往返', () => {
    const data = { tags: ['机器 学习', '记录自由'], published: false };
    const parsed = parseDoc(serializeDoc(data, '正文'));
    expect(parsed.data).toEqual(data);
  });

  it('保留空 tags 数组（schema 允许空标签）', () => {
    const parsed = parseDoc(serializeDoc({ tags: [], pinned: false }, '正文'));
    expect(parsed.data['tags']).toEqual([]);
    expect(parsed.data['pinned']).toBe(false);
  });

  it('丢弃空字符串与 undefined，保留 0 与 false', () => {
    const parsed = parseDoc(
      serializeDoc({ title: '标题', description: '   ', cover: undefined, featured: false, order: 0 }, '正文'),
    );
    expect(parsed.data).toEqual({ title: '标题', featured: false, order: 0 });
    expect('description' in parsed.data).toBe(false);
    expect('cover' in parsed.data).toBe(false);
  });

  it('正文的 CRLF 会被统一为 LF', () => {
    const parsed = parseDoc(serializeDoc({ tags: ['a'] }, '第一行\r\n第二行'));
    expect(parsed.body).toBe('第一行\n第二行');
  });
});

describe('parseDoc 容错', () => {
  it('没有 frontmatter 时 data 为空对象，body 为全文', () => {
    const parsed = parseDoc('  只有正文的一段文字  ');
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('只有正文的一段文字');
  });

  it('frontmatter 未闭合时按正文处理', () => {
    const parsed = parseDoc('---\ntitle: 标题\n');
    expect(parsed.data).toEqual({});
    expect(parsed.body).toContain('title: 标题');
  });

  it('空文档返回空 data 与空 body', () => {
    expect(parseDoc('')).toEqual({ data: {}, body: '' });
  });

  it('CRLF 的 frontmatter 也能解析', () => {
    const parsed = parseDoc('---\r\ncreatedAt: 2026-11-14T09:41:00.000Z\r\ntags:\r\n  - 思考\r\n---\r\n\r\n正文\r\n');
    expect(parsed.data['createdAt']).toBe(AT);
    expect(parsed.data['tags']).toEqual(['思考']);
    expect(parsed.body).toBe('正文');
  });

  it('真实种子文件的 frontmatter 可被解析', () => {
    const parsed = parseDoc(
      '---\ncreatedAt: 2026-11-14T09:41:00.000Z\ntags:\n  - 思考\n  - 写作\npinned: true\n---\n\n记录不是为了记住。\n',
    );
    expect(parsed.data).toEqual({ createdAt: AT, tags: ['思考', '写作'], pinned: true });
    expect(parsed.body).toBe('记录不是为了记住。');
  });
});

describe('thoughtFileName / thoughtPath / thoughtIdFromPath', () => {
  it('文件名使用北京时间的时间部分', () => {
    expect(thoughtFileName(AT, 'cdef')).toBe('2026-11-14-174100-cdef.md');
  });

  it('UTC 深夜生成的时间属于北京时间的第二天', () => {
    expect(thoughtFileName('2026-11-14T17:30:05.000Z', 'abcd')).toBe('2026-11-15-013005-abcd.md');
  });

  it('月、日、时、分、秒补零', () => {
    expect(thoughtFileName('2026-01-04T01:05:06.000Z', 'wxyz')).toBe('2026-01-04-090506-wxyz.md');
  });

  it('thoughtPath 拼上想法目录', () => {
    expect(thoughtPath(AT, 'cdef')).toBe(`${THOUGHT_DIR}/2026-11-14-174100-cdef.md`);
    expect(THOUGHT_DIR).toBe('src/content/thoughts');
  });

  it('thoughtIdFromPath 去掉目录与扩展名', () => {
    expect(thoughtIdFromPath('src/content/thoughts/2026-11-14-174100-cdef.md')).toBe(
      '2026-11-14-174100-cdef',
    );
    expect(thoughtIdFromPath('2026-11-14-174100-cdef.md')).toBe('2026-11-14-174100-cdef');
    expect(thoughtIdFromPath('src/content/thoughts/2026-11-14-174100-cdef.MD')).toBe(
      '2026-11-14-174100-cdef',
    );
  });
});

describe('writingPath / uploadPath / publicPathFromContentPath', () => {
  it('writingPath 使用 slug 作为文件名', () => {
    expect(WRITING_DIR).toBe('src/content/writing');
    expect(writingPath('2026-11-06-recording-freedom')).toBe(
      'src/content/writing/2026-11-06-recording-freedom.md',
    );
  });

  it('uploadPath 按北京时间的年/月分目录', () => {
    expect(UPLOAD_DIR).toBe('public/uploads');
    expect(uploadPath('shot.png', new Date(AT))).toBe('public/uploads/2026/11/shot.png');
  });

  it('uploadPath 清洗空格、括号与大写字母', () => {
    expect(uploadPath('My Photo (1).PNG', new Date(AT))).toBe('public/uploads/2026/11/my-photo-1-.png');
  });

  it('uploadPath 把路径分隔符换成连字符，不留下子目录', () => {
    const output = uploadPath('../../etc/passwd.png', new Date(AT));
    expect(output.startsWith('public/uploads/2026/11/')).toBe(true);
    const base = output.slice('public/uploads/2026/11/'.length);
    expect(base).not.toContain('/');
  });

  it('uploadPath 结果为空的文件名回退为 image.png', () => {
    expect(uploadPath('图', new Date(AT))).toBe('public/uploads/2026/11/image.png');
  });

  it('publicPathFromContentPath 去掉 public 前缀', () => {
    expect(publicPathFromContentPath('public/uploads/2026/11/shot.png')).toBe('/uploads/2026/11/shot.png');
    expect(publicPathFromContentPath('uploads/2026/11/shot.png')).toBe('/uploads/2026/11/shot.png');
  });
});