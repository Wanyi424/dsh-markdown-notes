import { readFile, writeFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await writeFile(new URL('../src/version.ts', import.meta.url), `// Generated from package.json.\nexport const PLUGIN_VERSION = ${JSON.stringify(manifest.version)};\n`);
const sample = await readFile(new URL('../src/assets/sample.md', import.meta.url), 'utf8');
await writeFile(new URL('../src/sample.ts', import.meta.url),
  `// Exact copy of src/assets/sample.md; regenerate with node scripts/build-sample.mjs.\nexport const SAMPLE_CONTENT = ${JSON.stringify(sample)};\n`);
const iconSet = JSON.parse(await readFile(new URL('../node_modules/@iconify-json/mdi/icons.json', import.meta.url), 'utf8'));
const icons = Object.fromEntries(['rocket-launch', 'progress-check', 'account-sync', 'account-group'].map(name => [name,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iconSet.width} ${iconSet.height}">${iconSet.icons[name].body}</svg>`]));
await writeFile(new URL('../src/infographic-icons.ts', import.meta.url), `// Material Design Icons, Apache-2.0; bundled for offline rendering.\nexport const infographicIcons: Record<string, string> = ${JSON.stringify(icons)};\n`);
let css = await readFile(new URL('../node_modules/katex/dist/katex.min.css', import.meta.url), 'utf8');
for (const match of [...css.matchAll(/src:([^;}]+)/g)]) {
  const path = /url\(["']?([^)'" ]+\.woff2)["']?\)/.exec(match[1]);
  if (!path) continue;
  const bytes = await readFile(new URL('../node_modules/katex/dist/' + path[1], import.meta.url));
  css = css.replace(match[0], `src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2")`);
}
await writeFile(new URL('../src/katex-style.ts', import.meta.url), `// KaTeX MIT; CSS and fonts bundled for offline rendering.\nexport default ${JSON.stringify(css)};\n`);
