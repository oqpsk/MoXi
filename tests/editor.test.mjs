import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.moxi.local/' });
for (const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle']) Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0); globalThis.cancelAnimationFrame = clearTimeout;
const { Editor } = await import('@tiptap/core');
const { extensions, unsupportedReason, safePreview, lineEndings, imageSource, roundTripSafe } = await import('../web/editor-core.js');
function make(text) { return new Editor({ element: document.createElement('div'), extensions: extensions(), content: text, contentType: 'markdown' }); }
const samples = [
 '# Heading μ\n\nEnglish and 中文 **bold** *italic* ~~strike~~ `code`.',
 '> Quote\n>\n> second paragraph\n\n---\n',
 '1. One\n2. Two\n   - Nested item\n',
 '- [ ] Pending\n- [x] Done\n',
 '| Name | Value |\n| :--- | ---: |\n| 中文 | **42** |\n',
 '```js\nconst x = "<script>";\n```\n',
 '[Link](https://example.com/a?q=1 "Title") ![alt](assets/image.png "Caption")\n',
 'Hard line  \nbreak\n\nSecond paragraph\n',
];
for (const [i,text] of samples.entries()) test(`supported Markdown semantic round trip ${i+1}`,()=> { const e=make(text); assert.equal(unsupportedReason(text),''); assert.equal(roundTripSafe(e,text),true); assert.ok(e.getText().length); e.destroy(); });
test('rich edits serialize back to Markdown and undo restores content',()=> { const e=make('# Original\n\nHello'); const before=e.getJSON(); e.commands.insertContentAt(e.state.doc.content.size,' added'); assert.match(e.getMarkdown(),/added/); e.commands.undo(); assert.deepEqual(e.getJSON(),before); e.destroy(); });
test('table and tasks remain structural after serialization',()=> { const e=make(samples[3]+'\n'+samples[4]); const types=[]; e.state.doc.descendants(n=>types.push(n.type.name)); assert.ok(types.includes('taskItem')); assert.ok(types.includes('tableCell')); assert.match(e.getMarkdown(),/- \[x\]/); assert.match(e.getMarkdown(),/---:/); e.destroy(); });
test('source-only syntax is detected, including nested HTML',()=> { for (const s of ['---\ntitle: private\n---\n','# Title\n\n<!-- comment -->','[ref]: https://example.com\n\n[ref]','a[^note]\n\n[^note]: note','- item <kbd>x</kbd>']) assert.ok(unsupportedReason(s),s); });
test('HTML in fenced code does not force source mode',()=> assert.equal(unsupportedReason('```html\n<script>alert(1)</script>\n```'),''));
test('preview strips executable content and unsafe attributes',()=> { const html=safePreview('<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(1)">x</a><iframe src="https://x"></iframe>'); assert.doesNotMatch(html,/<script|onerror|javascript:|<iframe/i); });
test('preview allows only disabled task checkboxes among input controls',()=> { const html=safePreview('<input type="file"><input type="text"><ul><li><input type="checkbox" checked>task</li></ul>'); const host=document.createElement('div');host.innerHTML=html;const inputs=[...host.querySelectorAll('input')];assert.equal(inputs.length,1);assert.equal(inputs[0].type,'checkbox');assert.equal(inputs[0].disabled,true);assert.equal(inputs[0].checked,true); });
test('image URLs cannot read arbitrary paths or contact remote hosts',()=> { assert.equal(imageSource('assets/a b.png'),'https://document.moxi.local/assets/a%20b.png'); for(const s of ['../secret.png','https://tracker.example/x','file:///C:/x','data:image/svg+xml;base64,xx','//example/x']) assert.equal(imageSource(s),''); });
test('native EOL conversion preserves CRLF and CR',()=> { assert.equal(lineEndings('a\nb\r\nc\r','\r\n'),'a\r\nb\r\nc\r\n'); });
test('equivalent mark nesting stays editable while real structure loss stays protected',()=>{
 const e=make('');assert.equal(roundTripSafe(e,'[link](x.md) **[link](x.md)**'),true);
 assert.equal(roundTripSafe(e,'>\n>\n'),false);e.destroy();
});
