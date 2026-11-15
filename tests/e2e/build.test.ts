import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 构建产物冒烟测试：必须先 `npm run build`。
 * 这里只读 dist/，不做任何写操作，也不启动构建。
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = resolve(ROOT, 'dist');

const BUILD_HINT = '先运行 `npm run build` 生成 dist/ 后再执行 e2e 测试（npm test 只跑单元测试）';

function distPath(relative: string): string {
  return resolve(DIST, relative);
}

function readDist(relative: string): string {
  const file = distPath(relative);
  expect(existsSync(file), `缺少产物 dist/${relative} —— ${BUILD_HINT}`).toBe(true);
  return readFileSync(file, 'utf8');
}

function readDistMarkup(relative: string): string {
  return readDist(relative).replace(/\s+/g, ' ');
}

const REQUIRED_FILES = [
  'dist/index.html',
  'dist/thoughts/index.html',
  'dist/writing/index.html',
  'dist/writing/2026-11-06-recording-freedom/index.html',
  'dist/archives/index.html',
  'dist/about/index.html',
  'dist/search/index.html',
  'dist/rss.xml',
  'dist/search.json',
  'dist/manifest.webmanifest',
  'dist/sw.js',
  'dist/admin/index.html',
  'dist/admin/config.yml',
];

describe('构建产物存在性', () => {
  it('dist/ 已经构建，否则给出明确提示', () => {
    expect(existsSync(DIST), `dist/ 不存在 —— ${BUILD_HINT}`).toBe(true);
    expect(readdirSync(DIST).length, `dist/ 是空的 —— ${BUILD_HINT}`).toBeGreaterThan(0);
  });

  it.each(REQUIRED_FILES)('存在 %s', (relative) => {
    expect(existsSync(distPath(relative.replace(/^dist\//, ''))), `缺少产物 ${relative} —— ${BUILD_HINT}`).toBe(
      true,
    );
  });

  it('存在 404 页面（Astro 输出 404.html，兼容 404/index.html）', () => {
    const candidates = [distPath('404.html'), distPath('404/index.html')];
    expect(
      candidates.some((candidate) => existsSync(candidate)),
      `缺少 404 页面（dist/404.html 或 dist/404/index.html） —— ${BUILD_HINT}`,
    ).toBe(true);
  });
});

/** 站内链接必须带 base（/ship/），否则 GitHub Pages 子路径部署会 404。 */
describe('站内链接都带 /ship/ 前缀', () => {
  const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

  function collectRefs(html: string): string[] {
    const refs: string[] = [];
    for (const match of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
      const value = (match[1] ?? '').trim();
      if (!value || EXTERNAL.test(value)) continue;
      refs.push(value);
    }
    return refs;
  }

  it('dist/index.html 的站内 href/src 全部以 /ship 开头', () => {
    const refs = collectRefs(readDist('index.html'));
    expect(refs.length).toBeGreaterThan(0);
    const broken = refs.filter((ref) => !ref.startsWith('/ship'));
    expect(broken, `以下站内链接缺少 /ship 前缀：${broken.join(', ')}`).toEqual([]);
  });

  it('首页链接到想法、文章、归档、关于与搜索', () => {
    const html = readDistMarkup('index.html');
    expect(html).toContain('href="/ship/thoughts');
    expect(html).toContain('href="/ship/writing');
    expect(html).toContain('href="/ship/archives');
    expect(html).toContain('href="/ship/about');
    expect(html).toContain('href="/ship/search');
  });
});

/** 模板漏值检查：这些页面里不应出现 undefined 字面量。 */
describe('页面不含 undefined 字面量', () => {
  it.each(['index.html', 'writing/2026-11-06-recording-freedom/index.html'])('%s', (relative) => {
    const html = readDist(relative);
    expect(html, `${relative} 中出现了 undefined，可能是模板漏值`).not.toContain('undefined');
  });
});

describe('文章详情页渲染', () => {
  const ARTICLE = 'writing/2026-11-06-recording-freedom/index.html';

  it('含标题', () => {
    expect(readDistMarkup(ARTICLE)).toContain('记录自由，写作才算自由');
  });

  it('含 <h2> 小节标题（rehype-slug 已注入 id）', () => {
    const html = readDistMarkup(ARTICLE);
    expect(html).toContain('<h2');
    expect(html).toContain('两件事，两种节奏');
  });

  it('含正文首句', () => {
    const html = readDistMarkup(ARTICLE);
    expect(html).toContain('我试过很多笔记软件');
    expect(html).toContain('记录和写作被混在了一起');
  });

  it('把 markdown 的加粗渲染成 <strong>', () => {
    expect(readDistMarkup(ARTICLE)).toContain('<strong>');
  });
});

describe('dist/search.json', () => {
  type IndexedDoc = { kind: string; id: string; title: string; url: string; text?: string };

  function loadIndex(): IndexedDoc[] {
    const raw = readDist('search.json');
    const parsed: unknown = JSON.parse(raw);
    expect(Array.isArray(parsed), 'dist/search.json 应该是数组').toBe(true);
    return parsed as IndexedDoc[];
  }

  it('是合法 JSON 数组', () => {
    expect(loadIndex().length).toBeGreaterThan(0);
  });

  it('索引条数与内容目录一致', () => {
    const docs = loadIndex();

    // 想法：目录里有几个 .md 就有几条（内容会持续增加，不能写死数字）。
    const thoughtFiles = readdirSync(resolve(ROOT, 'src/content/thoughts')).filter((file) => file.endsWith('.md'));
    const thoughtDocs = docs.filter((doc) => doc.kind === 'thought');
    expect(thoughtDocs).toHaveLength(thoughtFiles.length);

    // 文章：只统计 `published: true` 的源文件。
    const writingDir = resolve(ROOT, 'src/content/writing');
    const publishedFiles = readdirSync(writingDir)
      .filter((file) => file.endsWith('.md'))
      .filter((file) => /^published:\s*true/m.test(readFileSync(resolve(writingDir, file), 'utf8')));
    const writingDocs = docs.filter((doc) => doc.kind === 'writing');
    expect(writingDocs).toHaveLength(publishedFiles.length);

    expect(docs).toHaveLength(thoughtFiles.length + publishedFiles.length);
    expect(writingDocs.length).toBeGreaterThan(0);
  });
  it('不含未发布文章', () => {
    expect(readDist('search.json')).not.toContain('"published":false');
  });
});

describe('dist/rss.xml', () => {
  it('只有 3 篇已发布文章进入订阅', () => {
    const xml = readDist('rss.xml');
    expect(xml).toContain('<rss');
    expect(xml.match(/<item>/g) ?? []).toHaveLength(3);
  });

  it('文章标题出现在订阅里', () => {
    expect(readDist('rss.xml')).toContain('记录自由，写作才算自由');
  });
});

describe('dist/admin Sveltia CMS 产物', () => {
  const yaml = readDist('admin/config.yml');

  it('config.yml 是 YAML 文本', () => {
    expect(yaml).toContain('backend:');
    expect(yaml).toContain('media_folder:');
    expect(yaml).toContain('collections:');
  });

  it('backend 指向 github，并带有 OAuth 代理与仓库信息', () => {
    expect(yaml).toMatch(/name: github/);
    expect(yaml).toMatch(/repo: "\S+\/\S+"/);
    expect(yaml).toMatch(/branch: "\S+"/);
    expect(yaml).toMatch(/auth_endpoint: auth/);
    expect(yaml).toContain('local_backend: false');
  });

  it('媒体目录与公开路径符合约定', () => {
    expect(yaml).toContain('media_folder: "public/uploads"');
    expect(yaml).toContain('public_folder: "/uploads"');
  });

  it('包含 thoughts 与 writing 两个集合、十个字段齐全', () => {
    expect(yaml).toContain('folder: "src/content/thoughts"');
    expect(yaml).toContain('folder: "src/content/writing"');
    for (const field of [
      'createdAt',
      'updatedAt',
      'tags',
      'pinned',
      'body',
      'title',
      'description',
      'category',
      'published',
      'pubDate',
      'updatedDate',
      'cover',
      'featured',
    ]) {
      expect(yaml, `config.yml 缺少字段 ${field}`).toContain(`name: ${field}`);
    }
  });

  it('admin/index.html 加载 Sveltia CMS 并禁止收录', () => {
    const html = readDist('admin/index.html');
    expect(html).toContain('@sveltia/cms/dist/sveltia-cms.js');
    expect(html).toMatch(/name="robots" content="noindex/);
    expect(readDistMarkup('admin/index.html')).toContain('内容管理');
  });
});

describe('dist/manifest.webmanifest 与 sw.js', () => {
  it('manifest 是合法 JSON 且带图标', () => {
    const manifest: unknown = JSON.parse(readDist('manifest.webmanifest'));
    expect(typeof manifest).toBe('object');
    expect(JSON.stringify(manifest)).toContain('icons');
  });

  it('sw.js 注册缓存逻辑', () => {
    const sw = readDist('sw.js');
    expect(sw).toContain('addEventListener');
    expect(sw).toMatch(/install|fetch|activate/);
  });
});

describe('PWA 与离线能力', () => {
  it('首页注册 Service Worker 使用带 base 的 /ship/sw.js', () => {
    // Astro 会把内联脚本打包进 _astro/*.js，因此在产物 JS 里一起找注册地址。
    const bundles = readdirSync(distPath('_astro')).filter((file) => file.endsWith('.js'));
    const sources = [readDist('index.html'), ...bundles.map((file) => readDist(`_astro/${file}`))];
    const joined = sources.join('\n');
    expect(joined, '产物里应出现 Service Worker 注册').toContain('sw.js');
    expect(joined, '缺少斜杠会拼成 /shipsw.js，导致 404').not.toContain('/shipsw.js');
  });

  it('sw.js 的预缓存地址都带 /ship/ 前缀', () => {
    const sw = readDist('sw.js');
    expect(sw).toContain("const BASE = '/ship/'");
    expect(sw).not.toContain("'/ship404.html'");
  });
});