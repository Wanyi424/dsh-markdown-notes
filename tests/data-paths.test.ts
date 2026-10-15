import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { notesDataDirectory, defaultNotesDirectory } from '../src/data-paths';
import { NotesSettings } from '../src/settings';
import { NotesStore } from '../src/storage';

test('DSH home owns notes/settings; migration changes only the notes directory and persists', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-note-paths-')), previous = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = '   ';
    assert.equal(notesDataDirectory(), join(homedir(), '.dsh', 'plugin-data', 'dsh-markdown-notes'));
    process.env.DSH_HOME = join(temporary, 'harness');
    const root = join(process.env.DSH_HOME, 'plugin-data', 'dsh-markdown-notes');
    const settings = new NotesSettings();
    assert.equal(settings.file, join(root, 'settings.json')); assert.equal(await settings.directory(), join(root, 'notes'));
    assert.equal(defaultNotesDirectory(), join(root, 'notes'));
    const store = new NotesStore(undefined, { persistDirectory: directory => settings.saveDirectory(directory), settingsFile: settings.file });
    await store.create('迁移验证'); await store.save('迁移验证', '# 内容保持', '');
    const old = store.directory, next = join(temporary, 'moved');
    await store.migrate(next); await assert.rejects(access(old));
    assert.equal(await new NotesSettings().directory(), next);
    assert.equal((await store.read('迁移验证')).content, '# 内容保持'); await access(settings.file);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir())); await rm(temporary, { recursive: true, force: true });
  }
});
