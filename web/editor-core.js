import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

// Tiptap registers editor-specific tokens on its parser. Keep preview/inspection independent.
const marked = new Marked({ gfm: true, async: false });

export function extensions() {
  return [StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false } }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({ nested: true }),
    Image.extend({
      renderHTML({ HTMLAttributes }) { return ['img', { ...HTMLAttributes, src: imageSource(HTMLAttributes.src) }]; },
    }).configure({ inline: true, allowBase64: false }),
    Placeholder.configure({ placeholder: '从这里开始写，或拖入一个 .md 文件…' })];
}

export function unsupportedReason(text) {
  const reasons = new Set();
  if (/^\uFEFF?---\s*\r?\n/.test(text) || /^\+\+\+\s*\r?\n/.test(text)) reasons.add('文档元数据');
  const tokens = marked.lexer(text, { gfm: true });
  const visit = list => { for (const t of list ?? []) {
    if (t.type === 'html') reasons.add('内嵌 HTML');
    if (t.type === 'def') reasons.add('引用式链接');
    if (t.type === 'code') continue;
    if (t.tokens) visit(t.tokens);
    if (t.items) visit(t.items);
    if (t.header) for (const c of t.header) visit(c.tokens);
    if (t.rows) for (const r of t.rows) for (const c of r) visit(c.tokens);
    if (t.type === 'text' && /\[\^[^\]]+\]|\[\[[^\]]+\]\]|\$\$|\{:[^}]*\}/.test(t.raw)) reasons.add('扩展语法');
  } };
  visit(tokens);
  return [...reasons].join('、');
}

export function safePreview(text) {
  const clean = DOMPurify.sanitize(marked.parse(text, { gfm: true }), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'button', 'video', 'audio'],
    FORBID_ATTR: ['style', 'srcset', 'id', 'name'],
  });
  const template = document.createElement('template'); template.innerHTML = clean;
  template.content.querySelectorAll('input').forEach(input => {
    if (input.type !== 'checkbox' || !input.closest('li')) { input.remove(); return; }
    input.disabled = true; input.tabIndex = -1;
  });
  template.content.querySelectorAll('img').forEach(img => img.setAttribute('src', imageSource(img.getAttribute('src'))));
  return template.innerHTML;
}

export function imageSource(src) {
  if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src) || src.split(/[\\/]/).includes('..')) return '';
  return new URL(src.replaceAll('\\', '/').replace(/^\//, ''), 'https://document.moxi.local/').href;
}

export function lineEndings(text, eol) { return text.replace(/\r\n|\r|\n/g, eol); }
export function countCharacters(text) { return [...text.replace(/\s/g, '')].length; }

export function roundTripSafe(editor, text) {
  const first = editor.markdown.parse(text);
  const next = editor.markdown.parse(editor.markdown.serialize(first));
  // Mark nesting order and object key order do not change Markdown semantics.
  function canonical(value, key = '') {
    if (Array.isArray(value)) {
      const items = value.map(item => canonical(item));
      return key === 'marks' ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k], k)]));
    return value;
  }
  return JSON.stringify(canonical(first)) === JSON.stringify(canonical(next));
}
