import React, { useEffect, useRef, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { FileText, Plus, MoreHorizontal, Pencil, Check, Columns2, AlignLeft, RefreshCw, Trash2, Folder, FolderOpen, Upload, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { NotesController } from './controller';
import type { Translate } from './dictionaries';
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_NOTE_BYTES, type ImportFile } from './contracts';
import { loadChunk } from './lazy-chunk';
import css from './styles.css';

const NS = 'markdownNotes';
const MarkdownEditor = lazy(() => loadChunk<typeof import('./editor')>('client.editor.js').then(module => ({ default: module.MarkdownEditor })));
const MarkdownPreview = lazy(() => loadChunk<typeof import('./preview')>('client.preview.js').then(module => ({ default: module.MarkdownPreview })));
declare global { interface Window { __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> } } }
export interface ClientContext {
  locale: { register(namespace: string, dict: Record<string, unknown>): () => void; bind(namespace: string): Translate;
    subscribe(listener: () => void): () => void; getSnapshot(): unknown };
  slots: { inject(owner: string, callback: () => unknown): unknown; register(options: Record<string, unknown>, component: React.ComponentType): () => void };
  effect(callback: () => (() => void | Promise<void>), label?: string): unknown;
}
type DialogKind = 'delete' | 'copy' | 'location';
function NoteDialog({ kind, initial, directory, t, busy, error, onClose, onSubmit }: {
  kind: DialogKind; initial: string; directory: string; t: Translate; busy: boolean; error: string;
  onClose(): void; onSubmit(value: string): Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(kind === 'location' ? initial : initial.replace(/\.md$/i, ''));
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState('');
  const chooseDirectory = async () => {
    setPicking(true); setPickError('');
    try { const path = await window.__DSH_DIRECTORY_PICKER__?.pick(); if (path) setValue(path); }
    catch (error) { setPickError(error instanceof Error ? error.message : String(error)); }
    finally { setPicking(false); }
  };
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog className="dsn-dialog" ref={ref} aria-labelledby="dsn-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy && !picking) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy && !picking) void onSubmit(value); }}>
      <h2 id="dsn-dialog-title">{t(kind === 'copy' ? 'copyTitle' : kind === 'location' ? 'directory' : 'deleteTitle')}</h2>
      {kind === 'delete' ? <p>{t('deleteHint', { name: initial })}</p> : kind === 'location' ?
        <><p>{t('locationHint')}</p><code className="dsn-location-path">{directory}</code>
          <label className="dsn-directory-field">{t('newDirectory')}<input aria-label={t('newDirectory')} value={value} disabled={busy || picking} onChange={event => setValue(event.target.value)} placeholder="D:\Notes" /></label>
          {window.__DSH_DIRECTORY_PICKER__ && <button type="button" disabled={busy || picking} onClick={() => void chooseDirectory()}><Folder />{picking ? t('picking') : t('chooseDirectory')}</button>}
          <p className="dsn-migration-hint">{t('migrationHint')}</p></> :
        <label>{t('name')}<input autoFocus value={value} maxLength={180} required disabled={busy} onChange={e => setValue(e.target.value)} /></label>}
      {(error || pickError) && <p className="dsn-dialog-error" role="alert">{error || pickError}</p>}
      <div className="dsn-dialog-actions">
        <button type="button" onClick={onClose} disabled={busy || picking} autoFocus={kind !== 'copy'}>{t(kind === 'location' ? 'close' : 'cancel')}</button>
        <button className={kind === 'delete' ? 'dsn-danger' : 'dsn-primary'} disabled={busy || picking || (kind !== 'delete' && !value.trim()) || (kind === 'location' && value.trim() === directory)}>{t(kind === 'delete' ? 'delete' : kind === 'location' ? busy ? 'migrating' : 'migrate' : 'confirm')}</button>
      </div>
    </form>
  </dialog>;
}

export function NotesPage({ controller, ctx }: { controller: NotesController; ctx: ClientContext }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot());
  const t = ctx.locale.bind(NS);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [menu, setMenu] = useState<'document' | 'rail' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const cancelledRename = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const readPane = useRef<HTMLDivElement>(null);
  const dirty = state.content !== state.saved;
  const [preview, setPreview] = useState({ name: state.active, content: state.content });
  useEffect(() => {
    if (state.mode === 'edit') return;
    const timer = setTimeout(() => setPreview({ name: state.active, content: state.content }), state.mode === 'split' && state.active === preview.name ? 300 : 0);
    return () => clearTimeout(timer);
  }, [state.active, state.content, state.mode]);
  const deferred = preview.name === state.active ? preview.content : state.content;
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const reading = state.mode === 'preview';
  const save = () => { void controller.flush().catch(() => {}); };
  useEffect(() => { void controller.load(); return () => { void controller.flush().catch(() => {}); }; }, [controller]);
  useEffect(() => { readPane.current?.scrollTo({ top: 0 }); setRenaming(false); }, [state.active]);
  useEffect(() => { if (renaming) { titleInput.current?.focus(); titleInput.current?.select(); } }, [renaming]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('[data-dsn-menu]')) setMenu(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);
  const beginRename = () => { setMenu(null); cancelledRename.current = false; setTitle(state.active?.replace(/\.md$/i, '') ?? ''); setRenaming(true); };
  const rename = async () => {
    if (cancelledRename.current || state.busy) return;
    if (title.trim() === state.active?.replace(/\.md$/i, '')) { setRenaming(false); return; }
    if (await controller.rename(title)) setRenaming(false);
  };
  const create = async () => {
    let suffix = 1; let name = t('unnamed');
    while (state.notes.some(note => note.name.toLowerCase() === `${name}.md`.toLowerCase())) name = `${t('unnamed')} ${++suffix}`;
    await controller.create(name);
  };
  const openDialog = (kind: DialogKind) => { setMenu(null); setDialogError(''); setDialog(kind); };
  const submit = async (value: string) => {
    const success = dialog === 'copy' ? await controller.saveCopy(value) : dialog === 'location' ? await controller.migrate(value) : await controller.delete();
    if (success) setDialog(null); else setDialogError(controller.getSnapshot().error);
  };
  const importFiles = async (files: File[]) => {
    if (state.busy || importing.current) { controller.reportError(t('busyImport')); return; }
    const accepted = files.filter(file => /\.(md|markdown)$/i.test(file.name));
    if (!accepted.length) { controller.reportError(t('markdownOnly')); return; }
    if (accepted.length > MAX_IMPORT_FILES || accepted.some(file => file.size > MAX_NOTE_BYTES) || accepted.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BYTES) { controller.reportError(t('importLimit')); return; }
    importing.current = true;
    try {
      const contents: ImportFile[] = [];
      for (const file of accepted) contents.push({ name: file.name, content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) });
      await controller.importFiles(contents);
    } catch (error) { controller.reportError(error instanceof TypeError ? t('utf8Only') : String(error)); }
    finally { importing.current = false; }
  };
  const status = state.saving ? 'saving' : dirty ? state.error ? 'failed' : 'pending' : 'saved';
  const popover = (kind: 'document' | 'rail') => menu === kind && <div className="dsn-menu" ref={menuRef} role="menu" onKeyDown={event => {
    if (event.key === 'Escape') { event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus(); setMenu(null); event.stopPropagation(); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    {kind === 'document' && <><button role="menuitem" onClick={beginRename} disabled={state.busy}><Pencil />{t('rename')}</button>
      <button role="menuitem" onClick={() => openDialog('copy')} disabled={state.busy}><FileText />{t('saveCopy')}</button><hr /></>}
    <button role="menuitem" onClick={() => { setMenu(null); fileInput.current?.click(); }} disabled={state.busy}><Upload />{t('importMarkdown')}</button>
    <button role="menuitem" onClick={() => { setMenu(null); void controller.openDirectory(); }} disabled={state.busy}><FolderOpen />{t('openExplorer')}</button>
    <button role="menuitem" onClick={() => { setMenu(null); void controller.refresh(); }} disabled={state.busy}><RefreshCw />{t('refresh')}</button>
    <button role="menuitem" onClick={() => openDialog('location')}><Folder />{t('directory')}</button>
    {kind === 'document' && <><hr /><button role="menuitem" className="dsn-danger" onClick={() => openDialog('delete')} disabled={state.busy}><Trash2 />{t('delete')}</button></>}
  </div>;
  return <section className={`dsn-root ${collapsed ? 'dsn-rail-collapsed' : ''}`} aria-label={t('title')}
    onDragEnterCapture={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOverCapture={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy'; } }}
    onDragLeaveCapture={event => { if (event.dataTransfer.types.includes('Files') && --dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDropCapture={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false); void importFiles([...event.dataTransfer.files]); }}
    onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  }}>
    <style>{css}</style>
    <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" multiple hidden onChange={event => { void importFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
    {dragging && <div className="dsn-drop-overlay" role="status"><Upload /><strong>{t(state.busy ? 'busyImport' : 'dropMarkdown')}</strong><span>{t('dropHint')}</span></div>}
    {!collapsed && <aside className="dsn-rail" aria-label={t('list')}>
      <div className="dsn-rail-heading"><h1>{t('title')}</h1><button className="dsn-new" title={t('new')} aria-label={t('new')} disabled={state.busy} onClick={() => void create()}><Plus /><span>{t('newShort')}</span></button></div>
      <nav className="dsn-list">{state.notes.map(note => <button key={note.name} className={`dsn-note ${note.name === state.active ? 'dsn-selected' : ''}`}
        title={note.name} disabled={state.busy} aria-current={note.name === state.active ? 'page' : undefined}
        onDoubleClick={() => { if (note.name === state.active) beginRename(); }}
        onClick={() => { if (note.name !== state.active) void controller.open(note.name); }}><FileText /><span>{note.name.replace(/\.md$/i, '')}</span></button>)}</nav>
      <footer className="dsn-rail-footer"><span>{t('local')} · {t('count', { count: state.notes.length })}</span>
        <div className="dsn-menu-anchor" data-dsn-menu><button className="dsn-icon" aria-label={t('libraryMenu')} aria-expanded={menu === 'rail'} onClick={() => setMenu(menu === 'rail' ? null : 'rail')}><MoreHorizontal /></button>{popover('rail')}</div>
      </footer>
    </aside>}
    <main className="dsn-main" aria-busy={state.busy}>
      <header className="dsn-toolbar">
        <button className="dsn-icon dsn-toggle-list" title={t(collapsed ? 'showList' : 'hideList')} aria-label={t(collapsed ? 'showList' : 'hideList')} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
        <FileText className="dsn-document-icon" />
        {renaming ? <form className="dsn-title-form" onSubmit={e => { e.preventDefault(); void rename(); }}>
          <input ref={titleInput} aria-label={t('name')} value={title} maxLength={180} disabled={state.busy} onChange={e => setTitle(e.target.value)} onBlur={() => void rename()}
            onKeyDown={e => { if (e.key === 'Escape') { cancelledRename.current = true; setRenaming(false); } }} />
        </form> : <button className="dsn-document-title" onClick={beginRename} disabled={!state.active || state.busy} title={t('rename')}>{state.active?.replace(/\.md$/i, '') ?? t('title')}</button>}
        {state.active && <>
          <span className={`dsn-save-state ${dirty && state.error ? 'dsn-status-error' : ''}`} aria-live="polite">{!dirty && !state.saving && <Check />}{t(status)}</span>
          {!reading && <div className="dsn-view-switch" role="group" aria-label={t('editorLabel')}>
            <button title={t('edit')} aria-label={t('edit')} aria-pressed={state.mode === 'edit'} onClick={() => void controller.setMode('edit')}><AlignLeft /></button>
            <button title={t('split')} aria-label={t('split')} aria-pressed={state.mode === 'split'} onClick={() => void controller.setMode('split')}><Columns2 /></button>
          </div>}
          <button className="dsn-primary dsn-edit-toggle" disabled={state.busy} onClick={() => void controller.setMode(reading ? 'edit' : 'preview')}>
            {reading ? <Pencil /> : <Check />}<span>{t(reading ? 'edit' : 'done')}</span>
          </button>
          <div className="dsn-menu-anchor" data-dsn-menu><button className="dsn-icon" title={t('documentMenu')} aria-label={t('documentMenu')} aria-expanded={menu === 'document'} onClick={() => setMenu(menu === 'document' ? null : 'document')}><MoreHorizontal /></button>{popover('document')}</div>
        </>}
      </header>
      {state.error && !dialog && <div className="dsn-error" role="alert"><span>{state.error}</span>{dirty && <><button onClick={save} disabled={state.busy || state.saving}>{t('retry')}</button><button onClick={() => openDialog('copy')} disabled={state.busy || state.saving}>{t('saveCopy')}</button></>}</div>}
      {state.notice && <div className="dsn-notice" role="status"><span>{state.notice}</span><button className="dsn-icon" aria-label={t('close')} onClick={() => controller.dismissNotice()}><X /></button></div>}
      {state.active ? <>
        <div className={`dsn-content dsn-mode-${state.mode}`}>
          {!reading && <div className="dsn-source-pane"><div className="dsn-pane-label">Markdown</div><Suspense fallback={<p className="dsn-rendering">正在打开编辑器…</p>}><MarkdownEditor key={state.active} value={state.content} disabled={state.busy} label={t('content')} onChange={value => controller.edit(value)} onSave={save} /></Suspense></div>}
          {state.mode !== 'edit' && <div className="dsn-reading-pane" ref={readPane}>
            {state.mode === 'split' && <div className="dsn-pane-label">{t('preview')}</div>}
            {state.content ? <Suspense fallback={<p className="dsn-rendering">正在打开预览…</p>}><MarkdownPreview key={state.active} source={deferred} copyLabel={t('copyCode')} /></Suspense> : <div className="dsn-blank"><FileText /><h2>{t('blankTitle')}</h2><p>{t('blankHint')}</p><button onClick={() => void controller.setMode('edit')}><Pencil />{t('edit')}</button></div>}
          </div>}
        </div>
        {!reading && <footer className="dsn-editor-footer"><span>{t('characters', { count: state.content.length })}</span><span>{t('autosaveHint')}</span></footer>}
      </> : <div className="dsn-blank"><FileText /><h2>{!state.loaded && state.busy ? t('loading') : t('empty')}</h2><p>{t('emptyHint')}</p><button className="dsn-primary" disabled={state.busy} onClick={() => void create()}><Plus />{t('new')}</button></div>}
    </main>
    {dialog && <NoteDialog kind={dialog} initial={dialog === 'location' ? state.directory : dialog === 'copy' ? `${state.active?.replace(/\.md$/i, '')} ${t('copy')}` : state.active ?? ''} directory={state.directory} t={t} busy={state.busy} error={dialogError} onClose={() => setDialog(null)} onSubmit={submit} />}
  </section>;
}

