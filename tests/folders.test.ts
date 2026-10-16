import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, lstat, symlink } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { NotesStore, notePath, folderPath } from '../src/storage';
import { NotesController } from '../src/controller';
import { createApi } from '../src/api';
import { createHandler } from '../src/host';

async function fixture(t: { after(fn: () => Promise<void>): void }, persistDirectory?: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-folders-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('dsh-folders-'));
    await rm(root, { recursive: true, force: true });
  });
  const source = join(root, 'notes'), target = join(root, 'new');
  const store = new NotesStore(source, { persistDirectory });
  await store.createFolder('工作'); await store.createFolder('工作/项目');
  return { root, source, target, store };
}

test('nested folders and same-name notes persist as real files; rename and move retain contents', async t => {
  const { source, store } = await fixture(t);
  await store.create('会议'); await store.create('工作/项目/会议');
  await store.save('工作/项目/会议', '# 子目录内容', '');
  const reopened = new NotesStore(source);
  assert.deepEqual((await reopened.list()).folders, ['工作', '工作/项目']);
  assert.equal((await reopened.list()).notes.length, 2);
  await reopened.renameFolder('工作', '归档');
  assert.equal((await reopened.read('归档/项目/会议')).content, '# 子目录内容');
  await assert.rejects(reopened.rename('归档/项目/会议', '会议'), { code: 'EEXIST' });
  assert.equal((await reopened.read('会议')).content, '');
  await reopened.rename('归档/项目/会议', '归档/会议记录');
  assert.equal(await readFile(join(source, '归档', '会议记录.md'), 'utf8'), '# 子目录内容');
  await reopened.deleteFolder('归档/项目');
  await assert.rejects(reopened.deleteFolder('归档'), { code: 'ENOTEMPTY' });
  await reopened.delete('归档/会议记录'); await reopened.deleteFolder('归档');
  assert.deepEqual((await reopened.list()).folders, []);
});

