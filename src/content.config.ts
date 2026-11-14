import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 想法（thoughts）：轻量、无标题、按时间线浏览。
 * 文件名即 ID，例如 2026-11-14-203900-a1b2.md
 */
const thoughts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/thoughts' }),
  schema: z.object({
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    pinned: z.boolean().default(false),
  }),
});

/**
 * 文章（writing）：有标题、分类、标签，发布后成为独立页面 /writing/<slug>/
 * published=false 的文章只在写作后台可见。
 */
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string().min(1).max(120),
    description: z.string().default(''),
    category: z.string().default('随笔'),
    tags: z.array(z.string()).default([]),
    published: z.boolean().default(false),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    cover: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});

export const collections = { thoughts, writing };