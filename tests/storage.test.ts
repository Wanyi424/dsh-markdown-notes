import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesStore, noteName } from '../src/storage';
import { createHandler } from '../src/host';
import { PLUGIN_VERSION } from '../src/version';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-notes-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new NotesStore(directory) };
}

test('Chinese Markdown persists as ordinary files and reopens from a new store', async t => {
  const { store, directory } = await fixture(t);
  await store.create('工作记录');
  await store.create('第二篇');
  const markdown = '# 今天\n\n- [x] 记录\n\n| 项目 | 状态 |\n| --- | --- |\n| 插件 | 完成 |\n\n```js\nconst a = 1;\n```\n';
  await store.save('工作记录.md', markdown, '');
  assert.equal(await readFile(join(directory, '工作记录.md'), 'utf8'), markdown);
  const reopened = new NotesStore(directory);
  assert.equal((await reopened.read('工作记录')).content, markdown);
  assert.equal((await reopened.list()).notes.length, 2);
  await reopened.rename('工作记录', '新的名称');
  assert.equal((await reopened.read('新的名称')).content, markdown);
  await reopened.delete('新的名称');
  assert.deepEqual((await reopened.list()).notes.map(note => note.name), ['第二篇.md']);
});

test('creating or renaming to an existing note never overwrites it', async t => {
  const { store } = await fixture(t);
  await store.create('a'); await store.create('b');
  await store.save('b', 'keep this', '');
  await assert.rejects(store.create('b'), { code: 'EEXIST' });
  await assert.rejects(store.rename('a', 'b'), { code: 'EEXIST' });
  assert.equal((await store.read('b')).content, 'keep this');
  assert.equal((await store.list()).notes.length, 2);
});

test('path-like and Windows-reserved names are refused', () => {
  for (const name of ['../other', '..\\other', 'C:\\notes', '/tmp/file', '.', '..', 'CON', 'NUL.txt', 'name.', 'a:b', '']) {
    assert.throws(() => noteName(name));
  }
  assert.equal(noteName(' 中文笔记 '), '中文笔记.md');
  assert.equal(noteName('Readme.MD'), 'Readme.MD');
});

test('external edits are kept, while a lost successful response can be retried', async t => {
  const { store, directory } = await fixture(t);
  await store.create('note');
  await store.save('note', 'first', '');
  await store.save('note', 'first', '');
  await writeFile(join(directory, 'note.md'), 'external edit');
  await assert.rejects(store.save('note', 'draft', 'first'), { code: 'conflict' });
  assert.equal((await store.read('note')).content, 'external edit');
  assert.deepEqual((await store.list()).notes.map(note => note.name), ['note.md']);
});

test('queued saves preserve order; a deleted file is not silently recreated', async t => {
  const { store } = await fixture(t);
  await store.create('note');
  await Promise.all([store.save('note', 'one', ''), store.save('note', 'two', 'one')]);
  assert.equal((await store.read('note')).content, 'two');
  await store.delete('note');
  await assert.rejects(store.save('note', 'three', 'two'), { code: 'ENOENT' });
});

test('a directory junction cannot be used as a note to delete outside data', async t => {
  const { store, directory } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'dsh-notes-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'keep.txt'), 'keep');
  await symlink(outside, join(directory, 'linked.md'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual((await store.list()).notes, []);
  await assert.rejects(store.delete('linked.md'), { code: 'invalid-file' });
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('Host API handles create/read/save/restart and reports conflict and malformed requests', async t => {
  const { store } = await fixture(t);
  const handler = createHandler(store);
  const call = (body: unknown) => handler(new Request('http://localhost/api/markdown-notes', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-DSH-Notes-Client-Version': PLUGIN_VERSION }, body: JSON.stringify(body),
  }));
  assert.equal((await call({ action: 'create', name: '接口测试' })).status, 200);
  assert.equal((await call({ action: 'save', name: '接口测试', content: '**hello**', previous: '' })).status, 200);
  assert.deepEqual(await (await call({ action: 'read', name: '接口测试' })).json(), { data: { name: '接口测试.md', content: '**hello**' } });
  assert.equal((await call({ action: 'save', name: '接口测试', content: 'stale', previous: '' })).status, 409);
  assert.equal((await call({ action: 'read', name: '../outside' })).status, 400);
  assert.equal((await call(null)).status, 400);
});

test('the store writes no notes of its own; a sample left by an older version sorts like any note', async t => {
  const { directory, store } = await fixture(t);
  assert.deepEqual((await store.list()).notes, []);
  await writeFile(join(directory, 'Markdown 内容示例.md'), 'my changes');
  await store.create('a');
  assert.deepEqual((await store.list()).notes.map(note => note.name), ['a.md', 'Markdown 内容示例.md']);
  assert.equal((await store.read('Markdown 内容示例')).content, 'my changes');
});

test('the list reports when each note was last written, for 全部笔记', async t => {
  const { directory, store } = await fixture(t);
  const newYear = new Date(2026, 0, 1);
  await store.create('older'); await store.create('newer');
  await utimes(join(directory, 'older.md'), newYear, newYear);
  await store.save('newer', 'changed', '');
  const { notes } = await store.list(), modified = (name: string) => notes.find(note => note.name === name)!.modified;
  assert.equal(Math.round(modified('older.md')), newYear.getTime());
  assert.ok(modified('newer.md') > modified('older.md'));
});
