import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir, rm, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { apply, NotesSettings } from '../lib/host.js';
import assert from 'node:assert/strict';

// Real built client and Host, temporary library only. No live DSH profile is changed.
const temporary = await mkdtemp(join(tmpdir(), 'dsh-folders-browser-'));
const output = resolve('artifacts/qa-folders');
let browser, server;
try {
  await mkdir(output, { recursive: true });
  const library = join(temporary, 'notes'); await mkdir(library);
  await writeFile(join(library, '.dsh-notes-welcome-v1'), '1');
  await build({ entryPoints: ['tests/browser-entry.tsx'], outfile: join(temporary, 'entry.js'), bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  let api;
  const settings = new NotesSettings(join(temporary, 'settings', 'settings.json'));
  await apply({ connection: { fetch: { register(route) { api = route.fetch; return () => {}; } } } }, { directory: library }, settings);
  // Use the same existing theme fixture as the full renderer check.
  const reference = await readFile('scripts/browser-check.mjs', 'utf8');
  const light = reference.match(/const light = `([^`]+)`/)[1], dark = reference.match(/const dark = `([^`]+)`/)[1];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>:root{${light}}html[data-theme=dark]{${dark}}*{box-sizing:border-box}body{margin:0;height:100vh;display:grid;grid-template-columns:240px minmax(0,1fr);font-family:'Segoe UI','Microsoft YaHei',sans-serif;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}aside.fixture{padding:30px 18px;background:var(--dsw-alias-bg-layer-1)}aside.fixture button{display:block;padding:12px;border:0;border-radius:8px;background:none;color:inherit}#open-notes{background:var(--dsw-alias-interactive-bg-active)}#plugin{height:100vh;min-width:0;overflow:hidden}@media(max-width:900px){body{grid-template-columns:minmax(0,1fr)}aside.fixture{display:none}}</style></head><body><aside class="fixture"><h2>DSH</h2><button id="close-notes">工作台</button><button id="open-notes">笔记</button><small>隔离验证环境</small></aside><div id="plugin"></div><script src="/entry.js"></script><script src="/client.js"></script></body></html>`;
  server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/markdown-notes') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const response = await api(new Request('http://test/api', { method: 'POST', headers: { 'X-DSH-Notes-Client-Version': req.headers['x-dsh-notes-client-version'] ?? '' }, body: Buffer.concat(chunks) }));
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
      const path = req.url === '/entry.js' ? join(temporary, 'entry.js') : /^\/client(?:\.[a-z]+)?\.js$/.test(req.url) ? join('lib', req.url.slice(1)) : null;
      if (!path) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(path));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
  const errors = [], requests = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { requests.push(req.url()); if (new URL(req.url()).hostname !== '127.0.0.1') external.push(req.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#open-notes').click();
  const dialog = page.getByRole('dialog');
  const createFolder = async name => {
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await dialog.getByRole('textbox', { name: '文件夹名称' }).fill(name);
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  const folderAction = async action => {
    await page.getByRole('button', { name: '文件夹操作', exact: true }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  const documentAction = async action => {
    await page.getByRole('button', { name: '文档操作', exact: true }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  await createFolder('工作'); await createFolder('项目 A');
  await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
  await page.locator('.cm-content').fill('# 多级目录\n\n笔记保存在真实文件夹中。');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.dsn-prose h1').waitFor();
  assert.ok((await readFile(join(library, '工作', '项目 A', '未命名笔记.md'), 'utf8')).includes('真实文件夹'));
  await page.getByRole('button', { name: '收起 工作', exact: true }).click();
  assert.equal(await page.locator('.dsn-note').count(), 0);
  await page.getByRole('button', { name: '展开 工作', exact: true }).click();
  await page.getByRole('button', { name: '文件夹 工作', exact: true }).click();
  await folderAction('重命名文件夹');
  await dialog.getByRole('textbox', { name: '文件夹名称' }).fill('归档');
  await dialog.getByRole('button', { name: '确定', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.ok((await page.locator('.dsn-document-path').innerText()).includes('归档 / 项目 A'));
  await folderAction('删除空文件夹');
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '文件夹不为空' }).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await documentAction('移动到文件夹');
  await dialog.getByRole('combobox', { name: '目标文件夹' }).selectOption('');
  await dialog.getByRole('button', { name: '确定', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.ok((await readFile(join(library, '未命名笔记.md'), 'utf8')).includes('真实文件夹'));
  await assert.rejects(lstat(join(library, '归档', '项目 A', '未命名笔记.md')), { code: 'ENOENT' });
  await page.getByRole('button', { name: '文件夹 归档/项目 A', exact: true }).click();
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['# 拖入子目录'], '导入.md', { type: 'text/markdown' })); return data; });
  await page.locator('.dsn-root').dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
  await page.locator('.dsn-prose h1').filter({ hasText: '拖入子目录' }).waitFor();
  assert.equal(await readFile(join(library, '归档', '项目 A', '导入.md'), 'utf8'), '# 拖入子目录');
  await createFolder('可删除'); await folderAction('删除空文件夹');
  await dialog.getByRole('button', { name: '删除', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await assert.rejects(lstat(join(library, '归档', '项目 A', '可删除')), { code: 'ENOENT' });
  await page.screenshot({ path: join(output, 'folders-light.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: join(output, 'folders-dark.png') });
  await page.setViewportSize({ width: 620, height: 850 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(output, 'folders-narrow.png') });
  await page.setViewportSize({ width: 1500, height: 960 });
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await documentAction('保存位置');
  const target = join(temporary, 'moved');
  await dialog.getByRole('textbox', { name: '新保存目录' }).fill(target);
  await dialog.getByRole('button', { name: '迁移并使用' }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await readFile(join(target, '归档', '项目 A', '导入.md'), 'utf8'), '# 拖入子目录');
  await assert.rejects(lstat(library), { code: 'ENOENT' });
  await page.reload(); await page.locator('#open-notes').click();
  await page.getByRole('button', { name: '文件夹 归档', exact: true }).click();
  await page.getByRole('button', { name: '文件夹 归档/项目 A', exact: true }).click();
  await page.locator('.dsn-note').filter({ hasText: '导入' }).click();
  await page.locator('.dsn-prose h1').filter({ hasText: '拖入子目录' }).waitFor();
  await page.locator('#close-notes').click(); await page.waitForTimeout(500);
  const count = requests.length; await page.waitForTimeout(500); assert.equal(requests.length, count);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ nestedCreate: true, renameActiveAncestor: true, refuseNonemptyDelete: true, moveToRoot: true, importToFolder: true, deleteEmptyFolder: true, migrateAndReload: true, backgroundRequests: 0, errors, external }, null, 2));
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir())); assert.ok(basename(temporary).startsWith('dsh-folders-browser-'));
  await rm(temporary, { recursive: true, force: true });
}
