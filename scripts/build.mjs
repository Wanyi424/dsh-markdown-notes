import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import './build-sample.mjs';

await mkdir('dist', { recursive: true });
const host = await build({ entryPoints: ['src/host.ts'], outfile: 'lib/host.js', bundle: true, platform: 'node', target: 'node22', format: 'esm', metafile: true });
const chunks = [
  ['src/client.tsx', 'client.js'], ['src/page.tsx', 'client.page.js'],
  ['src/editor.tsx', 'client.editor.js'], ['src/preview.tsx', 'client.preview.js'],
  ['src/mermaid-chunk.ts', 'client.mermaid.js'], ['src/infographic-chunk.ts', 'client.infographic.js'],
];
const clients = await Promise.all(chunks.map(([entry, file]) => build({
  entryPoints: [entry], outfile: `lib/${file}`, bundle: true,
  platform: 'browser', target: 'chrome130', format: 'cjs', jsx: 'transform', minify: true, metafile: true,
  external: ['react', 'react/jsx-runtime', 'react-dom'], loader: { '.css': 'text' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(file === 'client.js' ? 'dsh-markdown-notes' : 'dsh-markdown-notes/' + file)}, factory(require) { const module = { exports: {} }; const exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  define: { 'process.env.NODE_ENV': '"production"' },
})));
const roots = new Set(['node_modules/katex', 'node_modules/@iconify-json/mdi']);
for (const path of [host, ...clients].flatMap(result => Object.keys(result.metafile.inputs))) {
  const match = /^(node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(path);
  if (match) roots.add(match[1]);
}
const notices = [];
for (const root of [...roots].sort()) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const licenses = (await readdir(root)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
  const text = await Promise.all(licenses.map(name => readFile(join(root, name), 'utf8').catch(() => '')));
  notices.push(`${pkg.name}@${pkg.version}\nLicense: ${pkg.license ?? 'See upstream package'}\n${text.join('\n')}`);
}
notices.push('Material Design Icons: Copyright Pictogrammers. Apache-2.0. Four bundled icons: rocket-launch, progress-check, account-sync, account-group.\nhttps://github.com/Templarian/MaterialDesign/blob/master/LICENSE');
await writeFile('lib/THIRD_PARTY_NOTICES.txt', notices.join('\n\n' + '='.repeat(72) + '\n\n'));
console.log('Built lib/host.js and lib/client.js');
