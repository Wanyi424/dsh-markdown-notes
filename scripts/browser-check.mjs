import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { apply, NotesSettings } from '../lib/host.js';
import { openHarness } from './browser-harness.mjs';
import assert from 'node:assert/strict';

// Real built plugin, Host API and file storage in a temporary library. No DSH account or personal notes are touched.
const temporary = await mkdtemp(join(tmpdir(), 'dsh-notes-browser-'));
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
let harness;
try {
  await build({ entryPoints: ['tests/browser-entry.tsx'], outfile: join(temporary, 'entry.js'), bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  let api;
  const settings = new NotesSettings(join(temporary, 'settings', 'settings.json'));
  await apply({ connection: { fetch: { register(route) { api = route.fetch; return () => {}; } } } }, { directory: join(temporary, 'notes') }, settings);
  const banner = 'https://raw.githubusercontent.com/Wanyi424/dsh-markdown-notes/main/docs/images/plugin-banner.png';
  harness = await openHarness({ api, entry: join(temporary, 'entry.js'), viewport: { width: 1584, height: 992 }, local: { [banner]: { path: resolve('docs/images/plugin-banner.png'), type: 'image/png' } } });
  const { page, errors, external, requests, opened } = harness;
  const shot = name => page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
  const dark = on => page.evaluate(value => { if (value) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme; }, on);
  const mode = name => page.getByRole('group', { name: '阅读与编辑模式' }).getByRole('button', { name, exact: true });
  const libraryAction = async name => { await page.getByRole('button', { name: '笔记库操作', exact: true }).click(); await page.getByRole('menuitem', { name, exact: true }).click(); };
  const documentAction = async name => { await page.getByRole('button', { name: '文档操作', exact: true }).click(); await page.getByRole('menuitem', { name, exact: true }).click(); };
  await page.addInitScript(() => { window.__longTasks = []; new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true }); });
  await page.goto('http://dsh.test/');
  const idleRequests = [...requests];
  assert.ok(!idleRequests.some(path => path.startsWith('/client.') || path.startsWith('/api/')));
  const start = Date.now();
  await page.locator('#open-notes').click();
  await page.locator('.dsn-prose h1').waitFor({ timeout: 30000 });
  const readingReadyMs = Date.now() - start;
  assert.ok(!requests.includes('/client.editor.js'));
  assert.ok(!requests.includes('/client.mermaid.js'));
  assert.ok(!requests.includes('/client.infographic.js'));
  await page.evaluate(() => document.fonts.ready);
  // Reading view with the outline beside the article.
  await page.locator('.dsn-outline a').first().waitFor();
  const outlineLinks = await page.locator('.dsn-outline a').count();
  assert.ok(outlineLinks >= 5, `Outline lists the sample's sections (${outlineLinks})`);
  await shot('reading-light');
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
  // Outline navigation and scroll spy.
  const target = page.locator('.dsn-outline a').nth(3);
  const targetText = await target.innerText();
  await target.click();
  await page.waitForFunction(text => document.querySelector('.dsn-outline a[aria-current]')?.textContent === text, targetText, { timeout: 5000 });
  await page.locator('.dsn-prose h2').filter({ hasText: '进阶' }).scrollIntoViewIfNeeded();
  await shot('math-light');
  await page.locator('.dsn-diagram').first().scrollIntoViewIfNeeded();
  await shot('diagrams-light');
  await page.locator('.dsn-diagram').last().scrollIntoViewIfNeeded();
  await shot('infographic-light');
  await page.getByRole('button', { name: '隐藏大纲', exact: true }).click();
  await page.locator('.dsn-outline').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '显示大纲', exact: true }).click();
  await page.locator('.dsn-outline').waitFor();

  // Editing and synchronized split scrolling.
  await mode('编辑').click();
  await page.locator('.cm-content').waitFor();
  await shot('editing-light');
  await mode('并排').click();
  await page.locator('.dsn-mode-split .dsn-prose [data-dsn-line]').first().waitFor();
  await page.locator('.cm-scroller').dispatchEvent('pointerdown');
  await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) * .35; });
  await page.waitForFunction(() => document.querySelector('.dsn-reading-pane').scrollTop > 100);
  await page.waitForTimeout(250);
  const editorToPreview = await page.evaluate(() => ({ editor: document.querySelector('.cm-scroller').scrollTop, preview: document.querySelector('.dsn-reading-pane').scrollTop }));
  assert.ok(editorToPreview.editor > 100 && editorToPreview.preview > 100);
  await page.locator('.dsn-reading-pane').dispatchEvent('pointerdown');
  await page.locator('.dsn-reading-pane').evaluate(el => {
    const heading = [...el.querySelectorAll('h3[data-dsn-line]')].find(node => node.textContent.includes('Ruby'));
    el.scrollTop = heading.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  });
  await page.waitForTimeout(300);
  // The matching source line must now sit at the top of the editor (within three wrapped lines).
  const reverseOffset = await page.locator('.cm-scroller').evaluate(el => {
    const line = [...el.querySelectorAll('.cm-line')].find(node => node.textContent.includes('5. Ruby'));
    return line ? Math.round(line.getBoundingClientRect().top - el.getBoundingClientRect().top) : null;
  });
  await shot('scroll-sync');
  assert.ok(reverseOffset !== null && Math.abs(reverseOffset) < 3 * 28 + 30, `Reverse scroll: source heading ${reverseOffset}px from the editor top`);
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
  await shot('editing-split');
  // Ctrl+E finishes to reading and returns to the last editing layout.
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+e'); await page.locator('.cm-editor').waitFor({ state: 'detached' });
  await page.keyboard.press('Control+e'); await page.locator('.dsn-mode-split .cm-editor').waitFor();
  await mode('阅读').click(); await page.locator('.cm-editor').waitFor({ state: 'detached' });
  await dark(true); await page.evaluate(() => { document.querySelector('.dsn-reading-pane').scrollTop = 0; });
  await page.waitForTimeout(500);
  await shot('reading-dark');
  await page.setViewportSize({ width: 1100, height: 800 });
  await shot('compact');
  await page.setViewportSize({ width: 420, height: 820 });
  await page.locator('.dsn-root[data-layout="tiny"]').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await shot('narrow');
  await page.getByRole('button', { name: '展开笔记列表', exact: true }).click();
  await page.locator('.dsn-rail[data-overlay]').waitFor(); await shot('narrow-list');
  // Click the uncovered strip beside the drawer.
  await page.locator('.dsn-scrim').click({ position: { x: 400, y: 400 } }); await page.locator('.dsn-rail').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1584, height: 992 });
  await dark(false);

  // Create, format, rename, reload, delete.
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  const extra = '# QA 格式验收\n\n[TOC]\n\n## 任务与脚注\n\n- [x] 已完成\n- [ ] 待完成\n\n说明[^n]\n\n[^n]: 脚注正文\n\n### 扩展格式\n\n==高亮== ++下划线++ H~2~O x^2^ [你好]{nǐ hǎo}\n\n> [!TIP] 提示\n> 保留正文\n\n```js\nconst answer = 42;\n```\n\n<script>window.__unsafe = true</script>\n\n<img src="data:image/png;base64,AA" onerror="window.__unsafe = true">\n';
  await page.locator('.cm-content').fill(extra);
  await mode('阅读').click();
  await page.locator('.dsn-prose h1').filter({ hasText: 'QA 格式验收' }).waitFor();
  assert.equal(await page.locator('.dsn-prose input[type=checkbox]').count(), 2);
  assert.equal(await page.locator('.dsn-prose input[type=checkbox]:checked').count(), 1);
  assert.equal(await page.locator('.dsn-prose .footnotes').count(), 1);
  assert.equal(await page.locator('.dsn-toc').count(), 1);
  assert.equal(await page.evaluate(() => Boolean(window.__unsafe)), false);
  assert.equal(await page.locator('.dsn-prose script,.dsn-prose [onerror]').count(), 0);
  await page.locator('.dsn-toc a').first().click();
  assert.equal(new URL(page.url()).hash, '');
  await page.getByRole('button', { name: '复制', exact: true }).first().click();
  await page.getByRole('button', { name: '已复制', exact: true }).waitFor({ timeout: 3000 });
  await page.locator('.dsn-document-title').click();
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('浏览器验收');
  await page.getByRole('textbox', { name: '文档名称', exact: true }).press('Enter');
  await page.locator('.dsn-document-title').filter({ hasText: '浏览器验收' }).waitFor();
  await shot('formats-light');
  // Title filter: instant matches with the folder path, Enter opens the first, Esc clears.
  await page.getByRole('searchbox', { name: '筛选笔记' }).fill('内容');
  await page.locator('.dsn-result').filter({ hasText: 'Markdown 内容示例' }).waitFor();
  assert.equal(await page.locator('.dsn-result').count(), 1);
  await shot('filter');
  await page.getByRole('searchbox', { name: '筛选笔记' }).press('Enter');
  await page.locator('.dsn-document-title').filter({ hasText: 'Markdown 内容示例' }).waitFor();
  await page.getByRole('searchbox', { name: '筛选笔记' }).press('Escape');
  await page.locator('.dsn-tree').waitFor();
  // Context menu on a tree row.
  await page.locator('.dsn-note').filter({ hasText: '浏览器验收' }).click({ button: 'right' });
  await page.getByRole('menu', { name: '浏览器验收 的更多操作' }).waitFor();
  await shot('tree-menu');
  await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({ state: 'detached' });
  const firstSessionLongTasks = await page.evaluate(() => [...window.__longTasks]);
  await page.reload();
  await page.locator('#open-notes').click();
  await page.locator('.dsn-note').filter({ hasText: '浏览器验收' }).click();
  await page.locator('.dsn-prose h1').filter({ hasText: 'QA 格式验收' }).waitFor();
  assert.equal(await readFile(join(temporary, 'notes', '浏览器验收.md'), 'utf8'), extra);
  await page.getByRole('button', { name: '文档操作', exact: true }).click();
  await shot('document-menu');
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await shot('delete-dialog');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('.dsn-note').filter({ hasText: '浏览器验收' }).count(), 1);
  await documentAction('删除');
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.dsn-note')].some(n => n.textContent.includes('浏览器验收')));
  assert.equal(errors.length, 0, errors.join('\n'));
  const externalRequests = [...new Set(external)];
  assert.ok(externalRequests.every(url => url === banner), 'Unexpected external renderer request: ' + externalRequests.join('\n'));

  // Simulate a genuine file drop. The browser reads copies; only the temporary library is modified.
  const drop = async files => {
    // Drops are refused while another operation is running (by design), so wait for the page to settle first.
    await page.locator('.dsn-main[aria-busy="false"]').waitFor();
    const transfer = await page.evaluateHandle(files => { const data = new DataTransfer(); for (const file of files) data.items.add(new File([file.content], file.name, { type: 'text/markdown' })); return data; }, files);
    await page.locator('.dsn-root').dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
  };
  await drop([{ name: '拖入文档.md', content: '# 拖入文档\n\n原文件保留。' }]);
  await page.locator('.dsn-prose h1').filter({ hasText: '拖入文档' }).waitFor();
  await page.locator('.dsn-toast').filter({ hasText: '已导入 1 篇笔记' }).waitFor();
  await shot('import-toast');
  await drop([{ name: '拖入文档.md', content: '# 第二份' }]);
  await page.locator('.dsn-document-title').filter({ hasText: '拖入文档 (2)' }).waitFor();
  await libraryAction('在资源管理器打开');
  await page.waitForTimeout(100); assert.equal(opened.at(-1)?.path, join(temporary, 'notes'));
  await libraryAction('保存位置…');
  const destination = join(temporary, 'moved-notes');
  await page.getByRole('textbox', { name: '新保存目录', exact: true }).fill(destination);
  await shot('migration-dialog');
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
  const requestsAtClose = requests.length;
  await page.waitForTimeout(600);
  assert.equal(requests.length, requestsAtClose, 'Background requests while notes are closed');
  const entryBytes = (await stat('lib/client.js')).size, pageBytes = (await stat('lib/client.page.js')).size;
  const result = { ...report, entryBytes, pageBytes, readingReadyMs, idleRequests,
    longTasks: [...firstSessionLongTasks, ...await page.evaluate(() => window.__longTasks)],
    lazyLoading: 'entry only before opening; editor/diagram chunks absent until used',
    outline: `${outlineLinks} sections, click navigation and scroll spy passed`, filter: 'title match, Enter opens, Esc clears', contextMenu: 'passed', editingShortcut: 'Ctrl+E toggles reading and the last editing layout',
    migration: 'copied files, committed settings, deleted empty old folder', dragImport: 'passed including name collisions', explorerDispatch: 'active directory verified; OS window mocked',
    largeDocumentGuard: 'passed', closedPanelRequests: 0,
    synchronizedScroll: { editorToPreview, reverseOffset, endpoints: 'passed', noOscillation: 'passed' },
    interactionFlow: 'create -> edit -> save -> rename -> reload -> read -> cancel delete -> delete passed', tasksAndFootnotes: 'passed', rawHtmlSafety: 'passed', copyAndToc: 'passed', errors, externalRequests };
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await harness?.page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  if (harness?.errors.length) console.error('Page errors:\n' + harness.errors.join('\n'));
  throw error;
} finally {
  await harness?.browser.close();
  await rm(temporary, { recursive: true, force: true });
}
