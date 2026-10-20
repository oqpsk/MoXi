const blockTags = new Set(['P','H1','H2','H3','H4','H5','H6','PRE','LI','TD','TH','BLOCKQUOTE']);

export function literalMatches(text, query) {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...text.matchAll(new RegExp(escaped, 'giu'))].map(m => ({ start: m.index, end: m.index + m[0].length }));
}

function documentText(root) {
  let text = ''; const segments = [];
  function newline() { if (text && !text.endsWith('\n')) text += '\n'; }
  function visit(node) {
    if (node.nodeType === 3) {
      if (node.data) { const start = text.length; text += node.data; segments.push({ node, start, end: text.length }); }
      return;
    }
    if (node.nodeType !== 1 || ['SCRIPT','STYLE'].includes(node.tagName) || node.getAttribute('aria-hidden') === 'true') return;
    if (node.tagName === 'BR') { newline(); return; }
    const block = blockTags.has(node.tagName); if (block) newline();
    for (const child of node.childNodes) visit(child);
    if (block) newline();
  }
  visit(root); return { text, segments };
}

export function createSearch({ bar, input, result, scroll, source, mirror, getView, restoreFocus }) {
  let matches = [], ranges = [], active = -1, query = '';
  const registry = globalThis.CSS?.highlights;
  function clearPaint() {
    registry?.delete('moxi-matches'); registry?.delete('moxi-current');
    document.body.classList.remove('source-search'); mirror.replaceChildren();
  }
  function paint() {
    if (!registry || !globalThis.Highlight) return;
    const all = new Highlight(); for (const range of ranges) all.add(range);
    registry.set('moxi-matches', all);
    const current = new Highlight(); if (ranges[active]) current.add(ranges[active]);
    current.priority = 1; registry.set('moxi-current', current);
  }
  function jump() {
    const range = ranges[active]; if (!range?.getBoundingClientRect) return;
    const box = range.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
    if (!box.height) return;
    scroll.scrollTop = Math.max(0, scroll.scrollTop + box.top - viewport.top - scroll.clientHeight * .35);
  }
  function refresh({ reset = false, reveal = false } = {}) {
    clearPaint();
    if (bar.hidden) { matches = []; ranges = []; active = -1; return; }
    const changed = query !== input.value; query = input.value;
    const view = getView(); let model;
    if (view.kind === 'source') {
      mirror.textContent = source.value + '\u200b';
      const node = mirror.firstChild;
      model = { text: source.value, segments: [{ node, start: 0, end: source.value.length }] };
      if (query) document.body.classList.add('source-search');
    } else model = documentText(view.root);
    matches = literalMatches(model.text, query); ranges = [];
    let first = 0;
    for (const match of matches) {
      while (first < model.segments.length && model.segments[first].end <= match.start) first++;
      let last = first; while (last < model.segments.length && model.segments[last].end < match.end) last++;
      const a = model.segments[first], b = model.segments[last]; if (!a || !b) continue;
      const range = document.createRange(); range.setStart(a.node, match.start - a.start); range.setEnd(b.node, match.end - b.start); ranges.push(range);
    }
    active = !matches.length ? -1 : reset || changed || active < 0 ? 0 : Math.min(active, matches.length - 1);
    result.textContent = `${active + 1} / ${matches.length}`;
    paint(); if (reveal) jump();
  }
  function open() {
    bar.hidden = false; refresh({ reset: true }); input.focus({ preventScroll: true }); input.select();
  }
  function close() {
    bar.hidden = true; clearPaint(); matches = []; ranges = []; active = -1;
    restoreFocus();
  }
  function next(direction = 1) {
    if (query !== input.value) refresh({ reset: true });
    else if (matches.length) active = (active + direction + matches.length) % matches.length;
    result.textContent = `${active + 1} / ${matches.length}`;
    paint(); jump(); input.focus({ preventScroll: true });
  }
  input.addEventListener('input', () => refresh({ reset: true, reveal: true }));
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); next(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  bar.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  return { open, close, next, refresh, state: () => ({ query, total: matches.length, active, ranges: ranges.length }) };
}
