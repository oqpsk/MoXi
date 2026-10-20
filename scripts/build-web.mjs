import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('Moxi.App/Web', { recursive: true });
const result = await build({ entryPoints: ['web/editor.js'], bundle: true, minify: true, format: 'iife', target: 'chrome120', outfile: 'Moxi.App/Web/editor.js', legalComments: 'eof', metafile: true });
await copyFile('web/index.html', 'Moxi.App/Web/index.html');
await copyFile('web/editor.css', 'Moxi.App/Web/editor.css');
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.startsWith('node_modules/')) continue;
  const parts = input.split('/'); const count = parts[1].startsWith('@') ? 3 : 2;
  const folder = parts.slice(0,count).join('/');
  if (packages.has(folder)) continue;
  const pkg = JSON.parse(await readFile(path.join(folder,'package.json'),'utf8'));
  const names = await readdir(folder);
  const license = names.find(n => /^licen[sc]e(?:\.md|\.txt)?$/i.test(n));
  if (!license) throw new Error(`Missing license for ${pkg.name}`);
  packages.set(folder,`${pkg.name} ${pkg.version} (${pkg.license})\n${await readFile(path.join(folder,license),'utf8')}`);
}
let notices = 'MoXi third-party notices\n\nLocally bundled editor components:\n\n' + [...packages.values()].join('\n\n'+'='.repeat(72)+'\n\n');
notices += '\n\n'+'='.repeat(72)+'\nLeXi native Windows chrome and backdrop implementation\n' + await readFile('licenses/LeXi-LICENSE.txt','utf8');
notices += '\n\n'+'='.repeat(72)+'\nMicrosoft.Web.WebView2 1.0.4258.31\n' + await readFile('licenses/WebView2-LICENSE.txt','utf8');
notices += '\n' + await readFile('licenses/WebView2-NOTICE.txt','utf8');
await writeFile('THIRD_PARTY_NOTICES.txt',notices);
console.log('Local editor bundle ready.');
