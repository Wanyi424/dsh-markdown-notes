import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NotesStore } from '../src/storage';
import { NotesSettings } from '../src/settings';
import { MAX_NOTE_BYTES } from '../src/contracts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notes-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'old'), target = join(root, 'new');
  const settings = new NotesSettings(join(root, 'settings', 'settings.json'));
  const store = new NotesStore(source, { persistDirectory: directory => settings.saveDirectory(directory), settingsFile: settings.file });
  await store.create('工作笔记'); await store.save('工作笔记', '# 保留内容\n', '');
  return { root, source, target, store, settings };
}

test('migration preserves content, persists the new location, and removes only the empty old directory', async t => {
  const { source, target, store, settings } = await fixture(t);
  await writeFile(join(source, '.dsh-notes-welcome-v1'), '1');
  const result = await store.migrate(target);
  assert.equal(result.oldDirectoryRemoved, true);
  assert.equal(result.moved, 1);
  await assert.rejects(lstat(source), { code: 'ENOENT' });
  assert.equal(await settings.directory(), target);
  const reopened = new NotesStore(await settings.directory());
  assert.equal((await reopened.read('工作笔记')).content, '# 保留内容\n');
  assert.equal(await readFile(join(target, '.dsh-notes-welcome-v1'), 'utf8'), '1');
});

test('unrelated files and subfolders in the old directory are retained with a warning', async t => {
  const { source, target, store } = await fixture(t);
  await mkdir(join(source, '附件')); await writeFile(join(source, '附件', 'photo.txt'), 'attachment'); await writeFile(join(source, 'keep.txt'), 'keep');
  const result = await store.migrate(target);
  assert.equal(result.oldDirectoryRemoved, false);
  assert.ok(result.warnings.length);
  assert.equal(await readFile(join(source, 'keep.txt'), 'utf8'), 'keep');
  assert.equal((await lstat(join(source, '附件'))).isDirectory(), true);
  await assert.rejects(lstat(join(source, '工作笔记.md')), { code: 'ENOENT' });
});

test('target conflicts abort before changing either copy', async t => {
  const { source, target, store, settings } = await fixture(t);
  await mkdir(target); await writeFile(join(target, '工作笔记.md'), 'target');
  await assert.rejects(store.migrate(target), { code: 'migration-conflict' });
  assert.equal(store.directory, source);
  assert.equal((await store.read('工作笔记')).content, '# 保留内容\n');
  assert.equal(await readFile(join(target, '工作笔记.md'), 'utf8'), 'target');
  assert.equal(await settings.directory(source), source);
});

test('settings commit failure rolls back new copies and retains the original library', async t => {
  const { source, target } = await fixture(t);
  await mkdir(target); await writeFile(join(target, 'unrelated.txt'), 'keep');
  const store = new NotesStore(source, { persistDirectory: async () => { throw new Error('write denied'); } });
  await assert.rejects(store.migrate(target), /write denied/);
  assert.deepEqual(await readdir(target), ['unrelated.txt']);
  assert.equal((await store.read('工作笔记')).content, '# 保留内容\n');
  assert.equal(store.directory, source);
});

test('parent, child and junction destinations cannot cause recursive deletion', async t => {
  const { root, source, target, store } = await fixture(t);
  await assert.rejects(store.migrate(join(source, 'nested')), { code: 'nested-directory' });
  await assert.rejects(store.migrate(root), { code: 'nested-directory' });
  await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.migrate(target), { code: 'linked-directory' });
  assert.equal((await store.read('工作笔记')).content, '# 保留内容\n');
});

test('a source modified before cleanup is not removed after migration', async t => {
  const { source, target } = await fixture(t);
  const store = new NotesStore(source, { persistDirectory: async () => { await writeFile(join(source, '工作笔记.md'), 'updated externally'); } });
  const result = await store.migrate(target);
  assert.equal(result.oldDirectoryRemoved, false);
  assert.equal(await readFile(join(source, '工作笔记.md'), 'utf8'), 'updated externally');
  assert.equal((await store.read('工作笔记')).content, '# 保留内容\n');
  assert.ok(result.warnings.some(w => w.includes('被修改')));
});

test('import preserves existing documents, renames collisions, and accepts .markdown', async t => {
  const { store } = await fixture(t);
  const result = await store.importFiles([{ name: '工作笔记.md', content: 'imported' }, { name: '说明.markdown', content: 'hello' }]);
  assert.deepEqual(result.notes, [{ name: '工作笔记 (2).md' }, { name: '说明.md' }]);
  assert.equal((await store.read('工作笔记')).content, '# 保留内容\n');
  assert.equal((await store.read('工作笔记 (2)')).content, 'imported');
  const longName = 'a'.repeat(175) + '.md';
  const longResult = await store.importFiles([{ name: longName, content: 'first' }, { name: longName, content: 'second' }]);
  assert.equal((await store.read(longResult.notes[1].name)).content, 'second');
  await assert.rejects(store.importFiles([{ name: '../escape.md', content: 'bad' }]));
  await assert.rejects(store.importFiles([{ name: 'large.md', content: 'a'.repeat(MAX_NOTE_BYTES + 1) }]), { code: 'too-large' });
});

test('writes queued during migration are applied in the new directory', async t => {
  const { target, source, store } = await fixture(t);
  await Promise.all([store.migrate(target), store.save('工作笔记', 'after migration', '# 保留内容\n')]);
  assert.equal(await readFile(join(target, '工作笔记.md'), 'utf8'), 'after migration');
  await assert.rejects(lstat(source), { code: 'ENOENT' });
});
