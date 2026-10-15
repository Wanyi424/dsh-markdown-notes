import type { NotesApi, NoteSummary, Note, ImportFile } from './contracts';

export type ViewMode = 'edit' | 'split' | 'preview';
export interface NotesState {
  directory: string; notes: NoteSummary[]; active: string | null;
  content: string; saved: string; saving: boolean; busy: boolean;
  loaded: boolean; error: string; notice: string; mode: ViewMode;
}

/** Owned by the plugin, not by the page: leaving the panel does not discard a draft. */
export class NotesController {
  private state: NotesState = {
    directory: '', notes: [], active: null, content: '', saved: '', saving: false,
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
  private select(note: Note) { this.patch({ active: note.name, content: note.content, saved: note.content }); }
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
  private async list() { this.patch(await this.api.list()); }
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
      this.select(await this.api.create(name));
      await this.list();
      this.patch({ loaded: true, mode: 'edit' });
    });
  }
  rename(name: string) {
    return this.operation(async () => {
      if (!this.state.active) return;
      this.select(await this.api.rename(this.state.active, name));
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
  importFiles(files: ImportFile[]) {
    return this.operation(async () => {
      const result = await this.api.importFiles(files);
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
      const note = await this.api.create(name);
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
