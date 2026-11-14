/**
 * 全站配置。构建期通过 PUBLIC_* 环境变量注入，避免在源码里写死账号信息。
 * 所有 import.meta.env.PUBLIC_* 会被 Vite 内联，因此在浏览器端同样可用。
 */

const repoEnv = (import.meta.env.PUBLIC_GITHUB_REPO as string | undefined)?.trim() || 'owner/ship';
const [repoOwner, repoName] = repoEnv.includes('/')
  ? repoEnv.split('/')
  : ['owner', repoEnv];

export const SITE = {
  title: 'ship',
  tagline: '把想法留在自己的船上',
  description:
    'ship 是一个人的思想记录与写作空间：随手记下零散念头，也把值得展开的想法写成文章。',
  author: 'ship',
  locale: 'zh-CN',
  timeZone: 'Asia/Shanghai',
  language: 'zh-CN',
} as const;

export const REPO = {
  fullName: repoEnv,
  owner: repoOwner,
  name: repoName,
  branch: (import.meta.env.PUBLIC_GITHUB_BRANCH as string | undefined)?.trim() || 'main',
} as const;

/** 站点绝对地址，末尾去掉斜杠。 */
export const SITE_URL = (
  (import.meta.env.PUBLIC_SITE_URL as string | undefined) || 'https://example.github.io'
).replace(/\/+$/, '');

/** Cloudflare Worker OAuth 代理地址，为空表示尚未配置登录服务。 */
export const OAUTH_BASE = (
  (import.meta.env.PUBLIC_OAUTH_BASE as string | undefined) || ''
).replace(/\/+$/, '');

/** Astro base 前缀，始终以 / 开头且以 / 结尾，例如 /ship/。 */
/**
 * Astro 的 BASE_URL 在 base: '/ship' 时是 `/ship`（不带尾斜杠），
 * 因此这里统一补成带尾斜杠的前缀，避免拼出 `/shipabout/` 这种地址。
 */
export const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/**
 * 把站内路径拼成带 base 的可用地址。
 * url('writing') 与 url('/writing/hello/') 都会得到 /ship/writing/hello/
 */
export function url(path = ''): string {
  const clean = String(path).replace(/^\/+/, '');
  return `${BASE}${clean}`;
}

/** 站外或站内统一成绝对地址，用于 canonical、RSS。 */
export function absoluteUrl(path = ''): string {
  return `${SITE_URL}${url(path)}`;
}

export const CONTENT_PATHS = {
  thoughts: 'src/content/thoughts',
  writing: 'src/content/writing',
  uploads: 'public/uploads',
} as const;

/** 后台与 CMS 地址（带 base）。 */
export const STUDIO_PATH = url('studio/');
export const CMS_PATH = url('admin/');