/**
 * Sveltia / Decap CMS 配置端点：构建期生成 `/admin/config.yml`。
 *
 * 为什么用 .ts 端点而不是静态文件：仓库名、分支、站点域名、OAuth 代理地址全部来自
 * `src/lib/site.ts`（即构建期的 PUBLIC_* 环境变量）。这样换账号、换域名、换 Worker 时
 * 不需要改任何硬编码字符串，也不会有 owner 泄露到版本库里的风险。
 *
 * 关于 slug 模板的已知限制：
 * Sveltia 对 `{{random_4}}` 这类模板变量的支持并不确定；一旦不支持，新建内容会落到同一个
 * 文件名上互相覆盖。这里保守地只用时间戳（精确到秒），它与前台 `src/lib/text.ts` 的
 * “日期前缀”约定一致。
 * 如果你确认所用的 Sveltia 版本支持 `{{random_4}}`，可以在 thoughts 的 slug 末尾追加
 * `-{{random_4}}` 以进一步降低同秒冲突的概率。
 *
 * 字段与 `src/content.config.ts` 的 zod schema 严格一一对应（thoughts / writing）。
 */
import type { APIRoute } from 'astro';
import { BASE, OAUTH_BASE, REPO, SITE_URL } from '../../lib/site';

/** 站点根地址（含 base），例如 https://owner.github.io/ship/。 */
const SITE_ROOT = `${SITE_URL}${BASE}`;

/** base_url 未配置时输出空字符串，Sveltia 会走默认流程并给出可读错误，而不是 `undefined`。 */
const OAUTH_BASE_VALUE = OAUTH_BASE === '' ? "''" : `"${OAUTH_BASE}"`;

const CONFIG = `# 由 src/pages/admin/config.yml.ts 在构建期生成，请勿手工编辑。
# 仓库、分支、域名、OAuth 代理地址均来自构建期环境变量（PUBLIC_GITHUB_REPO /
# PUBLIC_GITHUB_BRANCH / PUBLIC_SITE_URL / PUBLIC_OAUTH_BASE）。
backend:
  name: github
  repo: "${REPO.fullName}"
  branch: "${REPO.branch}"
  base_url: ${OAUTH_BASE_VALUE}
  auth_endpoint: auth
local_backend: false
media_folder: "public/uploads"
public_folder: "/uploads"
site_url: "${SITE_ROOT}"
display_url: "${SITE_ROOT}"
logo_url: "${SITE_ROOT}favicon.svg"
locale: zh_Hans
collections:
  - name: thoughts
    label: 想法
    label_singular: 一条想法
    folder: "src/content/thoughts"
    create: true
    delete: true
    extension: md
    format: frontmatter
    # 秒级时间戳，与前台 thoughts 的“日期前缀”约定一致。
    # 若确认 Sveltia 支持 {{random_4}}，可改为 ...{{second}}-{{random_4}} 降低同秒冲突。
    slug: '{{year}}-{{month}}-{{day}}-{{hour}}{{minute}}{{second}}'
    summary: '{{createdAt}} · {{body}}'
    fields:
      - { name: createdAt, label: 记录时间, widget: datetime }
      - { name: updatedAt, label: 更新时间, widget: datetime, required: false }
      - { name: tags, label: 标签, widget: list, required: false, default: [] }
      - { name: pinned, label: 置顶, widget: boolean, default: false, required: false }
      - { name: body, label: 正文, widget: markdown }
  - name: writing
    label: 文章
    label_singular: 一篇文章
    folder: "src/content/writing"
    create: true
    delete: true
    extension: md
    format: frontmatter
    # 日期前缀 + 标题 slug，与前台 makeSlug 的约定一致。
    slug: '{{year}}-{{month}}-{{day}}-{{slug}}'
    summary: '{{title}} · {{description}}'
    fields:
      - { name: title, label: 标题, widget: string }
      - { name: description, label: 摘要, widget: text, required: false }
      - { name: category, label: 分类, widget: string, default: 随笔 }
      - { name: tags, label: 标签, widget: list, required: false, default: [] }
      - { name: published, label: 已发布, widget: boolean, default: false }
      - { name: pubDate, label: 发布日期, widget: datetime }
      - { name: updatedDate, label: 更新日期, widget: datetime, required: false }
      - { name: cover, label: 封面, widget: image, required: false }
      - { name: featured, label: 精选, widget: boolean, default: false }
      - { name: body, label: 正文, widget: markdown }
`;

/** `GET /admin/config.yml` → 生成的 CMS 配置文本。 */
export const GET: APIRoute = () =>
  new Response(CONFIG, {
    status: 200,
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });