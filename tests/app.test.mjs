import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
const html=await readFile(new URL('../Moxi.App/Web/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../Moxi.App/Web/editor.js',import.meta.url),'utf8');
function app() {
 const errors=[],messages=[]; let receive;
 const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'https://app.moxi.local/index.html',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window;
 w.CSS={highlights:new Map()}; w.Highlight=class extends Set {};
 w.chrome={webview:{postMessage:m=>messages.push(m),addEventListener:(type,fn)=>{receive=fn;}}};
 w.matchMedia=()=>({matches:true}); w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.Range.prototype.getClientRects=()=>[]; w.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
 w.eval(script);
 return {w,errors,messages,send:data=>receive({data}),close:()=>{w.moxi.editor.destroy();w.close();}};
}
test('full application starts and sends ready without JavaScript errors',()=>{const a=app(); assert.equal(a.messages[0].type,'ready'); assert.deepEqual(a.errors,[]); a.close();});
test('file opens default to read-only focus; the logo enters editing before switching source',()=>{
 const a=app(),d=a.w.document,text='# Read first\r\n\r\n__Exact bytes__\r\n';
 a.send({type:'load',docId:'reading',text,name:'read.md',eol:'\r\n'});
 assert.equal(d.body.classList.contains('focus'),true); assert.equal(a.w.moxi.editor.isEditable,false);
 assert.equal(d.getElementById('preview').hidden,false); assert.equal(d.activeElement,d.getElementById('preview'));
 assert.equal(a.messages.at(-1).focus,true); assert.equal(d.body.classList.contains('dirty'),false);
 a.send({type:'action',docId:'reading',action:'toggle-mode'});
 assert.equal(d.body.classList.contains('focus'),false); assert.equal(a.w.moxi.getMode(),'edit'); assert.equal(a.w.moxi.editor.isEditable,true);
 a.send({type:'action',docId:'reading',action:'toggle-mode'}); assert.equal(a.w.moxi.getMode(),'source');
 a.send({type:'load',docId:'next',text,name:'next.md',eol:'\r\n'});
 assert.equal(d.body.classList.contains('focus'),true); assert.equal(a.w.moxi.getText(),text);
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(a.w.moxi.editor.isEditable,true); assert.equal(a.w.moxi.getText(),text); assert.deepEqual(a.errors,[]); a.close();
});
test('new untitled documents can opt into editing immediately',()=>{
 const a=app(),d=a.w.document;
 a.send({type:'load',docId:'file',text:'# Read',name:'file.md'});
 a.send({type:'load',docId:'new',text:'',name:'Untitled.md',focus:false});
 assert.equal(d.body.classList.contains('focus'),false); assert.equal(a.w.moxi.editor.isEditable,true);
 a.w.moxi.editor.commands.insertContent('Draft'); assert.equal(a.w.moxi.getText(),'Draft');
 assert.equal(d.body.classList.contains('dirty'),true); assert.equal(a.messages.at(-1).focus,false); assert.deepEqual(a.errors,[]); a.close();
});
test('source-only files open as clean previews and return to source without losing syntax',()=>{
 const a=app(),d=a.w.document,text='---\ntitle: keep\n---\n\n# Heading\n\n<!-- preserve -->\n';
 a.send({type:'load',docId:'special-preview',text,name:'special.md',eol:'\n'});
 assert.equal(d.body.classList.contains('focus'),true); assert.equal(d.getElementById('preview').hidden,false);
 assert.equal(d.getElementById('notice').hidden,true); assert.equal(a.w.moxi.getMode(),'source');
 a.send({type:'action',docId:'special-preview',action:'toggle-mode'});
 assert.equal(d.body.classList.contains('focus'),false); assert.equal(d.getElementById('source').hidden,false);
 assert.equal(d.getElementById('notice').hidden,false); assert.equal(a.w.moxi.getText(),text);
 assert.equal(d.body.classList.contains('dirty'),false); assert.deepEqual(a.errors,[]); a.close();
});
test('native glass and opaque fallback can switch without touching document contents',()=>{
 const a=app(); a.send({type:'load',focus:false,docId:'A',text:'# Untouched\n\nText\n',name:'x.md'});
 a.send({type:'appearance',glass:true}); assert.equal(a.w.document.documentElement.classList.contains('glass'),true);
 a.send({type:'appearance',glass:false}); assert.equal(a.w.document.documentElement.classList.contains('glass'),false);
 assert.equal(a.w.moxi.getText(),'# Untouched\n\nText\n'); assert.equal(!a.w.document.body.classList.contains('dirty'),true); a.close();
});
test('day/dark switching preserves unsaved edits, selection and source mode',()=>{
 const a=app(); a.send({type:'appearance',theme:'dark',glass:true});
 a.send({type:'load',focus:false,docId:'theme-doc',text:'Original\r\n',name:'x.md',eol:'\r\n'});
 a.w.moxi.setMode('source'); const source=a.w.document.getElementById('source');
 source.value='Latest edit\n'; source.dispatchEvent(new a.w.Event('input')); source.setSelectionRange(2,6);
 const before=a.w.moxi.getText(), count=a.messages.length;
 a.send({type:'appearance',theme:'day',glass:true});
 assert.equal(a.w.document.documentElement.dataset.theme,'day');
 assert.equal(a.w.moxi.getText(),before); assert.equal(a.w.moxi.getMode(),'source');
 assert.equal(source.selectionStart,2); assert.equal(source.selectionEnd,6);
 assert.equal(!a.w.document.body.classList.contains('dirty'),false); assert.equal(a.messages.length,count);
 a.send({type:'appearance',theme:'dark',glass:false});
 assert.equal(a.w.document.documentElement.dataset.theme,'dark'); assert.equal(a.w.document.documentElement.classList.contains('glass'),false);
 assert.equal(a.w.moxi.getText(),before); assert.deepEqual(a.errors,[]); a.close();
});
test('native title controls and keyboard shortcuts share state without changing the document',()=>{
 const a=app(), d=a.w.document;
 a.send({type:'load',focus:false,docId:'controls',text:'# Heading\n\nHello\n',name:'x.md',eol:'\n'});
 a.w.moxi.editor.commands.setTextSelection({from:12,to:14}); const selection=a.w.moxi.editor.state.selection;
 a.send({type:'action',docId:'stale',action:'focus'}); assert.equal(d.body.classList.contains('focus'),false);
 a.send({type:'action',docId:'controls',action:'focus'}); assert.equal(d.body.classList.contains('focus'),true);
 assert.equal(a.messages.at(-1).type,'view-state'); assert.equal(a.messages.at(-1).focus,true);
 a.send({type:'action',docId:'controls',action:'outline'});
 assert.equal(d.body.classList.contains('focus'),false); assert.equal(d.getElementById('outline').hidden,false);
 assert.equal(a.messages.at(-1).outline,true); assert.equal(a.messages.at(-1).docId,'controls');
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'o',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));
 assert.equal(d.getElementById('outline').hidden,true); assert.equal(a.messages.at(-1).outline,false);
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'F11',bubbles:true,cancelable:true}));
 assert.equal(a.messages.at(-1).focus,true);
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
 assert.equal(d.getElementById('find-bar').hidden,false);
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(d.getElementById('find-bar').hidden,true); assert.equal(d.body.classList.contains('focus'),true);
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(a.messages.at(-1).focus,false);
 assert.equal(a.w.moxi.getText(),'# Heading\n\nHello\n'); assert.equal(!d.body.classList.contains('dirty'),true);
 assert.equal(a.w.moxi.editor.state.selection.from,selection.from); assert.equal(a.w.moxi.editor.state.selection.to,selection.to);
 assert.deepEqual(a.errors,[]); a.close();
});
test('the complete bundled guide opens as rich editable Markdown with all sample structures',async()=>{
 const text=await readFile(new URL('../Welcome.md',import.meta.url),'utf8'); const a=app();
 a.send({type:'load',focus:false,docId:'guide',text,name:'Guide.md',eol:'\n'});
 assert.equal(a.w.moxi.getMode(),'edit');
 for(const selector of ['h1','h2','h3','h4','h5','h6','strong','em','s','code','blockquote blockquote','ol','ul[data-type="taskList"]','table','pre','img','a','hr']) assert.ok(a.w.document.querySelector('.tiptap '+selector),selector);
 assert.equal(a.w.moxi.getText(),text); assert.equal(a.w.document.querySelectorAll('.tiptap table').length,2); assert.deepEqual(a.errors,[]); a.close();
});
test('the complete guide remains renderable in focus after the editor registers list extensions',async()=>{
 const a=app(),text=await readFile(new URL('../Welcome.md',import.meta.url),'utf8');
 a.send({type:'load',focus:false,docId:'guide-focus',text,name:'Guide.md',eol:'\n'});
 a.send({type:'action',docId:'guide-focus',action:'focus'});
 const preview=a.w.document.getElementById('preview'); assert.equal(preview.hidden,false);
 for(const selector of ['h1','h6','table','pre','img','ul']) assert.ok(preview.querySelector(selector),selector);
 assert.equal(preview.querySelectorAll('table').length,2); assert.equal(a.w.moxi.editor.isEditable,false);
 const boxes=[...preview.querySelectorAll('input[type=checkbox]')]; assert.equal(boxes.length,5);
 assert.equal(boxes.filter(b=>b.checked).length,2); assert.ok(boxes.every(b=>b.disabled));
 assert.equal(a.w.moxi.getText(),text); assert.equal(!a.w.document.body.classList.contains('dirty'),true);
 assert.deepEqual(a.errors,[]); a.close();
});
test('opening and switching modes does not modify original Markdown',()=>{
 const a=app(),text='# 标题\r\n\r\n__粗体__  \r\n下一行\r\n';
 a.send({type:'load',focus:false,docId:'A',text,name:'exact.md',eol:'\r\n'});
 for(const mode of ['source','edit','source','edit'])a.w.moxi.setMode(mode);
 assert.equal(a.w.moxi.getText(),text); assert.equal(!a.w.document.body.classList.contains('dirty'),true);
 a.send({type:'snapshot',requestId:'snap'}); const s=a.messages.at(-1); assert.equal(s.text,text); assert.equal(s.docId,'A'); assert.equal(s.requestId,'snap'); assert.deepEqual(a.errors,[]); a.close();
});
test('editing rendered content produces Markdown and saved acknowledgement clears dirty state',()=>{
 const a=app(); a.send({type:'load',focus:false,docId:'A',text:'# Start\n\nHello\n',name:'x.md',eol:'\n'});
 a.w.moxi.editor.commands.insertContentAt(a.w.moxi.editor.state.doc.content.size,' 中文');
 const text=a.w.moxi.getText(); assert.match(text,/中文/); assert.equal(!a.w.document.body.classList.contains('dirty'),false);
 a.send({type:'saved',docId:'stale',text,name:'bad.md'}); assert.equal(!a.w.document.body.classList.contains('dirty'),false);
 a.send({type:'saved',docId:'A',text,name:'saved.md',path:'saved.md'}); assert.equal(!a.w.document.body.classList.contains('dirty'),true); assert.deepEqual(a.errors,[]); a.close();
});
test('opening another file resets undo history',()=>{
 const a=app(); a.send({type:'load',focus:false,docId:'A',text:'Private old document',name:'old.md'}); a.w.moxi.editor.commands.insertContent('edit');
 a.send({type:'load',focus:false,docId:'B',text:'# New file',name:'new.md'}); assert.equal(a.w.moxi.editor.can().undo(),false); a.w.moxi.editor.commands.undo(); assert.equal(a.w.moxi.getText(),'# New file'); assert.deepEqual(a.errors,[]); a.close();
});
test('unsupported Markdown opens as source and focus preview preserves all syntax',()=>{
 const a=app(),text='---\ntitle: secret\n---\n\n# Title\n\n<!-- keep this -->\n\nText';
 a.send({type:'load',focus:false,docId:'A',text,name:'special.md',eol:'\n'}); assert.equal(a.w.moxi.getMode(),'source');
 a.w.moxi.setMode('edit'); assert.equal(a.w.moxi.getMode(),'source'); const source=a.w.document.getElementById('source'); source.value+='\nMore'; source.dispatchEvent(new a.w.Event('input'));
 a.send({type:'action',docId:'A',action:'focus'}); assert.equal(a.w.document.getElementById('preview').hidden,false);
 assert.equal(a.w.moxi.getText(),text+'\nMore'); assert.deepEqual(a.errors,[]); a.close();
});
test('logo actions switch only edit/source; focus is read-only and restores source selection',()=>{
 const a=app(), d=a.w.document;
 a.send({type:'load',focus:false,docId:'logo',text:'# Title\r\n\r\n__exact__\r\n',name:'x.md',eol:'\r\n'});
 a.send({type:'action',docId:'logo',action:'toggle-mode'}); assert.equal(a.w.moxi.getMode(),'source');
 assert.equal(a.messages.at(-1).mode,'source');
 const source=d.getElementById('source'); source.value+='Latest edit'; source.dispatchEvent(new a.w.Event('input')); source.setSelectionRange(2,7);
 const raw=a.w.moxi.getText();
 a.send({type:'action',docId:'logo',action:'focus'});
 assert.equal(d.getElementById('preview').hidden,false); assert.equal(source.hidden,true); assert.equal(a.w.moxi.editor.isEditable,false);
 assert.match(d.getElementById('preview').textContent,/Latest edit/);
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(a.w.moxi.getMode(),'source'); assert.equal(source.selectionStart,2); assert.equal(source.selectionEnd,7);
 source.setSelectionRange(1,4); d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(source.selectionStart,1); assert.equal(source.selectionEnd,4);
 a.send({type:'action',docId:'logo',action:'toggle-mode'}); assert.equal(a.w.moxi.getMode(),'edit');
 assert.equal(a.w.moxi.getText(),raw); assert.equal(a.w.moxi.editor.isEditable,true);
 a.send({type:'action',docId:'logo',action:'focus'}); assert.equal(a.w.moxi.editor.isEditable,false);
 a.send({type:'action',docId:'logo',action:'toggle-mode'});
 assert.equal(d.body.classList.contains('focus'),false); assert.equal(a.w.moxi.getMode(),'edit');
 a.send({type:'action',docId:'logo',action:'zoom-in'}); assert.equal(a.messages.at(-1).zoom,110);
 assert.equal(a.w.moxi.getText(),raw); assert.equal(!d.body.classList.contains('dirty'),false); assert.deepEqual(a.errors,[]); a.close();
});
test('Ctrl+S posts the current text immediately, including during typing debounce',()=>{
 const a=app(); a.send({type:'load',focus:false,docId:'A',text:'Hello',name:'x.md'}); a.w.moxi.editor.commands.insertContent('Latest ');
 a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}));
 const msg=a.messages.at(-1); assert.equal(msg.action,'save'); assert.match(msg.text,/Latest/); assert.deepEqual(a.errors,[]); a.close();
});
test('find highlights every rich match across inline marks and Enter never edits or moves focus',()=>{
 const a=app(),d=a.w.document,text='Alpha **beta** alpha\n\nALPHA beta\n';
 a.send({type:'load',focus:false,docId:'search',text,name:'x.md',eol:'\n'});
 const before=a.w.moxi.editor.state.selection.from;
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
 const input=d.getElementById('find-input'); input.value='alpha';input.dispatchEvent(new a.w.Event('input'));
 assert.equal(a.w.moxi.searchState().total,3);assert.equal(a.w.CSS.highlights.get('moxi-matches').size,3);
 for(let i=0;i<5;i++){
  const enter=new a.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}); input.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented,true);assert.equal(d.activeElement,input);
 }
 assert.equal(a.w.moxi.searchState().active,2); assert.equal(a.w.moxi.getText(),text);
 assert.equal(a.w.moxi.editor.state.selection.from,before);assert.equal(d.body.classList.contains('dirty'),false);
 input.value='alpha beta';input.dispatchEvent(new a.w.Event('input'));
 assert.equal(a.w.moxi.searchState().total,2);assert.equal([...a.w.CSS.highlights.get('moxi-matches')][0].toString(),'Alpha beta');
 input.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(a.w.CSS.highlights.has('moxi-matches'),false);assert.equal(d.getElementById('find-bar').hidden,true);assert.deepEqual(a.errors,[]);a.close();
});
test('source and focus find share complete highlights without changing text or closing focus on Escape',()=>{
 const a=app(),d=a.w.document,text='One **one**\n\nOne\n';
 a.send({type:'load',focus:false,docId:'search-source',text,name:'x.md',eol:'\n'});
 a.send({type:'action',docId:'search-source',action:'toggle-mode'});
 d.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
 const input=d.getElementById('find-input');input.value='one';input.dispatchEvent(new a.w.Event('input'));
 assert.equal(a.w.moxi.searchState().total,3);assert.equal(a.w.CSS.highlights.get('moxi-matches').size,3);
 assert.equal(d.body.classList.contains('source-search'),true);
 input.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));
 assert.equal(a.w.moxi.searchState().active,2);assert.equal(d.activeElement,input);assert.equal(a.w.moxi.getText(),text);
 a.send({type:'action',docId:'search-source',action:'focus'});assert.equal(a.w.moxi.searchState().total,3);
 input.focus();input.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(d.body.classList.contains('focus'),true);assert.equal(a.w.moxi.getText(),text);assert.deepEqual(a.errors,[]);a.close();
});
