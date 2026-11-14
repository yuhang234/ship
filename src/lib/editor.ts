/**
 * Markdown 编辑辅助：预览渲染、工具栏包裹、快捷键、字数统计。
 * 只依赖项目里已装好的 `marked` 与 `dompurify`，不引入编辑器框架。
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { countWords, readingTime, stripMarkdown } from './text';

/** 工具栏动作；'link'/'image' 可额外传入 value（链接或图片地址）。 */
export type ToolbarAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeblock'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'h2'
  | 'link'
  | 'image'
  | 'hr';

export interface FormatResult {
  /** 处理后的整段文本 */
  text: string;
  /** 处理完后应设置的选区起点 */
  selectionStart: number;
  /** 处理完后应设置的选区终点 */
  selectionEnd: number;
}

/** 把 Markdown 渲染成可安全插入 DOM 的 HTML。 */
export function renderPreview(markdown: string): string {
  const source = markdown ?? '';
  const parsed = marked.parse(source, { async: false, gfm: true, breaks: true });
  const html = typeof parsed === 'string' ? parsed : String(parsed ?? '');
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  return hardenLinks(clean);
}

/** 给站外链接补 target/rel，避免预览里点开新窗口丢失 opener 保护。 */
function hardenLinks(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const parsed = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = parsed.getElementById('root');
  if (!root) return html;
  for (const link of Array.from(root.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return root.innerHTML;
}

/** 用前后缀包裹选区；空选区时把光标停在包裹符中间。 */
function wrapSelection(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
): FormatResult {
  const selected = text.slice(start, end);
  const next = `${text.slice(0, start)}${before}${selected}${after}${text.slice(end)}`;
  const cursor = start + before.length;
  return { text: next, selectionStart: cursor, selectionEnd: cursor + selected.length };
}

/** 给选区覆盖的每一行加前缀（引用、列表、标题都用它）。 */
function prefixLines(
  text: string,
  start: number,
  end: number,
  prefix: (index: number) => string,
): FormatResult {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const nextBlock = lines.map((line, index) => `${prefix(index)}${line}`).join('\n');
  const next = `${text.slice(0, lineStart)}${nextBlock}${text.slice(lineEnd)}`;

  const firstPrefix = prefix(0);
  return {
    text: next,
    selectionStart: Math.min(next.length, lineStart + firstPrefix.length),
    selectionEnd: lineStart + nextBlock.length,
  };
}

/**
 * 对 textarea 的当前选区套用工具栏动作。
 * 返回值由调用方写回 textarea 并设置选区（本函数不直接改 DOM，方便撤销栈保持一致）。
 */
export function applyFormat(
  textarea: HTMLTextAreaElement,
  action: ToolbarAction,
  value?: string,
): FormatResult {
  const text = textarea.value;
  const start = textarea.selectionStart ?? text.length;
  const end = textarea.selectionEnd ?? start;
  const selected = text.slice(start, end);

  switch (action) {
    case 'bold':
      return wrapSelection(text, start, end, '**', '**');
    case 'italic':
      return wrapSelection(text, start, end, '_', '_');
    case 'strike':
      return wrapSelection(text, start, end, '~~', '~~');
    case 'code':
      return wrapSelection(text, start, end, '`', '`');
    case 'codeblock':
      return wrapSelection(text, start, end, '```\n', '\n```');
    case 'quote':
      return prefixLines(text, start, end, () => '> ');
    case 'ul':
      return prefixLines(text, start, end, () => '- ');
    case 'ol':
      return prefixLines(text, start, end, (index) => `${index + 1}. `);
    case 'h2':
      return prefixLines(text, start, end, () => '## ');
    case 'link': {
      const href = (value ?? '').trim() || 'https://';
      const label = selected || '链接文字';
      const next = `${text.slice(0, start)}[${label}](${href})${text.slice(end)}`;
      const hrefStart = start + label.length + 3;
      return { text: next, selectionStart: hrefStart, selectionEnd: hrefStart + href.length };
    }
    case 'image': {
      const href = (value ?? '').trim();
      const alt = selected;
      const next = `${text.slice(0, start)}![${alt}](${href})${text.slice(end)}`;
      const hrefStart = start + alt.length + 4;
      return { text: next, selectionStart: hrefStart, selectionEnd: hrefStart + href.length };
    }
    case 'hr': {
      const needsBlankBefore = start > 0 && text[start - 1] !== '\n';
      const insert = `${needsBlankBefore ? '\n\n' : ''}---\n\n`;
      const next = `${text.slice(0, start)}${insert}${text.slice(end)}`;
      const cursor = start + insert.length;
      return { text: next, selectionStart: cursor, selectionEnd: cursor };
    }
    default:
      return { text, selectionStart: start, selectionEnd: end };
  }
}

/**
 * 绑定 Ctrl/Cmd+S（存草稿）与 Ctrl/Cmd+Enter（发布）。
 * 返回解绑函数；普通按键不拦截。
 */
export function bindShortcuts(
  element: HTMLElement,
  handlers: { save?: () => void; publish?: () => void },
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key === 's' && handlers.save) {
      event.preventDefault();
      handlers.save();
      return;
    }
    if (key === 'enter' && handlers.publish) {
      event.preventDefault();
      handlers.publish();
    }
  };

  element.addEventListener('keydown', onKeyDown);
  return () => {
    element.removeEventListener('keydown', onKeyDown);
  };
}

/** 字数 / 阅读时长 / 字符数（均基于去掉 Markdown 语法的纯文本）。 */
export function countStats(markdown: string): { minutes: number; words: number; chars: number } {
  const { cjk, words } = countWords(markdown);
  return {
    minutes: readingTime(markdown),
    words: cjk + words,
    chars: stripMarkdown(markdown).length,
  };
}