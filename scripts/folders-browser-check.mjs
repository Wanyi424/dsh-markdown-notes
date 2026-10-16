import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, mkdir, rm, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { apply, NotesSettings } from '../lib/host.js';
import { openHarness } from './browser-harness.mjs';
import assert from 'node:assert/strict';

// Real built client and Host, temporary library only. No live DSH profile is changed.
const temporary = await mkdtemp(join(tmpdir(), 'dsh-folders-browser-'));
const output = resolve('artifacts/qa-folders');
let harness;
try {
  await mkdir(output, { recursive: true });
  const library = join(temporary, 'notes'); await mkdir(library);
  await writeFile(join(library, '.dsh-notes-welcome-v1'), '1');
  await build({ entryPoints: ['tests/browser-entry.tsx'], outfile: join(temporary, 'entry.js'), bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  let api;
  const settings = new NotesSettings(join(temporary, 'settings', 'settings.json'));
  await apply({ connection: { fetch: { register(route) { api = route.fetch; return () => {}; } } } }, { directory: library }, settings);
  harness = await openHarness({ api, entry: join(temporary, 'entry.js'), viewport: { width: 1500, height: 960 }, navWidth: 240 });
  const { page, errors, external, requests } = harness;
  const dialog = page.getByRole('dialog');
  const shot = name => page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
  const menuAction = async (button, action) => { await button.click(); await page.getByRole('menuitem', { name: action, exact: true }).click(); };
  const folderRow = path => page.locator(`[data-folder="${path}"]`);
  const folderAction = async (path, action) => {
    await folderRow(path).hover();
    await menuAction(folderRow(path).getByRole('button', { name: `${basename(path)} 的更多操作`, exact: true }), action);
  };
  const createFolder = async name => {
    await menuAction(page.getByRole('button', { name: '笔记库操作', exact: true }), '新建文件夹');
    await dialog.getByRole('textbox', { name: '文件夹名称' }).fill(name);
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  const documentAction = action => menuAction(page.getByRole('button', { name: '文档操作', exact: true }), action);
  const mode = name => page.getByRole('group', { name: '阅读与编辑模式' }).getByRole('button', { name, exact: true });
  await page.goto('http://dsh.test/');
  await page.locator('#open-notes').click();
  await page.locator('.dsn-welcome').waitFor();
  await shot('empty-library');
  // New folders go into the selected folder, which is highlighted in the tree.
  await createFolder('工作'); await createFolder('项目 A');
  await page.locator('[data-folder="工作/项目 A"][data-selected]').waitFor();
  await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
  await page.locator('.cm-content').fill('# 多级目录\n\n笔记保存在真实文件夹中。');
  await mode('阅读').click();
  await page.locator('.dsn-prose h1').waitFor();
  assert.ok((await readFile(join(library, '工作', '项目 A', '未命名笔记.md'), 'utf8')).includes('真实文件夹'));
  assert.deepEqual(await page.locator('.dsn-crumb').allInnerTexts(), ['工作', '项目 A']);
  // Clicking a folder row selects it and toggles it.
  await page.getByRole('button', { name: '文件夹 工作', exact: true }).click();
  // Folding animates: the closing rows stay for the transition, inert, then leave the DOM.
  await page.locator('.dsn-collapse[inert]:not([data-open])').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelectorAll('.dsn-note').length === 0);
  await page.getByRole('button', { name: '文件夹 工作', exact: true }).click();
  await page.locator('.dsn-note').first().waitFor();
  // Hover actions on a folder row: the "+" creates a note right there.
  await folderRow('工作').hover();
  await shot('row-actions');
  await folderAction('工作', '重命名文件夹');
  await dialog.getByRole('textbox', { name: '文件夹名称' }).fill('归档');
  await dialog.getByRole('button', { name: '确定', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.locator('.dsn-crumb').allInnerTexts(), ['归档', '项目 A']);
  await folderAction('归档', '删除空文件夹');
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '文件夹不为空' }).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await documentAction('移动到…');
  await dialog.getByRole('radio', { name: '根目录' }).check();
  await shot('move-dialog');
  await dialog.getByRole('button', { name: '移动', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.ok((await readFile(join(library, '未命名笔记.md'), 'utf8')).includes('真实文件夹'));
  await assert.rejects(lstat(join(library, '归档', '项目 A', '未命名笔记.md')), { code: 'ENOENT' });
  await page.locator('.dsn-toast').filter({ hasText: '已移动到「根目录」' }).waitFor();
  // A dropped file lands in the folder under the pointer (here: the selected folder).
  await page.getByRole('button', { name: '文件夹 归档/项目 A', exact: true }).click();
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['# 拖入子目录'], '导入.md', { type: 'text/markdown' })); return data; });
  await page.locator('.dsn-root').dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
  await page.locator('.dsn-prose h1').filter({ hasText: '拖入子目录' }).waitFor();
  assert.equal(await readFile(join(library, '归档', '项目 A', '导入.md'), 'utf8'), '# 拖入子目录');
  // Drag a note onto another folder to move it; the draft is saved first.
  await page.locator('[data-note="未命名笔记.md"]').dragTo(folderRow('归档'));
  await page.locator('[data-note="归档/未命名笔记.md"]').waitFor();
  assert.ok((await readFile(join(library, '归档', '未命名笔记.md'), 'utf8')).includes('真实文件夹'));
  // Rows of one level share an icon column (notes reserve the chevron slot), and every guide runs through its folder's chevron.
  const geometry = await page.evaluate(() => {
    const center = element => { const r = element.getBoundingClientRect(); return r.left + r.width / 2; };
    const rows = [...document.querySelectorAll('.dsn-tree li > .dsn-row')].map(row => [getComputedStyle(row).getPropertyValue('--depth').trim(), center(row.querySelector('.dsn-row-main svg:not(.dsn-chevron)'))]);
    const guides = [...document.querySelectorAll('.dsn-tree-group .dsn-tree-group')].map(group => [center(group.closest('li').querySelector(':scope > .dsn-row .dsn-chevron')), group.getBoundingClientRect().left + parseFloat(getComputedStyle(group, '::before').left) + .5]);
    return { rows, guides };
  });
  const columns = new Map(); for (const [depth, x] of geometry.rows) (columns.get(depth) ?? columns.set(depth, []).get(depth)).push(x);
  assert.ok(geometry.rows.some(([depth]) => depth === '1') && [...columns.values()].every(xs => Math.max(...xs) - Math.min(...xs) < .5), 'icons of one level align');
  assert.ok(geometry.guides.length >= 2 && geometry.guides.every(([chevron, line]) => Math.abs(chevron - line) < .75), 'guides run through the parent chevron');
  await createFolder('可删除');
  await folderAction('归档/项目 A/可删除', '删除空文件夹');
  await dialog.getByRole('button', { name: '删除', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await assert.rejects(lstat(join(library, '归档', '项目 A', '可删除')), { code: 'ENOENT' });
  await page.locator('[data-note="归档/项目 A/导入.md"] .dsn-row-main').click({ button: 'right' });
  await page.getByRole('menu').waitFor(); await shot('note-menu'); await page.keyboard.press('Escape');
  // A "⋯" button toggles its own menu, which sits flush with it from the first frame.
  const libraryButton = page.getByRole('button', { name: '笔记库操作', exact: true });
  await libraryButton.click(); await page.getByRole('menu').waitFor();
  const [menuBox, buttonBox] = [await page.getByRole('menu').boundingBox(), await libraryButton.boundingBox()];
  assert.ok(Math.abs(menuBox.x + menuBox.width - buttonBox.x - buttonBox.width) < 1, 'menu right edge aligns with its trigger');
  await libraryButton.click(); await page.getByRole('menu').waitFor({ state: 'detached' }); await page.mouse.move(900, 600);
  await shot('folders-light');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await shot('folders-dark');
  await page.setViewportSize({ width: 620, height: 850 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await shot('folders-narrow');
  await page.setViewportSize({ width: 1500, height: 960 });
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await menuAction(page.getByRole('button', { name: '笔记库操作', exact: true }), '保存位置…');
  const target = join(temporary, 'moved');
  await dialog.getByRole('textbox', { name: '新保存目录' }).fill(target);
  await dialog.getByRole('button', { name: '迁移并使用' }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await readFile(join(target, '归档', '项目 A', '导入.md'), 'utf8'), '# 拖入子目录');
  await assert.rejects(lstat(library), { code: 'ENOENT' });
  await page.reload(); await page.locator('#open-notes').click();
  await page.getByRole('button', { name: '文件夹 归档', exact: true }).waitFor();
  if (await page.locator('[data-note="归档/项目 A/导入.md"]').count() === 0) {
    if (await page.getByRole('button', { name: '文件夹 归档', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: '文件夹 归档', exact: true }).click();
    if (await page.getByRole('button', { name: '文件夹 归档/项目 A', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: '文件夹 归档/项目 A', exact: true }).click();
  }
  await page.locator('.dsn-note').filter({ hasText: '导入' }).click();
  await page.locator('.dsn-prose h1').filter({ hasText: '拖入子目录' }).waitFor();
  await page.locator('#close-notes').click(); await page.waitForTimeout(500);
  const count = requests.length; await page.waitForTimeout(500); assert.equal(requests.length, count);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ nestedCreate: true, selectedFolderHighlighted: true, rowToggle: true, renameActiveAncestor: true, refuseNonemptyDelete: true, moveToRoot: true, importToFolder: true, dragMoveNote: true, treeAlignment: true, menuToggle: true, foldingAnimation: true, deleteEmptyFolder: true, migrateAndReload: true, backgroundRequests: 0, errors, external }, null, 2));
} catch (error) {
  await harness?.page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  if (harness?.errors.length) console.error('Page errors:\n' + harness.errors.join('\n'));
  throw error;
} finally {
  await harness?.browser.close();
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir())); assert.ok(basename(temporary).startsWith('dsh-folders-browser-'));
  await rm(temporary, { recursive: true, force: true });
}
