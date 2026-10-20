import { createSearch } from './search.js';
import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { extensions, unsupportedReason, safePreview, lineEndings, countCharacters, roundTripSafe } from './editor-core.js';

const $ = id => document.getElementById(id);
let raw = '', original = '', initialJson = '', saved = '', docId = '', eol = '\r\n', mode = 'edit', reason = '', zoom = 100;
let suppress = false, changeTimer, outlineTimer, search;
let focusScroll = 0, sourceSelection = [0, 0];
const native = window.chrome?.webview;
function post(message) { native?.postMessage({ ...message, docId }); }
function snapshot() { clearTimeout(changeTimer); return raw; }
function publish() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => post({ type: 'changed', text: raw }), 100);
  updateLocal(); search?.refresh();
}
const editor = new Editor({
  element: $('editor'), extensions: extensions(), content: '', contentType: 'markdown',
  editorProps: {
    attributes: { 'aria-label': 'Markdown 正文，所见即所得编辑', spellcheck: 'false' },
    handleDrop: () => true, // File paths are handled by the native host; do not embed dropped file data.
    handlePaste(view, event) {
      const text = event.clipboardData?.getData('text/plain');
      if (text && /(^|\n)(#{1,6} |```|\|.+\||- \[[ x]\])/.test(text)) {
        // Paste complex Markdown as source if it cannot be represented losslessly.
        if (unsupportedReason(text)) {
          event.preventDefault(); setMode('source');
          $('source').setRangeText(text, $('source').selectionStart, $('source').selectionEnd, 'end');
          sourceChanged(); return true;
        }
      }
      return false;
    },
  },
  onUpdate() {
    if (suppress) return;
    raw = JSON.stringify(editor.getJSON()) === initialJson ? original : lineEndings(editor.getMarkdown(), eol);
    if (raw && /(?:\r\n|\r|\n)$/.test(original) && !/(?:\r\n|\r|\n)$/.test(raw)) raw += eol;
    publish();
  },
  onSelectionUpdate: () => updateFormat(),
});

function setRichText() {
  suppress = true;
  try { editor.commands.setContent(raw, { contentType: 'markdown', emitUpdate: false }); }
  finally { suppress = false; }
  original = raw; initialJson = JSON.stringify(editor.getJSON());
}

function inspect() {
  reason = unsupportedReason(raw);
  if (!reason && !roundTripSafe(editor, raw)) reason = '无法完整保存回 Markdown 的结构';
  $('notice').textContent = reason ? `这份文档包含${reason}。当前用源码编辑以保留内容；专注可只读预览。` : '';
  $('notice').hidden = !reason;
}

function renderMode() {
  const focused = document.body.classList.contains('focus');
  $('notice').hidden = focused || !reason;
  document.body.classList.toggle('source', mode === 'source');
  $('source').hidden = focused || mode !== 'source'; $('source-wrap').hidden = $('source').hidden;
  $('editor').hidden = focused || mode !== 'edit';
  $('preview').hidden = !focused;
  if (focused) $('preview').innerHTML = safePreview(raw);
  else if (mode === 'source') { $('source').value = raw; resizeSource(); }
  editor.setEditable(mode === 'edit' && !focused, false);
  updateFormat(); updateOutline(); updateLocal(); search?.refresh();
}

function setMode(next) {
  if (!['edit', 'source'].includes(next)) return;
  inspect();
  if (next === 'edit' && reason) next = 'source';
  if (mode === 'source' && next === 'edit') setRichText();
  mode = next;
  renderMode();
}

function load(data) {
  clearTimeout(changeTimer); docId = data.docId; raw = data.text; original = raw; saved = data.savedText ?? raw; eol = data.eol ?? '\r\n';
  focusScroll = 0; sourceSelection = [0, 0];
  document.body.classList.toggle('focus', data.focus !== false);
  // Only image elements can access the document origin; no arbitrary local navigation.
  setRichText();
  // A new file starts its own undo history; Ctrl+Z must never restore another document.
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }));
  inspect(); setMode(reason ? 'source' : 'edit');
  $('scroll').scrollTop = 0; updateLocal(); publishViewState();
  if (document.body.classList.contains('focus')) $('preview').focus({ preventScroll: true });
  else if (mode === 'edit') editor.commands.focus('start', { scrollIntoView: false });
}

function updateLocal() {
  const dirty = raw !== saved;
  document.body.classList.toggle('dirty', dirty);
  publishViewState();
  clearTimeout(outlineTimer); outlineTimer = setTimeout(updateOutline, 350);
}
function resizeSource() { const s = $('source'); s.style.height = 'auto'; s.style.height = `${s.scrollHeight + 40}px`; }
function sourceChanged() { raw = lineEndings($('source').value, eol); resizeSource(); publish(); }
$('source').addEventListener('input', sourceChanged);
$('source').addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('source').setRangeText('  ', $('source').selectionStart, $('source').selectionEnd, 'end'); sourceChanged(); }
});

