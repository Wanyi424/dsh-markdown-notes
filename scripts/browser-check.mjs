import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { apply, NotesSettings } from '../lib/host.js';
import assert from 'node:assert/strict';

const temporary = await mkdtemp(join(tmpdir(), 'dsh-notes-browser-'));
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
let browser;
let server;
try {
  await build({ entryPoints: ['tests/browser-entry.tsx'], outfile: join(temporary, 'entry.js'), bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  let api;
  const openedFolders = [];
  const settings = new NotesSettings(join(temporary, 'settings', 'settings.json'));
  await apply({ connection: { fetch: { register(route) { api = route.fetch; return () => {}; } } } }, { directory: join(temporary, 'notes') }, settings);
  const light = `--dsw-alias-label-primary:#20232a;--dsw-alias-label-secondary:#555f70;--dsw-alias-label-tertiary:#808898;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f6f7f8;--dsw-alias-bg-overlay:#fff;--dsw-alias-border-l2:#e7e8ec;--dsw-alias-border-l3:#cbd0da;--dsw-alias-button-primary-fill:#14161b;--dsw-alias-button-primary-hover:#30343e;--dsw-alias-interactive-bg-hover:#eceef2;--dsw-alias-interactive-bg-active:#e9ebee;--dsw-alias-button-elevated-fill:#fff;--dsw-alias-brand-primary:#5578b8;--dsw-alias-brand-text:#4166a3;--dsw-alias-link:#4a71b2;--dsw-alias-markdown-inline-code:#f1f3f6;--dsw-alias-markdown-code-block:#f7f8fa;--dsw-alias-markdown-code-block-banner:#f0f2f5;--dsw-alias-state-error-primary:#be4545;--dsw-alias-state-error-secondary:#edcccc;--dsw-alias-state-warn-primary:#dba82e;--dsw-alias-state-success-primary:#32977a;--dsw-alias-bg-multi-select:#ccdcf3;--dsw-alias-bg-mask-1:#00000012;--dsw-alias-bg-mask-2:#00000055;--dsh-frame-top-clearance:0px;`;
  const dark = `--dsw-alias-label-primary:#e2e5ec;--dsw-alias-label-secondary:#abb4c4;--dsw-alias-label-tertiary:#8791a4;--dsw-alias-label-primary-inverted:#16191f;--dsw-alias-bg-base:#191c22;--dsw-alias-bg-layer-1:#1f232b;--dsw-alias-bg-overlay:#262b35;--dsw-alias-border-l2:#343b48;--dsw-alias-border-l3:#485165;--dsw-alias-button-primary-fill:#e2e5ec;--dsw-alias-button-primary-hover:#fff;--dsw-alias-interactive-bg-hover:#303744;--dsw-alias-interactive-bg-active:#343b48;--dsw-alias-button-elevated-fill:#394150;--dsw-alias-markdown-inline-code:#2a303b;--dsw-alias-markdown-code-block:#20252e;--dsw-alias-markdown-code-block-banner:#272d38;--dsw-alias-link:#92b8f4;--dsw-alias-bg-multi-select:#344d70;`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{${light}}html[data-theme=dark]{${dark}}*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;font-family:'Segoe UI','Microsoft YaHei',sans-serif;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}.fixture-shell{height:100%;display:grid;grid-template-columns:280px minmax(0,1fr)}.fixture-nav{background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2);padding:32px 20px}.fixture-nav h2{font-size:22px;margin:0 0 34px}.fixture-nav div,.fixture-nav button{font-size:14px;padding:14px;border-radius:8px;margin-bottom:6px;display:block;background:transparent;border:0;color:inherit;cursor:pointer}.fixture-nav .active{background:var(--dsw-alias-interactive-bg-active)}.fixture-label{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:24px}#plugin{min-width:0;height:100%;overflow:hidden}@media(max-width:900px){.fixture-shell{grid-template-columns:minmax(0,1fr)}.fixture-nav{display:none}}</style></head><body><div class="fixture-shell"><aside class="fixture-nav"><h2>DSH</h2><button id="close-notes">工作台</button><div>插件</div><button id="open-notes" class="active">笔记</button><p class="fixture-label">隔离测试环境 · 非 DSH 实际窗口</p></aside><div id="plugin"></div></div><script src="/entry.js"></script><script src="/plugin.js"></script></body></html>`;
  const plugin = await readFile('lib/client.js');
  const entry = await readFile(join(temporary, 'entry.js'));
  server = createServer(async (req, res) => {
    try {
      if (req.url === '/open-in-app/open') {
        const chunks = []; for await (const part of req) chunks.push(part);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(body.app, 'explorer');
        assert.equal(body.path, await settings.directory(join(temporary, 'notes')));
        openedFolders.push(body.path);
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return;
      }
      if (req.url === '/api/markdown-notes') {
        const chunks = []; for await (const part of req) chunks.push(part);
        const response = await api(new Request('http://localhost/api/markdown-notes', { method: 'POST', body: Buffer.concat(chunks), headers: { 'content-type': 'application/json', ...(req.headers['x-dsh-notes-client-version'] ? { 'x-dsh-notes-client-version': req.headers['x-dsh-notes-client-version'] } : {}) } }));
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      res.writeHead(200, { 'content-type': req.url?.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
      res.end(req.url === '/entry.js' ? entry : req.url === '/plugin.js' ? plugin : /^\/client\.[a-z]+\.js$/.test(req.url ?? '') ? await readFile(join('lib', req.url.slice(1))) : html);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1584, height: 992 } });
  await page.route('https://raw.githubusercontent.com/Wanyi424/dsh-markdown-notes/main/docs/images/plugin-banner.png', route => route.fulfill({ path: resolve('docs/images/plugin-banner.png'), contentType: 'image/png' }));
  const errors = []; const remote = []; const localRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/) && !req.url().startsWith('data:')) remote.push(req.url()); else localRequests.push(new URL(req.url()).pathname); });
  await page.addInitScript(() => { window.__longTasks = []; new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true }); });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
  const idleRequests = [...localRequests];
  assert.ok(!idleRequests.some(path => path.startsWith('/client.') || path.startsWith('/api/')));
  const start = Date.now();
  await page.locator('#open-notes').click();
  await page.locator('.dsn-prose h1').waitFor({ timeout: 30000 });
  const readingReadyMs = Date.now() - start;
  assert.ok(!localRequests.includes('/client.editor.js'));
  assert.ok(!localRequests.includes('/client.mermaid.js'));
  assert.ok(!localRequests.includes('/client.infographic.js'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(output, 'reading-light.png') });
  for (let i = 0; i < 5; i++) {
    await page.locator('.dsn-diagram').nth(i).scrollIntoViewIfNeeded();
    await page.locator('.dsn-diagram').nth(i).locator('.dsn-diagram-canvas svg').waitFor({ timeout: 30000 });
  }
  const report = await page.evaluate(() => ({
    heading: document.querySelector('.dsn-prose h1')?.textContent,
    headings: document.querySelectorAll('.dsn-prose h2').length,
    formulas: document.querySelectorAll('.katex').length,
    mathErrors: [...document.querySelectorAll('.katex-error')].map(n => n.textContent),
    diagrams: document.querySelectorAll('.dsn-diagram-canvas svg').length,
    diagramErrors: [...document.querySelectorAll('.dsn-render-error')].map(n => n.textContent),
    ruby: document.querySelectorAll('ruby').length,
    callouts: document.querySelectorAll('.dsn-callout').length,
    highlight: document.querySelectorAll('mark').length,
    underline: document.querySelectorAll('ins').length,
    syntax: document.querySelectorAll('.hljs-keyword,.hljs-title,.hljs-string').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
    defaultsToReading: !document.querySelector('.cm-editor'),
  }));
  assert.equal(report.defaultsToReading, true);
  assert.equal(report.diagrams, 5);
  assert.equal(report.formulas, 14);
  assert.equal(report.mathErrors.length, 0);
  assert.equal(report.diagramErrors.length, 0);
  assert.equal(report.overflow, false);
  await page.locator('.dsn-prose h2').filter({ hasText: '进阶' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'math-light.png') });
  await page.locator('.dsn-diagram').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'diagrams-light.png') });
  await page.locator('.dsn-diagram').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'infographic-light.png') });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  await page.getByRole('button', { name: '并排', exact: true }).click();
  await page.locator('.dsn-mode-split .dsn-prose [data-dsn-line]').first().waitFor();
  await page.locator('.cm-scroller').dispatchEvent('pointerdown');
  await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) * .35; });
  await page.waitForFunction(() => document.querySelector('.dsn-reading-pane').scrollTop > 100);
  await page.waitForTimeout(250);
  const editorToPreview = await page.evaluate(() => ({ editor: document.querySelector('.cm-scroller').scrollTop, preview: document.querySelector('.dsn-reading-pane').scrollTop }));
  assert.ok(editorToPreview.editor > 100 && editorToPreview.preview > 100);
  await page.locator('.dsn-reading-pane').dispatchEvent('pointerdown');
  const reverseTarget = await page.locator('.dsn-reading-pane').evaluate(el => {
    const heading = [...el.querySelectorAll('h3[data-dsn-line]')].find(node => node.textContent.includes('Ruby'));
    const line = Number(heading.dataset.dsnLine);
    el.scrollTop = heading.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    return line;
  });
  await page.waitForTimeout(300);
  const reverseLine = await page.locator('.cm-scroller').evaluate(el => {
    const top = el.getBoundingClientRect().top;
    return [...el.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(node => /^\d+$/.test(node.textContent.trim()) && node.getBoundingClientRect().bottom > top + 2).map(node => Number(node.textContent.trim()))[0];
  });
  await page.screenshot({ path: join(output, 'scroll-sync.png') });
  assert.ok(Math.abs(reverseLine - reverseTarget) <= 3, `Reverse scroll: expected source line ${reverseTarget}, got ${reverseLine}`);
  await page.locator('.cm-scroller').dispatchEvent('pointerdown');
  await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.dsn-reading-pane').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop < 3));
  await page.locator('.dsn-reading-pane').dispatchEvent('pointerdown');
  await page.locator('.dsn-reading-pane').evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.cm-scroller').evaluate(el => el.scrollTop < 3));
  const settled = await page.evaluate(() => [document.querySelector('.cm-scroller').scrollTop, document.querySelector('.dsn-reading-pane').scrollTop]);
  await page.waitForTimeout(350);
  const stable = await page.evaluate(() => [document.querySelector('.cm-scroller').scrollTop, document.querySelector('.dsn-reading-pane').scrollTop]);
  assert.deepEqual(stable, settled, 'Scroll positions oscillate after releasing the scroll');
  await page.screenshot({ path: join(output, 'editing-split.png') });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.querySelector('.dsn-reading-pane').scrollTop = 0; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(output, 'reading-dark.png') });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.screenshot({ path: join(output, 'compact.png') });
  await page.setViewportSize({ width: 420, height: 820 });
  await page.screenshot({ path: join(output, 'narrow.png') });
  await page.setViewportSize({ width: 1584, height: 992 });
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  const extra = '# QA 格式验收\n\n[TOC]\n\n## 任务与脚注\n\n- [x] 已完成\n- [ ] 待完成\n\n说明[^n]\n\n[^n]: 脚注正文\n\n### 扩展格式\n\n==高亮== ++下划线++ H~2~O x^2^ [你好]{nǐ hǎo}\n\n> [!TIP] 提示\n> 保留正文\n\n```js\nconst answer = 42;\n```\n\n<script>window.__unsafe = true</script>\n\n<img src="data:image/png;base64,AA" onerror="window.__unsafe = true">\n';
  await page.locator('.cm-content').fill(extra);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.dsn-prose h1').filter({ hasText: 'QA 格式验收' }).waitFor();
  assert.equal(await page.locator('.dsn-prose input[type=checkbox]').count(), 2);
  assert.equal(await page.locator('.dsn-prose input[type=checkbox]:checked').count(), 1);
  assert.equal(await page.locator('.dsn-prose .footnotes').count(), 1);
  assert.equal(await page.locator('.dsn-toc').count(), 1);
  assert.equal(await page.evaluate(() => Boolean(window.__unsafe)), false);
  assert.equal(await page.locator('.dsn-prose script,.dsn-prose [onerror]').count(), 0);
  const tocLink = page.locator('.dsn-toc a').first();
  await tocLink.click();
  assert.equal(new URL(page.url()).hash, '');
  await page.getByRole('button', { name: '复制', exact: true }).first().click();
  await page.getByRole('button', { name: '已复制', exact: true }).waitFor({ timeout: 3000 });
  await page.locator('.dsn-document-title').click();
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('浏览器验收');
  await page.getByRole('textbox', { name: '文档名称', exact: true }).press('Enter');
  await page.locator('.dsn-document-title').filter({ hasText: '浏览器验收' }).waitFor();
  await page.screenshot({ path: join(output, 'formats-light.png') });
  const firstSessionLongTasks = await page.evaluate(() => [...window.__longTasks]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#open-notes').click();
  await page.locator('.dsn-note').filter({ hasText: '浏览器验收' }).click();
  await page.locator('.dsn-prose h1').filter({ hasText: 'QA 格式验收' }).waitFor();
  assert.equal(await readFile(join(temporary, 'notes', '浏览器验收.md'), 'utf8'), extra);
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.screenshot({ path: join(output, 'document-menu.png') });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('.dsn-note').filter({ hasText: '浏览器验收' }).count(), 1);
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.dsn-note')].some(n => n.textContent.includes('浏览器验收')));
  assert.equal(errors.length, 0, errors.join('\n'));
  const externalRequests = [...new Set(remote)];
  assert.ok(externalRequests.every(url => url === 'https://raw.githubusercontent.com/Wanyi424/dsh-markdown-notes/main/docs/images/plugin-banner.png'), 'Unexpected external renderer request: ' + externalRequests.join('\n'));
  // Simulate a genuine file drop. The browser reads copies; only the temporary library is modified.
  const drop = async files => {
    const transfer = await page.evaluateHandle(files => { const data = new DataTransfer(); for (const file of files) data.items.add(new File([file.content], file.name, { type: 'text/markdown' })); return data; }, files);
    await page.locator('.dsn-root').dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
  };
  await drop([{ name: '拖入文档.md', content: '# 拖入文档\n\n原文件保留。' }]);
  await page.locator('.dsn-prose h1').filter({ hasText: '拖入文档' }).waitFor();
  await drop([{ name: '拖入文档.md', content: '# 第二份' }]);
  await page.locator('.dsn-document-title').filter({ hasText: '拖入文档 (2)' }).waitFor();
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '在资源管理器打开', exact: true }).click();
  await page.waitForTimeout(100); assert.equal(openedFolders.at(-1), join(temporary, 'notes'));
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '保存位置', exact: true }).click();
  const destination = join(temporary, 'moved-notes');
  await page.getByRole('textbox', { name: '新保存目录', exact: true }).fill(destination);
  await page.screenshot({ path: join(output, 'migration-dialog.png') });
  await page.getByRole('button', { name: '迁移并使用', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await settings.directory(), destination);
  await assert.rejects(stat(join(temporary, 'notes')), { code: 'ENOENT' });
  assert.equal(await readFile(join(destination, '拖入文档.md'), 'utf8'), '# 拖入文档\n\n原文件保留。');
  await drop([{ name: '大文档.md', content: '# 大文档\n\n' + '正文。'.repeat(50000) }]);
  await page.locator('.dsn-large-document').waitFor();
  assert.equal(await page.locator('.dsn-prose h1').count(), 0);
  await page.locator('#close-notes').click();
  await page.waitForTimeout(600);
  const requestsAtClose = localRequests.length;
  await page.waitForTimeout(600);
  assert.equal(localRequests.length, requestsAtClose, 'Background requests while notes are closed');
  const entryBytes = (await stat('lib/client.js')).size;
  const result = { ...report, entryBytes, previousEntryBytes: 7889639, readingReadyMs, idleRequests,
    longTasks: [...firstSessionLongTasks, ...await page.evaluate(() => window.__longTasks)],
    lazyLoading: 'entry only before opening; editor/diagram chunks absent until used',
    migration: 'copied files, committed settings, deleted empty old folder', dragImport: 'passed including name collisions', explorerDispatch: 'active directory verified; OS window mocked',
    largeDocumentGuard: 'passed', closedPanelRequests: 0,
    synchronizedScroll: { editorToPreview, reverseTarget, reverseLine, endpoints: 'passed', noOscillation: 'passed' },
    interactionFlow: 'create -> edit -> save -> rename -> reload -> read -> cancel delete -> delete passed', tasksAndFootnotes: 'passed', rawHtmlSafety: 'passed', copyAndToc: 'passed', errors, externalRequests };
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
