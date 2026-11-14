// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import { unified } from '@astrojs/markdown-remark';

/**
 * GitHub Pages 项目站点部署在 /ship/ 下，base 必须与之保持一致。
 * 站点 URL 由部署工作流注入（见 .github/workflows/deploy.yml）。
 */
const site = process.env.PUBLIC_SITE_URL || 'https://example.github.io';

/** Markdown 输出白名单：在 rehype-sanitize 默认规则上放开常用的写作语法。 */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'mark',
    'kbd',
    'abbr',
    'details',
    'summary',
    'figure',
    'figcaption',
  ],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs/]],
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'id'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};

export default defineConfig({
  site,
  base: '/ship',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin/') && !page.includes('/studio/'),
    }),
  ],
  markdown: {
    // Astro 7 默认处理器是 Sätteri；这里显式启用 unified 管道，
    // 以便使用 rehype-slug（标题锚点）与 rehype-sanitize（XSS 清洗）。
    processor: unified({
      rehypePlugins: [rehypeSlug, [rehypeSanitize, sanitizeSchema]],
    }),
    shikiConfig: {
      theme: 'github-light',
      wrap: true,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});