function updateOutline() {
  if ($('outline').hidden) return;
  const nav = $('outline-items'); nav.replaceChildren();
  let headings = [];
  if (mode === 'source' && !document.body.classList.contains('focus')) {
    let inFence = false, offset = 0;
    for (const line of raw.split(/\r\n|\n|\r/)) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      const match = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) headings.push({ level: match[1].length, text: match[2], offset });
      offset += line.length + eol.length;
    }
  } else {
    const parent = document.body.classList.contains('focus') ? $('preview') : $('editor');
    headings = [...parent.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(el => ({ level: +el.tagName[1], text: el.textContent, el }));
  }
  for (const h of headings) {
    const b = document.createElement('button'); b.textContent = h.text; b.style.paddingLeft = `${12 + (h.level - 1) * 11}px`;
    b.onclick = () => {
      if (h.el) h.el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      else { const i = lineEndings(raw.slice(0, h.offset), '\n').length; $('source').focus(); $('source').setSelectionRange(i, i); $('scroll').scrollTop = raw.slice(0, h.offset).split(/\r\n|\n|\r/).length * 28; }
    };
    nav.append(b);
  }
  if (!headings.length) { const p = document.createElement('p'); p.className = 'empty-outline'; p.textContent = '文档还没有标题'; nav.append(p); }
}

function updateFormat() {
  document.querySelectorAll('[data-format]').forEach(b => {
    const type = b.dataset.format;
    b.classList.toggle('active', editor.isActive(type));
    if (type === 'undo') b.disabled = !editor.can().undo();
    if (type === 'redo') b.disabled = !editor.can().redo();
  });
  let level = 0; for (let i = 1; i <= 6; i++) if (editor.isActive('heading', { level: i })) level = i;
  $('block').value = String(level);
}

const toggleCommands = { bold: 'toggleBold', italic: 'toggleItalic', strike: 'toggleStrike', code: 'toggleCode', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', taskList: 'toggleTaskList', blockquote: 'toggleBlockquote', codeBlock: 'toggleCodeBlock', horizontalRule: 'setHorizontalRule', undo: 'undo', redo: 'redo' };
function format(type) {
  if (mode !== 'edit') return;
  if (type === 'link') {
    $('link-url').value = editor.getAttributes('link').href ?? '';
    $('link-dialog').showModal(); $('link-url').focus(); return;
  }
  if (type === 'table') { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); return; }
  editor.chain().focus()[toggleCommands[type]]().run(); updateFormat();
}
$('block').onchange = () => { const level = +$('block').value; if (level) editor.chain().focus().setHeading({ level }).run(); else editor.chain().focus().setParagraph().run(); };
$('link-dialog').addEventListener('close', () => {
  if ($('link-dialog').returnValue !== 'ok') return;
  const href = $('link-url').value.trim();
  if (href && /^(?:javascript|data|file|vbscript):/i.test(href)) { status('不支持此链接类型'); return; }
  if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run();
  else if (editor.state.selection.empty) editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
  else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
});

function status(text) { post({ type: 'editor-status', message: text }); }
function changeZoom(value) { zoom = Math.min(180, Math.max(70, value)); document.documentElement.style.setProperty('--font-size', `${18 * zoom / 100}px`); document.documentElement.style.setProperty('--source-size', `${15 * zoom / 100}px`); resizeSource(); publishViewState(); }
search = createSearch({
  bar: $('find-bar'), input: $('find-input'), result: $('find-result'), scroll: $('scroll'), source: $('source'), mirror: $('source-render'),
  getView: () => mode === 'source' && !document.body.classList.contains('focus') ? { kind: 'source' } :
    { kind: 'document', root: document.body.classList.contains('focus') ? $('preview') : editor.view.dom },
  restoreFocus: () => {
    if (mode === 'source' && !document.body.classList.contains('focus')) $('source').focus({ preventScroll: true });
    else if (!document.body.classList.contains('focus')) editor.commands.focus(undefined, { scrollIntoView: false });
    else $('preview').focus({ preventScroll: true });
  },
});

function appearance(data) {
  document.documentElement.dataset.theme = data.theme === 'day' ? 'day' : 'dark';
  document.documentElement.classList.toggle('glass', !!data.glass);
}
function publishViewState() {
  post({ type: 'view-state', focus: document.body.classList.contains('focus'), outline: !$('outline').hidden && !document.body.classList.contains('focus'),
    mode, dirty: raw !== saved, count: countCharacters(mode === 'source' ? raw : editor.getText()), zoom });
}
function focusMode(on) {
  const wasFocused = document.body.classList.contains('focus');
  if (on === wasFocused) { publishViewState(); return; }
  if (on && !wasFocused) { focusScroll = $('scroll').scrollTop; sourceSelection = [$('source').selectionStart, $('source').selectionEnd]; }
  document.body.classList.toggle('focus', on);
  inspect(); renderMode();
  if (!on && wasFocused) {
    $('scroll').scrollTop = focusScroll;
    if (mode === 'source') { $('source').focus(); $('source').setSelectionRange(...sourceSelection); }
    else editor.commands.focus(undefined, { scrollIntoView: false });
  }
}
if (!native) appearance({ theme: 'dark', glass: false });