test('folder operations refuse traversal, root deletion, collisions and directory links', async t => {
  const { root, source, store } = await fixture(t);
  for (const name of ['/x', '../x', '工作/../x', '工作//x', '工作\\x', 'C:/x']) assert.throws(() => notePath(name));
  for (const name of ['', '../x', '工作/../x', '/x', 'CON', '.git']) assert.throws(() => folderPath(name, false));
  await assert.rejects(store.deleteFolder(''), { code: 'invalid-name' });
  await store.createFolder('已存在');
  await assert.rejects(store.renameFolder('工作', '已存在'), { code: 'EEXIST' });
  await assert.rejects(store.renameFolder('工作', '工作/嵌套'), { code: 'invalid-name' });
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep.md'), 'keep');
  await symlink(outside, join(source, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(!(await store.list()).folders.includes('link'));
  await assert.rejects(store.read('link/keep'), { code: 'linked-directory' });
  await assert.rejects(store.create('link/new'), { code: 'linked-directory' });
  await assert.rejects(store.deleteFolder('link'), { code: 'linked-directory' });
  assert.equal(await readFile(join(outside, 'keep.md'), 'utf8'), 'keep');
});

test('imports target the selected folder, resolve local collisions, and leave root files untouched', async t => {
  const { store } = await fixture(t);
  await store.create('导入'); await store.create('工作/项目/导入');
  const result = await store.importFiles([{ name: '导入.md', content: 'copied' }], '工作/项目');
  assert.deepEqual(result.notes, [{ name: '工作/项目/导入 (2).md' }]);
  assert.equal((await store.read('工作/项目/导入 (2)')).content, 'copied');
  assert.equal((await store.read('导入')).content, '');
});

test('migration preserves nested and empty folders while retaining foreign files in the source', async t => {
  const { store, source, target } = await fixture(t);
  await store.create('工作/项目/笔记'); await store.save('工作/项目/笔记', 'nested', '');
  await store.createFolder('空文件夹');
  await writeFile(join(source, '工作', 'photo.png'), 'foreign');
  const result = await store.migrate(target);
  assert.equal(result.moved, 1); assert.equal(result.oldDirectoryRemoved, false);
  assert.equal(await readFile(join(target, '工作', '项目', '笔记.md'), 'utf8'), 'nested');
  assert.equal((await lstat(join(target, '空文件夹'))).isDirectory(), true);
  assert.equal(await readFile(join(source, '工作', 'photo.png'), 'utf8'), 'foreign');
  await assert.rejects(lstat(join(source, '工作', '项目')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(source, '空文件夹')), { code: 'ENOENT' });
});

test('nested collision and settings failure roll back only new files and directories', async t => {
  const { store, source, target } = await fixture(t);
  await store.create('工作/项目/笔记'); await store.save('工作/项目/笔记', 'source', '');
  await mkdir(join(target, '工作', '项目'), { recursive: true });
  await writeFile(join(target, '工作', '项目', '笔记.md'), 'target');
  await store.createFolder('另外的空目录');
  await assert.rejects(store.migrate(target), { code: 'migration-conflict' });
  assert.equal(await readFile(join(target, '工作', '项目', '笔记.md'), 'utf8'), 'target');
  assert.deepEqual(await readdir(target), ['工作']);
  const secondTarget = join(dirname(target), 'failed-target');
  await mkdir(secondTarget); await writeFile(join(secondTarget, 'keep.txt'), 'keep');
  const failing = new NotesStore(source, { persistDirectory: async () => { throw new Error('settings failed'); } });
  await assert.rejects(failing.migrate(secondTarget), /settings failed/);
  assert.deepEqual(await readdir(secondTarget), ['keep.txt']);
  assert.equal((await store.read('工作/项目/笔记')).content, 'source');
});

test('migration refuses a linked nested destination and never writes into it', async t => {
  const { root, store, target } = await fixture(t);
  await store.create('工作/项目/笔记');
  const outside = join(root, 'outside'); await mkdir(outside); await mkdir(target);
  await symlink(outside, join(target, '工作'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.migrate(target), { code: 'linked-directory' });
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await store.read('工作/项目/笔记')).content, '');
});

test('controller and API save drafts before folder rename or note move and preserve active paths', async t => {
  const { store } = await fixture(t);
  await store.create('工作/项目/笔记');
  const handler = createHandler(store);
  const api = createApi(async (_url, init) => handler(new Request('http://test/api', init)));
  const controller = new NotesController(api, 60_000); t.after(() => controller.dispose());
  await controller.load(); controller.edit('pending draft');
  controller.selectFolder('工作');
  assert.equal(await controller.renameFolder('工作', '新工作'), true);
  assert.equal(controller.getSnapshot().active, '新工作/项目/笔记.md');
  assert.equal(controller.getSnapshot().content, 'pending draft');
  controller.edit('move with draft');
  assert.equal(await controller.moveNote(controller.getSnapshot().active!, ''), true);
  assert.equal(controller.getSnapshot().active, '笔记.md');
  assert.equal((await store.read('笔记')).content, 'move with draft');
  controller.selectFolder('新工作/项目');
  assert.equal(await controller.create('新笔记'), true);
  assert.equal(controller.getSnapshot().active, '新工作/项目/新笔记.md');
  assert.equal(await controller.createFolder('空目录'), true);
  assert.equal(controller.getSnapshot().folder, '新工作/项目/空目录');
  assert.equal(await controller.deleteFolder('新工作/项目/空目录'), true);
  assert.equal(controller.getSnapshot().folder, '新工作/项目');
  controller.edit('retain this');
  api.save = async () => { throw new Error('disk full'); };
  assert.equal(await controller.moveNote(controller.getSnapshot().active!, ''), false);
  assert.equal(controller.getSnapshot().active, '新工作/项目/新笔记.md');
  assert.equal(controller.getSnapshot().content, 'retain this');
  api.save = async (name, content, previous) => store.save(name, content, previous);
  await controller.flush();
});
