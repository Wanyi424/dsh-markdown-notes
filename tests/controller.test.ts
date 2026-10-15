import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotesController } from '../src/controller';
import type { NotesApi, Note } from '../src/contracts';

function fixture() {
  const files = new Map([['a.md', 'old'], ['b.md', 'second']]);
  const writes: Array<{ name: string; content: string; previous: string }> = [];
  const api: NotesApi = {
    list: async () => ({ directory: 'test', notes: [...files.keys()].map(name => ({ name })), folders: [] }),
    read: async name => ({ name, content: files.get(name)! }),
    create: async name => { if (files.has(name)) throw new Error('exists'); files.set(name, ''); return { name, content: '' }; },
    save: async (name, content, previous) => { writes.push({ name, content, previous }); files.set(name, content); return { name, content }; },
    rename: async (name, nextName) => { const content = files.get(name)!; files.delete(name); files.set(nextName, content); return { name: nextName, content }; },
    delete: async name => { files.delete(name); },
    createFolder: async name => name,
    renameFolder: async (_name, nextName) => nextName,
    deleteFolder: async () => {},
    importFiles: async imported => { for (const file of imported) files.set(file.name, file.content); return { notes: imported.map(file => ({ name: file.name })), errors: [] }; },
    migrate: async directory => ({ directory, previousDirectory: 'test', moved: files.size, oldDirectoryRemoved: true, warnings: [] }),
    openDirectory: async () => {},
  };
  return { files, writes, api, controller: new NotesController(api, 60_000) };
}

test('switching notes flushes the old document before replacing editor contents', async t => {
  const { controller, files, writes } = fixture();
  t.after(() => controller.dispose());
  await controller.load();
  controller.edit('new text');
  assert.equal(await controller.open('b.md'), true);
  assert.equal(files.get('a.md'), 'new text');
  assert.equal(files.get('b.md'), 'second');
  assert.equal(controller.getSnapshot().content, 'second');
  assert.deepEqual(writes, [{ name: 'a.md', content: 'new text', previous: 'old' }]);
});

test('typing while a save is in flight sends the newer text after the first save', async t => {
  const { controller, api, writes } = fixture();
  t.after(() => controller.dispose());
  const original = api.save;
  let finish!: () => void;
  let started!: () => void;
  const savingStarted = new Promise<void>(resolve => { started = resolve; });
  api.save = async (name, content, previous) => {
    if (content === 'one') { started(); await new Promise<void>(resolve => { finish = resolve; }); }
    return original(name, content, previous);
  };
  await controller.load();
  controller.edit('one'); const saved = controller.flush();
  await savingStarted;
  controller.edit('two'); finish();
  await saved;
  assert.deepEqual(writes.map(w => [w.content, w.previous]), [['one', 'old'], ['two', 'one']]);
  assert.equal(controller.dirty, false);
  assert.equal(controller.getSnapshot().content, 'two');
});

test('a failed save blocks navigation and keeps the draft available for retry', async t => {
  const { controller, api, files } = fixture();
  t.after(() => controller.dispose());
  const save = api.save;
  api.save = async () => { throw new Error('disk full'); };
  await controller.load(); controller.edit('unsaved draft');
  assert.equal(await controller.open('b.md'), false);
  assert.equal(controller.getSnapshot().active, 'a.md');
  assert.equal(controller.getSnapshot().content, 'unsaved draft');
  assert.equal(controller.getSnapshot().error, 'disk full');
  api.save = save;
  await controller.flush();
  assert.equal(files.get('a.md'), 'unsaved draft');
  assert.equal(controller.dirty, false);
});

test('a conflicted draft can be saved as a new note without touching the original', async t => {
  const { controller, api, files } = fixture();
  t.after(() => controller.dispose());
  const save = api.save;
  api.save = async (name, content, previous): Promise<Note> => {
    if (name === 'a.md') throw new Error('external edit');
    return save(name, content, previous);
  };
  await controller.load(); controller.edit('my draft');
  assert.equal(await controller.saveCopy('copy.md'), true);
  assert.equal(files.get('a.md'), 'old');
  assert.equal(files.get('copy.md'), 'my draft');
  assert.equal(controller.getSnapshot().active, 'copy.md');
  assert.equal(controller.dirty, false);
});

test('disposing the plugin drains a pending autosave', async () => {
  const { controller, files } = fixture();
  await controller.load(); controller.edit('last change');
  await controller.dispose();
  assert.equal(files.get('a.md'), 'last change');
});

test('reader is the default, new notes open for editing, and finishing waits for save', async t => {
  const { controller, api, files } = fixture();
  t.after(() => controller.dispose());
  await controller.load();
  assert.equal(controller.getSnapshot().mode, 'preview');
  await controller.create('new.md');
  assert.equal(controller.getSnapshot().mode, 'edit');
  controller.edit('new content');
  const save = api.save;
  api.save = async () => { throw new Error('save failed'); };
  assert.equal(await controller.setMode('preview'), false);
  assert.equal(controller.getSnapshot().mode, 'edit');
  api.save = save;
  assert.equal(await controller.setMode('preview'), true);
  assert.equal(files.get('new.md'), 'new content');
});