function action(name) {
  switch (name) {
    case 'outline':
      if (document.body.classList.contains('focus')) { focusMode(false); $('outline').hidden = false; }
      else $('outline').hidden = !$('outline').hidden;
      updateOutline(); publishViewState(); break;
    case 'find': search.open(); break;
    case 'find-next': search.next(); break;
    case 'find-prev': search.next(-1); break;
    case 'find-close': search.close(); break;
    case 'toggle-mode':
      if (document.body.classList.contains('focus')) focusMode(false);
      else setMode(mode === 'source' ? 'edit' : 'source');
      break;
    case 'focus': focusMode(!document.body.classList.contains('focus')); break;
    case 'zoom-in': changeZoom(zoom + 10); break;
    case 'zoom-out': changeZoom(zoom - 10); break;
    case 'zoom-reset': changeZoom(100); break;
    default: post({ type: 'command', action: name, text: snapshot() }); break;
  }
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]'); if (a) { action(a.dataset.action); return; }
  const f = e.target.closest('[data-format]'); if (f) { format(f.dataset.format); return; }
  const table = e.target.closest('[data-table]'); if (table) { editor.chain().focus()[table.dataset.table]().run(); $('table-menu').hidden = true; return; }
  if (!e.target.closest('.popover')) { $('table-menu').hidden = true; }
  const link = e.target.closest('a');
  if (link) {
    e.preventDefault();
    if (document.body.classList.contains('focus') || e.ctrlKey) {
      const href = link.getAttribute('href');
      if (href?.startsWith('#')) {
        const slug = s => s.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').trim().replace(/\s+/g,'-');
        const heading = [...document.querySelectorAll('#editor h1,#editor h2,#editor h3,#editor h4,#editor h5,#editor h6,#preview h1,#preview h2,#preview h3,#preview h4,#preview h5,#preview h6')].find(h => slug(h.textContent) === decodeURIComponent(href.slice(1)));
        heading?.scrollIntoView({ block:'start' });
      } else post({ type: 'link', href });
    }
  }
});
document.addEventListener('mousedown', e => { if (e.target.closest('[data-format]')) e.preventDefault(); });
document.addEventListener('contextmenu', e => {
  if (mode !== 'edit' || !e.target.closest('td,th')) return;
  e.preventDefault(); const p = $('table-menu'); p.hidden = false; p.style.left = `${Math.min(e.clientX, innerWidth - 265)}px`; p.style.top = `${Math.min(e.clientY, innerHeight - 215)}px`;
});
document.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape') { if (!$('find-bar').hidden) { search.close(); return; } $('table-menu').hidden = true; focusMode(false); return; }
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'F11') { e.preventDefault(); action('focus'); return; }
  if (!e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  const keys = { n: 'new', o: e.shiftKey ? 'outline' : 'open', s: e.shiftKey ? 'save-as' : 'save', f: 'find', q: 'close', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' };
  if (key === '/') { e.preventDefault(); action('toggle-mode'); return; }
  if (key === 'k' && mode === 'edit' && !document.body.classList.contains('focus')) { e.preventDefault(); format('link'); return; }
  if (keys[key]) { e.preventDefault(); action(keys[key]); }
});
// Prevent Chromium navigation and accidental data URLs from drops.
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files.length) native?.postMessageWithAdditionalObjects(
    { type: 'drop', docId, text: snapshot() }, e.dataTransfer.files);
});
native?.addEventListener('message', ({ data }) => {
  if (data.type === 'appearance') appearance(data);
  else if (data.type === 'action' && data.docId === docId && ['focus', 'outline', 'toggle-mode', 'zoom-in', 'zoom-out', 'zoom-reset'].includes(data.action)) action(data.action);
  else if (data.type === 'load') load(data);
  else if (data.type === 'snapshot') post({ type: 'snapshot', requestId: data.requestId, text: snapshot() });
  else if (data.type === 'saved' && data.docId === docId) { saved = data.text; updateLocal(); status('已保存'); }
  else if (data.type === 'status') status(data.text);
});
// Expose a narrow program-test interface, with no host filesystem access.
window.moxi = { editor, load, setMode, getText: () => raw, getMode: () => mode, searchState: () => search.state() };
post({ type: 'ready' });
