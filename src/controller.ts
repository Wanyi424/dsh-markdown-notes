import type { NotesApi, NoteSummary, Note, ImportFile } from './contracts';
import { baseName, parentFolder, inFolder, withinFolder } from './note-path';

export type ViewMode = 'edit' | 'split' | 'preview';
export interface NotesState {
  directory: string; notes: NoteSummary[]; active: string | null;
  folders: string[]; folder: string; expanded: string[];
  content: string; saved: string; saving: boolean; busy: boolean;
  loaded: boolean; error: string; notice: string; mode: ViewMode;
}

/** Owned by the plugin, not by the page: leaving the panel does not discard a draft. */
export class NotesController {
  private state: NotesState = {
    directory: '', notes: [], active: null, content: '', saved: '', saving: false,
    folders: [], folder: '', expanded: [],
    busy: false, loaded: false, error: '', notice: '', mode: 'preview',
  };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private saving?: Promise<void>;
  private disposed = false;
  constructor(private api: NotesApi, private delay = 450) {}
  getSnapshot = (): NotesState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private patch(patch: Partial<NotesState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  get dirty() { return this.state.content !== this.state.saved; }
  private fail(error: unknown) { this.patch({ error: error instanceof Error ? error.message : String(error) }); }
  reportError(message: string) { this.patch({ error: message }); }
  dismissNotice() { this.patch({ notice: '' }); }
  private reveal(folder: string) {
    const expanded = new Set(this.state.expanded);
    for (let path = folder; path; path = parentFolder(path)) expanded.add(path);
    return [...expanded];
  }
  private select(note: Note) {
    const folder = parentFolder(note.name);
    this.patch({ active: note.name, content: note.content, saved: note.content, folder, expanded: this.reveal(folder) });
  }
  selectFolder(folder: string) {
    if (this.state.busy || (folder && !this.state.folders.includes(folder))) return;
    this.patch({ folder, expanded: this.reveal(folder) });
  }
  toggleFolder(folder: string) {
    const expanded = new Set(this.state.expanded);
    if (expanded.has(folder)) expanded.delete(folder); else expanded.add(folder);
    this.patch({ expanded: [...expanded] });
  }
  async setMode(mode: ViewMode) {
    if (mode === 'preview') {
      return this.operation(async () => { this.patch({ mode }); });
    }
    this.patch({ mode });
    return true;
  }
  edit(content: string) {
    if (this.state.busy || this.disposed || !this.state.active) return;
    this.patch({ content });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, this.delay);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    if (!this.dirty || !this.state.active) return Promise.resolve();
    this.patch({ saving: true, error: '' });
    this.saving = (async () => {
      while (this.dirty && this.state.active) {
        const { active, content, saved } = this.state;
        await this.api.save(active, content, saved);
        // Only mark the sent snapshot saved; text typed during the request still needs saving.
        this.patch({ saved: content });
      }
    })().catch(error => {
      this.fail(error);
      throw error;
    }).finally(() => {
      this.saving = undefined;
      this.patch({ saving: false });
    });
    return this.saving;
  }
  private async operation(task: () => Promise<void>, saveFirst = true): Promise<boolean> {
    if (this.state.busy || this.disposed) return false;
    this.patch({ busy: true, error: '' });
    try {
      if (saveFirst) await this.flush();
      await task();
      return true;
    } catch (error) { this.fail(error); return false; }
    finally { this.patch({ busy: false }); }
  }
  private async list() {
    const library = await this.api.list();
    this.patch({ ...library, folder: library.folders.includes(this.state.folder) ? this.state.folder : '',
      expanded: this.state.expanded.filter(folder => library.folders.includes(folder)) });
  }
  async load() {
    if (this.state.loaded) return;
    await this.refresh();
  }
  refresh() {
    return this.operation(async () => {
      await this.list();
      const selected = this.state.notes.find(n => n.name === this.state.active) ?? this.state.notes[0];
      if (selected) this.select(await this.api.read(selected.name));
      else this.patch({ active: null, content: '', saved: '' });
      this.patch({ loaded: true });
    });
  }
  open(name: string) {
    return this.operation(async () => { this.select(await this.api.read(name)); this.patch({ mode: 'preview' }); });
  }
  create(name: string) {
    return this.operation(async () => {
      this.select(await this.api.create(inFolder(this.state.folder, name)));
      await this.list();
      this.patch({ loaded: true, mode: 'edit' });
    });
  }
  rename(name: string) {
    return this.operation(async () => {
      if (!this.state.active) return;
      if (/[\/\\]/.test(name)) throw new Error('名称不能包含路径；请使用“移动到文件夹”。');
      this.select(await this.api.rename(this.state.active, inFolder(parentFolder(this.state.active), name)));
      await this.list();
    });
  }
  move(folder: string) {
    return this.operation(async () => {
      if (!this.state.active) return;
      this.select(await this.api.rename(this.state.active, inFolder(folder, baseName(this.state.active))));
      await this.list();
    });
  }
  createFolder(name: string) {
    return this.operation(async () => {
      if (/[\/\\]/.test(name)) throw new Error('请输入单个文件夹名称。');
      const folder = await this.api.createFolder(inFolder(this.state.folder, name.trim()));
      await this.list();
      this.selectFolderAfterOperation(folder);
    });
  }
  private selectFolderAfterOperation(folder: string) { this.patch({ folder, expanded: this.reveal(folder) }); }
  renameFolder(name: string) {
    return this.operation(async () => {
      const previous = this.state.folder;
      if (!previous) return;
      if (/[\/\\]/.test(name)) throw new Error('请输入单个文件夹名称。');
      const folder = await this.api.renameFolder(previous, inFolder(parentFolder(previous), name.trim()));
      const remap = (path: string) => withinFolder(path, previous) ? folder + path.slice(previous.length) : path;
      this.patch({ folder, active: this.state.active ? remap(this.state.active) : null, expanded: this.state.expanded.map(remap) });
      await this.list();
    });
  }
  deleteFolder() {
    return this.operation(async () => {
      const folder = this.state.folder;
      if (!folder) return;
      await this.api.deleteFolder(folder);
      this.patch({ folder: parentFolder(folder) });
      await this.list();
    });
  }
  delete() {
    return this.operation(async () => {
      if (!this.state.active) return;
      await this.api.delete(this.state.active);
      this.patch({ active: null, content: '', saved: '' });
      await this.list();
      if (this.state.notes[0]) this.select(await this.api.read(this.state.notes[0].name));
    });
  }
  importFiles(files: ImportFile[], folder = this.state.folder) {
    return this.operation(async () => {
      const result = await this.api.importFiles(files, folder);
      await this.list();
      if (result.notes[0]) this.select(await this.api.read(result.notes[0].name));
      this.patch({ mode: 'preview', notice: result.notes.length ? `已导入 ${result.notes.length} 篇笔记，原文件已保留。` : '', error: result.errors.join('\n'), loaded: true });
    });
  }
  migrate(directory: string) {
    return this.operation(async () => {
      const result = await this.api.migrate(directory);
      await this.list();
      this.patch({ notice: `已迁移 ${result.moved} 篇笔记。${result.oldDirectoryRemoved ? '旧目录已删除。' : ''}${result.warnings.join(' ')}` });
    });
  }
  openDirectory() { return this.operation(() => this.api.openDirectory()); }
  /** Recover a conflicted/failed draft without overwriting the external file. */
  saveCopy(name: string) {
    return this.operation(async () => {
      // Join an already-running request, but a conflict must not prevent saving a copy.
      await this.saving?.catch(() => {});
      const content = this.state.content;
      const note = await this.api.create(inFolder(this.state.active ? parentFolder(this.state.active) : this.state.folder, name));
      this.select(note);
      this.patch({ content });
      await this.flush();
      await this.list();
    }, false);
  }
  async dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    try { await this.flush(); } finally { this.listeners.clear(); }
  }
}
