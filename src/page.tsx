import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { BookMarked, BookOpen, CircleAlert, Columns2, CopyPlus, FilePlus2, FileText, Folder, FolderInput, FolderOpen, FolderPlus, LoaderCircle, MoreHorizontal, NotebookPen, Palette, PanelLeftClose, PanelLeftOpen, PenLine, Pencil, Plus, RefreshCw, Search, TableOfContents, Trash2, Upload, X, Copy } from 'lucide-react';
import type { NotesController, ViewMode } from './controller';
import type { Translate } from './dictionaries';
import type { Heading } from './markdown';
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_NOTE_BYTES, type ImportFile } from './contracts';
import { loadChunk } from './lazy-chunk';
import { synchronizeScroll, type EditorScrollPort } from './scroll-sync';
import { AllNotes, FilterResults, FolderTree, NOTE_DRAG, stem, type TreeTarget } from './folder-tree';
import { Outline, OutlineRail, outlineOf } from './outline';
import { Dialog, LayerContext, Menu, Segmented, Toast, anchorFrom, usePresence, type MenuAnchor, type MenuEntry } from './ui';
import { baseName, parentFolder, inFolder } from './note-path';
import css from './styles.css';

const NS = 'markdownNotes';
const MarkdownEditor = lazy(() => loadChunk<typeof import('./editor')>('client.editor.js').then(module => ({ default: module.MarkdownEditor })));
const MarkdownPreview = lazy(() => loadChunk<typeof import('./preview')>('client.preview.js').then(module => ({ default: module.MarkdownPreview })));
const loadSample = () => loadChunk<typeof import('./sample')>('client.sample.js').then(module => module.SAMPLE_CONTENT);
/** Identifies the sample where a note path would; note paths never contain control characters. */
const SAMPLE_DOC = '\0sample';
declare global { interface Window { __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> } } }
export interface ClientContext {
  locale: { register(namespace: string, dict: Record<string, unknown>): () => void; bind(namespace: string): Translate;
    subscribe(listener: () => void): () => void; getSnapshot(): unknown };
  slots: { inject(owner: string, callback: () => unknown): unknown; register(options: Record<string, unknown>, component: React.ComponentType): () => void };
  effect(callback: () => (() => void | Promise<void>), label?: string): unknown;
}
type DialogState = { kind: 'deleteNote' | 'moveNote' | 'renameFolder' | 'deleteFolder'; path: string } | { kind: 'newFolder'; parent: string } | { kind: 'copy' } | { kind: 'location' };
interface OpenMenu { anchor: MenuAnchor; entries: MenuEntry[]; label: string }
const RAIL_KEY = 'dsh-markdown-notes:rail', OUTLINE_KEY = 'dsh-markdown-notes:outline', THEME_KEY = 'dsh-markdown-notes:preview-theme';
/** Preview themes change only how the preview looks; the Markdown file is never touched. */
const THEMES = { default: ['themeDefault', 'themeDefaultHint'], book: ['themeBook', 'themeBookHint'], article: ['themeArticle', 'themeArticleHint'] } as const;
type PreviewTheme = keyof typeof THEMES;
const readTheme = (): PreviewTheme => { try { const value = localStorage.getItem(THEME_KEY); return value && value in THEMES ? value as PreviewTheme : 'default'; } catch { return 'default'; } };
const saveTheme = (theme: PreviewTheme) => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* Preference only. */ } };
const readFlag = (key: string) => { try { return localStorage.getItem(key) !== 'hidden'; } catch { return true; } };
const saveFlag = (key: string, shown: boolean) => { try { localStorage.setItem(key, shown ? 'shown' : 'hidden'); } catch { /* Preference only. */ } };

/** Width of an element, bucketed; state changes only when a breakpoint is crossed. */
function useWidth<T>(element: HTMLElement | null, bucket: (width: number) => T, initial: T): T {
  const [value, setValue] = useState(initial);
  useLayoutEffect(() => {
    if (!element) return;
    setValue(bucket(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => setValue(bucket(entry.contentRect.width)));
    observer.observe(element); return () => observer.disconnect();
  }, [element]);
  return value;
}
function countLines(text: string) { let lines = 1; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lines++; return lines; }

function NameDialog({ title, label, initial, note, t, busy, error, onClose, onSubmit }: {
  title: string; label: string; initial: string; note?: string; t: Translate; busy: boolean; error: string; onClose(): void; onSubmit(value: string): void;
}) {
  const [value, setValue] = useState(initial), id = useId();
  return <Dialog title={title} closeLabel={t('close')} busy={busy} onClose={onClose} onSubmit={() => { if (value.trim()) onSubmit(value); }} footer={<>
    <button type="button" className="dsn-button" disabled={busy} onClick={onClose}>{t('cancel')}</button>
    <button type="submit" className="dsn-button dsn-button-primary" disabled={busy || !value.trim()}>{t('confirm')}</button>
  </>}>
    {note && <p className="dsn-hint">{note}</p>}
    <div className="dsn-field"><label htmlFor={id}>{label}</label>
      <input id={id} className="dsn-input" data-autofocus value={value} maxLength={180} required disabled={busy} onChange={event => setValue(event.target.value)}
        onFocus={event => event.currentTarget.select()} /></div>
    {error && <p className="dsn-dialog-error" role="alert">{error}</p>}
  </Dialog>;
}

function ConfirmDialog({ title, body, t, busy, error, onClose, onSubmit }: { title: string; body: string; t: Translate; busy: boolean; error: string; onClose(): void; onSubmit(): void }) {
  return <Dialog title={title} closeLabel={t('close')} busy={busy} onClose={onClose} onSubmit={onSubmit} footer={<>
    <button type="button" className="dsn-button" data-autofocus disabled={busy} onClick={onClose}>{t('cancel')}</button>
    <button type="submit" className="dsn-button dsn-button-danger" disabled={busy}>{t('delete')}</button>
  </>}>
    <p className="dsn-dialog-text">{body}</p>
    {error && <p className="dsn-dialog-error" role="alert">{error}</p>}
  </Dialog>;
}

/** Destination picker as an indented list of real folders; the current location is shown but not selectable. */
function MoveDialog({ path, folders, t, busy, error, onClose, onSubmit }: { path: string; folders: string[]; t: Translate; busy: boolean; error: string; onClose(): void; onSubmit(folder: string): void }) {
  const current = parentFolder(path), [value, setValue] = useState<string | null>(null), name = useId();
  const options = ['', ...folders];
  return <Dialog title={t('moveTitle')} closeLabel={t('close')} busy={busy} onClose={onClose} onSubmit={() => { if (value !== null) onSubmit(value); }} footer={<>
    <button type="button" className="dsn-button" disabled={busy} onClick={onClose}>{t('cancel')}</button>
    <button type="submit" className="dsn-button dsn-button-primary" disabled={busy || value === null}>{t('move')}</button>
  </>}>
    <p className="dsn-hint">{t('moveHint', { name: stem(path) })}</p>
    <div className="dsn-destinations" role="radiogroup" aria-label={t('moveTitle')}>
      {options.map(folder => <label key={folder || '/'} className="dsn-destination" data-current={folder === current || undefined} style={{ '--depth': folder ? folder.split('/').length : 0 } as React.CSSProperties}>
        <input type="radio" name={name} value={folder} checked={value === folder} disabled={busy || folder === current} onChange={() => setValue(folder)} data-autofocus={value === null && folder !== current ? true : undefined} />
        {folder ? <Folder /> : <FolderOpen />}<span>{folder ? baseName(folder) : t('rootFolder')}</span>{folder === current && <small>{t('currentLocation')}</small>}
      </label>)}
    </div>
    {error && <p className="dsn-dialog-error" role="alert">{error}</p>}
  </Dialog>;
}

function LocationDialog({ directory, t, busy, error, onClose, onSubmit }: { directory: string; t: Translate; busy: boolean; error: string; onClose(): void; onSubmit(value: string): void }) {
  const [value, setValue] = useState(directory), [picking, setPicking] = useState(false), [pickError, setPickError] = useState(''), id = useId();
  const choose = async () => {
    setPicking(true); setPickError('');
    try { const path = await window.__DSH_DIRECTORY_PICKER__?.pick(); if (path) setValue(path); }
    catch (reason) { setPickError(reason instanceof Error ? reason.message : String(reason)); } finally { setPicking(false); }
  };
  const blocked = busy || picking;
  return <Dialog title={t('locationTitle')} closeLabel={t('close')} busy={blocked} onClose={onClose} onSubmit={() => { if (value.trim() && value.trim() !== directory) onSubmit(value); }} footer={<>
    <button type="button" className="dsn-button" disabled={blocked} onClick={onClose}>{t('cancel')}</button>
    <button type="submit" className="dsn-button dsn-button-primary" disabled={blocked || !value.trim() || value.trim() === directory}>{busy ? <><LoaderCircle className="dsn-spin" />{t('migrating')}</> : t('migrate')}</button>
  </>}>
    <p className="dsn-dialog-text">{t('locationHint')}</p>
    <code className="dsn-path">{directory}</code>
    <div className="dsn-field"><label htmlFor={id}>{t('newDirectory')}</label><div className="dsn-input-row">
      <input id={id} className="dsn-input" data-autofocus aria-label={t('newDirectory')} value={value} disabled={blocked} placeholder="D:\Notes" onChange={event => setValue(event.target.value)} />
      {window.__DSH_DIRECTORY_PICKER__ && <button type="button" className="dsn-button dsn-button-secondary" disabled={blocked} onClick={() => void choose()}><Folder />{picking ? t('picking') : t('chooseDirectory')}</button>}
    </div></div>
    <p className="dsn-hint">{t('migrationHint')}</p>
    {(error || pickError) && <p className="dsn-dialog-error" role="alert">{error || pickError}</p>}
  </Dialog>;
}

export function NotesPage({ controller: c, ctx }: { controller: NotesController; ctx: ClientContext }) {
  const state = useSyncExternalStore(c.subscribe, c.getSnapshot);
  const subscribeLocale = useCallback((listener: () => void) => ctx.locale.subscribe(listener), [ctx]);
  const locale = useSyncExternalStore(subscribeLocale, () => ctx.locale.getSnapshot());
  // Stable per locale, so memoized children (the tree) do not re-render on every keystroke.
  const t = useMemo(() => ctx.locale.bind(NS), [ctx, locale]);
  const [root, setRoot] = useState<HTMLElement | null>(null), [main, setMain] = useState<HTMLElement | null>(null);
  // Unknown until measured (before the first paint), so the rail never renders from a guessed width and then animates away.
  const layout = useWidth<'wide' | 'narrow' | 'tiny' | null>(root, width => width >= 760 ? 'wide' : width >= 560 ? 'narrow' : 'tiny', null);
  const roomy = useWidth(main, width => width >= 960, true);
  const [railPref, setRailPref] = useState(() => readFlag(RAIL_KEY)), [railOverlay, setRailOverlay] = useState(false);
  const [outlinePref, setOutlinePref] = useState(() => readFlag(OUTLINE_KEY));
  const [theme, setTheme] = useState(readTheme), [tocOpen, setTocOpen] = useState(false), tocButton = useRef<HTMLButtonElement>(null);
  const closeToc = useCallback((restoreFocus: boolean) => { setTocOpen(false); if (restoreFocus) tocButton.current?.focus(); }, []);
  const [dialog, setDialog] = useState<DialogState | null>(null), [dialogError, setDialogError] = useState('');
  const [menu, setMenu] = useState<OpenMenu | null>(null), shownMenu = usePresence(menu);
  // A trigger's second click closes its own menu; a context menu reopens wherever it was asked for.
  const openMenu = (next: OpenMenu) => setMenu(current => next.anchor.toggle && current?.anchor.trigger === next.anchor.trigger ? null : next);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [query, setQuery] = useState(''), filterInput = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false), [title, setTitle] = useState('');
  const titleInput = useRef<HTMLInputElement>(null), cancelledRename = useRef(false);
  const readPane = useRef<HTMLDivElement>(null);
  const [editorPort, setEditorPort] = useState<EditorScrollPort | null>(null), [previewPane, setPreviewPane] = useState<HTMLDivElement | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const readingRef = useCallback((element: HTMLDivElement | null) => { readPane.current = element; setPreviewPane(element); }, []);
  const fileInput = useRef<HTMLInputElement>(null), importTarget = useRef(''), importing = useRef(false);
  const dragNote = useRef<string | null>(null), fileDepth = useRef(0);
  const [dragKind, setDragKind] = useState<'files' | 'note' | null>(null), [dropTarget, setDropTarget] = useState<string | null>(null);
  const wide = layout === 'wide', railShown = wide ? railPref : railOverlay, reading = state.mode === 'preview', rail = usePresence(railShown);
  // The document on screen: the open note or the sample. None while 全部笔记 is shown, which counts only once the library has
  // loaded: at startup the note edited last opens instead, and the page must not flash 全部笔记 first.
  const sample = state.view === 'sample', doc = sample ? SAMPLE_DOC : state.active, library = state.view === 'library' && state.loaded;
  // The rail column animates only after the first frame, so measuring the real width at startup does not slide the page.
  const [settled, setSettled] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setSettled(true)); return () => cancelAnimationFrame(frame); }, []);
  const dirty = state.content !== state.saved;
  useEffect(() => { if (wide) setRailOverlay(false); }, [wide]);
  useEffect(() => {
    if (state.mode === 'split' && editorPort && previewPane) return synchronizeScroll(editorPort, previewPane);
  }, [state.mode, doc, editorPort, previewPane]);
  const [preview, setPreview] = useState({ name: doc, content: state.content });
  useEffect(() => {
    if (state.mode === 'edit') return;
    const timer = setTimeout(() => setPreview({ name: doc, content: state.content }), state.mode === 'split' && doc === preview.name ? 300 : 0);
    return () => clearTimeout(timer);
  }, [doc, state.content, state.mode]);
  const deferred = preview.name === doc ? preview.content : state.content;
  const save = () => { void c.flush().catch(() => {}); };
  useEffect(() => { void c.load(); return () => { void c.flush().catch(() => {}); }; }, [c]);
  useEffect(() => { readPane.current?.scrollTo({ top: 0 }); setRenaming(false); }, [doc]);
  useEffect(() => setTocOpen(false), [doc, state.mode, roomy]);
  useEffect(() => { if (renaming) { titleInput.current?.focus(); titleInput.current?.select(); } }, [renaming]);
  // Leaving the editor removes the focused element; hand focus to the article so Ctrl+E and paging keys keep working.
  // A layout effect runs in the same commit as the removal, so no key press can land on <body> in between.
  useLayoutEffect(() => {
    if (state.mode === 'preview' && (!document.activeElement || document.activeElement === document.body)) readPane.current?.focus({ preventScroll: true });
  }, [state.mode]);
  // While a note is dragged over a collapsed folder, open it after a short dwell.
  useEffect(() => {
    if (dragKind !== 'note' || !dropTarget || state.expanded.includes(dropTarget)) return;
    const timer = setTimeout(() => c.toggleFolder(dropTarget, true), 650);
    return () => clearTimeout(timer);
  }, [dragKind, dropTarget, state.expanded, c]);

  const toggleRail = useCallback(() => {
    if (wide) setRailPref(shown => { saveFlag(RAIL_KEY, !shown); return !shown; }); else setRailOverlay(shown => !shown);
  }, [wide]);
  const picked = useCallback(() => setRailOverlay(false), []);
  const openSample = () => { if (!sample) void c.showSample(loadSample); picked(); };
  const beginRename = useCallback(() => {
    const active = c.getSnapshot().active; if (!active) return;
    setMenu(null); cancelledRename.current = false; setTitle(stem(active)); setRenaming(true);
  }, [c]);
  const rename = async () => {
    if (cancelledRename.current || state.busy || !state.active) return;
    if (title.trim() === stem(state.active)) { setRenaming(false); return; }
    if (await c.renameNote(state.active, title)) setRenaming(false);
  };
  const create = useCallback(async (folder = c.getSnapshot().folder) => {
    const notes = c.getSnapshot().notes;
    let suffix = 1, name = t('unnamed');
    while (notes.some(note => note.name.toLowerCase() === inFolder(folder, `${name}.md`).toLowerCase())) name = `${t('unnamed')} ${++suffix}`;
    if (await c.create(name, folder)) { setQuery(''); setRailOverlay(false); }
  }, [c, t]);
  const createIn = useCallback((folder: string) => void create(folder), [create]);
  const openDialog = (next: DialogState) => { setMenu(null); setDialogError(''); setDialog(next); };
  const closeDialog = () => { setDialog(null); if (dialogError) c.dismissError(); setDialogError(''); };
  const submit = async (value = '') => {
    if (!dialog) return;
    const ok = dialog.kind === 'copy' ? await c.saveCopy(value) : dialog.kind === 'location' ? await c.migrate(value)
      : dialog.kind === 'newFolder' ? await c.createFolder(value, dialog.parent) : dialog.kind === 'renameFolder' ? await c.renameFolder(dialog.path, value)
      : dialog.kind === 'deleteFolder' ? await c.deleteFolder(dialog.path) : dialog.kind === 'moveNote' ? await c.moveNote(dialog.path, value) : await c.deleteNote(dialog.path);
    if (ok) setDialog(null); else setDialogError(c.getSnapshot().error);
  };
  const importFiles = async (files: File[], folder: string) => {
    if (state.busy || importing.current) { c.reportError(t('busyImport')); return; }
    const accepted = files.filter(file => /\.(md|markdown)$/i.test(file.name));
    if (!accepted.length) { c.reportError(t('markdownOnly')); return; }
    if (accepted.length > MAX_IMPORT_FILES || accepted.some(file => file.size > MAX_NOTE_BYTES) || accepted.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BYTES) { c.reportError(t('importLimit')); return; }
    importing.current = true;
    try {
      const contents: ImportFile[] = [];
      for (const file of accepted) contents.push({ name: file.name, content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) });
      await c.importFiles(contents, folder);
    } catch (error) { c.reportError(error instanceof TypeError ? t('utf8Only') : String(error)); }
    finally { importing.current = false; }
  };
  const pickImport = (folder: string) => { setMenu(null); importTarget.current = folder; fileInput.current?.click(); };
  const showMenu = (label: string, entries: MenuEntry[]) => (anchor: MenuAnchor) => openMenu({ anchor, entries, label });
  const noteEntries = (path: string): MenuEntry[] => [
    ...(path !== state.active ? [{ label: t('open'), icon: <FileText />, onSelect: () => { void c.open(path); picked(); } }] : []),
    { label: t('rename'), icon: <Pencil />, disabled: state.busy, onSelect: () => { if (path === state.active) beginRename(); else void c.open(path).then(ok => { if (ok) beginRename(); }); } },
    { label: t('moveNote'), icon: <FolderInput />, disabled: state.busy, onSelect: () => openDialog({ kind: 'moveNote', path }) },
    'separator',
    { label: t('delete'), icon: <Trash2 />, danger: true, disabled: state.busy, onSelect: () => openDialog({ kind: 'deleteNote', path }) },
  ];
  const folderEntries = (path: string): MenuEntry[] => [
    { label: t('new'), icon: <FilePlus2 />, disabled: state.busy, onSelect: () => void create(path) },
    { label: t('newSubfolder'), icon: <FolderPlus />, disabled: state.busy, onSelect: () => openDialog({ kind: 'newFolder', parent: path }) },
    { label: t('importHere'), icon: <Upload />, disabled: state.busy, onSelect: () => pickImport(path) },
    'separator',
    { label: t('renameFolder'), icon: <Pencil />, disabled: state.busy, onSelect: () => openDialog({ kind: 'renameFolder', path }) },
    { label: t('deleteFolder'), icon: <Trash2 />, danger: true, disabled: state.busy, onSelect: () => openDialog({ kind: 'deleteFolder', path }) },
  ];
  const libraryEntries = (): MenuEntry[] => [
    { label: t('newFolder'), icon: <FolderPlus />, disabled: state.busy, onSelect: () => openDialog({ kind: 'newFolder', parent: state.folder }) },
    { label: t('importMarkdown'), icon: <Upload />, disabled: state.busy, onSelect: () => pickImport(state.folder) },
    'separator',
    { label: t('refresh'), icon: <RefreshCw />, disabled: state.busy, onSelect: () => void c.refresh() },
    { label: t('openExplorer'), icon: <FolderOpen />, disabled: state.busy, onSelect: () => void c.openDirectory() },
    { label: t('directory'), icon: <Folder />, onSelect: () => openDialog({ kind: 'location' }) },
  ];
  const documentEntries = (): MenuEntry[] => state.active ? [
    { label: t('rename'), icon: <Pencil />, disabled: state.busy, onSelect: beginRename },
    { label: t('moveNote'), icon: <FolderInput />, disabled: state.busy, onSelect: () => openDialog({ kind: 'moveNote', path: state.active! }) },
    { label: t('saveCopy'), icon: <Copy />, disabled: state.busy, onSelect: () => openDialog({ kind: 'copy' }) },
    'separator',
    { label: t('delete'), icon: <Trash2 />, danger: true, disabled: state.busy, onSelect: () => openDialog({ kind: 'deleteNote', path: state.active! }) },
  ] : [];
  const onTreeMenu = (target: TreeTarget, anchor: MenuAnchor) => {
    const name = target.kind === 'root' ? t('libraryRoot') : target.kind === 'note' ? stem(target.path) : baseName(target.path);
    const entries = target.kind === 'note' ? noteEntries(target.path) : target.kind === 'folder' ? folderEntries(target.path) : [
      { label: t('new'), icon: <FilePlus2 />, disabled: state.busy, onSelect: () => void create('') },
      { label: t('newFolder'), icon: <FolderPlus />, disabled: state.busy, onSelect: () => openDialog({ kind: 'newFolder', parent: '' }) },
      { label: t('importMarkdown'), icon: <Upload />, disabled: state.busy, onSelect: () => pickImport('') },
    ] as MenuEntry[];
    openMenu({ anchor, entries, label: t('moreFor', { name }) });
  };
  const treeMenu = useRef(onTreeMenu); treeMenu.current = onTreeMenu;
  const stableTreeMenu = useCallback((target: TreeTarget, anchor: MenuAnchor) => treeMenu.current(target, anchor), []);
  const onDragNote = useCallback((path: string | null) => { dragNote.current = path; setDragKind(path ? 'note' : null); if (!path) setDropTarget(null); }, []);
  const folderAt = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-folder]')?.getAttribute('data-folder') : null) ?? null;
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    const found = state.notes.filter(note => note.name.toLowerCase().includes(q));
    // Title matches first, then notes found through their folder path.
    return found.sort((a, b) => Number(!stem(a.name).toLowerCase().includes(q)) - Number(!stem(b.name).toLowerCase().includes(q))).slice(0, 200);
  }, [state.notes, q]);
  const outline = useMemo(() => outlineOf(headings), [headings]);
  // Contents: docked beside the article when reading with room for it, otherwise ticks on the right edge of the preview.
  const previewShown = !!doc && state.mode !== 'edit' && !!state.content, hasOutline = previewShown && outline.length >= 2, dockable = reading && roomy;
  const docked = hasOutline && dockable && outlinePref, railed = hasOutline && !docked, tocPressed = dockable ? outlinePref : tocOpen;
  const toggleOutline = () => { if (dockable) setOutlinePref(shown => { saveFlag(OUTLINE_KEY, !shown); return !shown; }); else setTocOpen(open => !open); };
  const themeEntries = (): MenuEntry[] => (Object.keys(THEMES) as PreviewTheme[]).map(value => ({
    label: t(THEMES[value][0]), hint: t(THEMES[value][1]), checked: value === theme, onSelect: () => { setTheme(value); saveTheme(value); },
  }));
  const status = state.saving ? 'saving' : dirty ? state.error ? 'failed' : 'pending' : 'saved';
  const dropName = dropTarget === null ? '' : dropTarget ? baseName(dropTarget) : t('rootFolder');
  const crumbs = state.active ? parentFolder(state.active).split('/').filter(Boolean) : [];
  const targetFolder = state.folder ? baseName(state.folder) : t('rootFolder');

  // Docked, the rail's column animates its width (transitionend on the root); as a drawer, the rail animates itself.
  return <section ref={setRoot} className="dsn-root" data-layout={layout ?? undefined} data-rail={railShown ? 'shown' : 'hidden'} data-animate={settled || undefined} data-dragging={dragKind ?? undefined} aria-label={t('title')}
    onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'grid-template-columns') rail.settle(); }}
    onDragEnterCapture={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); fileDepth.current++; setDragKind('files'); } }}
    onDragOverCapture={event => {
      const types = event.dataTransfer.types;
      if (types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy'; setDropTarget(folderAt(event.target) ?? state.folder); return; }
      const path = dragNote.current;
      if (!types.includes(NOTE_DRAG) || !path) return;
      const target = folderAt(event.target), valid = target !== null && target !== parentFolder(path) && !state.busy;
      if (valid) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
      setDropTarget(valid ? target : null);
    }}
    onDragLeaveCapture={event => { if (event.dataTransfer.types.includes('Files') && --fileDepth.current <= 0) { fileDepth.current = 0; setDragKind(null); setDropTarget(null); } }}
    onDropCapture={event => {
      const types = event.dataTransfer.types;
      if (types.includes('Files')) {
        event.preventDefault(); event.stopPropagation();
        const target = folderAt(event.target) ?? state.folder;
        fileDepth.current = 0; setDragKind(null); setDropTarget(null); void importFiles([...event.dataTransfer.files], target); return;
      }
      const path = dragNote.current;
      if (!types.includes(NOTE_DRAG) || !path) return;
      event.preventDefault();
      const target = folderAt(event.target); onDragNote(null);
      if (target !== null && target !== parentFolder(path)) void c.moveNote(path, target);
    }}
    onKeyDown={event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || (event.target as Element).closest('dialog')) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); save(); }
      else if (key === 'e' && doc) { event.preventDefault(); void c.toggleEditing(); }
    }}>
    <style>{css}</style>
    <LayerContext.Provider value={root}>
      <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" multiple hidden onChange={event => { void importFiles([...(event.target.files ?? [])], importTarget.current); event.target.value = ''; }} />
      {rail.value && <div className="dsn-rail-slot"><aside className="dsn-rail" data-overlay={!wide || undefined} data-leaving={rail.leaving || undefined} inert={rail.leaving} aria-label={t('list')}
        onAnimationEnd={event => { if (rail.leaving && event.target === event.currentTarget) rail.settle(); }}>
        <header className="dsn-rail-head">
          <h1>{t('title')}</h1>
          <button type="button" className="dsn-icon-button" aria-label={t('new')} title={t('newIn', { folder: targetFolder })} disabled={state.busy} onClick={() => void create()}><Plus /></button>
          <button type="button" className="dsn-icon-button" aria-label={t('libraryMenu')} title={t('libraryMenu')} aria-haspopup="menu" onClick={event => showMenu(t('libraryMenu'), libraryEntries())(anchorFrom(event.currentTarget))}><MoreHorizontal /></button>
        </header>
        <div className="dsn-filter"><Search />
          <input ref={filterInput} type="search" value={query} placeholder={t('filter')} aria-label={t('filter')} spellCheck={false} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
              else if (event.key === 'Enter' && matches[0]) { event.preventDefault(); void c.open(matches[0].name); picked(); }
              else if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.closest('.dsn-rail')?.querySelector<HTMLButtonElement>('.dsn-result, .dsn-row-main')?.focus(); }
            }} />
          {query && <button type="button" className="dsn-filter-clear" aria-label={t('clearFilter')} title={t('clearFilter')} onClick={() => { setQuery(''); filterInput.current?.focus(); }}><X /></button>}
        </div>
        <div className="dsn-rail-body">
          {q ? <FilterResults c={c} t={t} matches={matches} active={state.active} query={query} onPicked={picked} />
            : <FolderTree c={c} t={t} notes={state.notes} folders={state.folders} expanded={state.expanded} active={state.active} library={library} folder={state.folder}
              folderFocus={state.folderFocus} busy={state.busy} dropTarget={dropTarget} onMenu={stableTreeMenu} onCreateIn={createIn} onRename={beginRename} onDragNote={onDragNote} onPicked={picked} />}
        </div>
        {/* The built-in sample lives outside the tree: it is not a file in the library. */}
        <footer className="dsn-rail-foot">
          <button type="button" className="dsn-rail-link" aria-current={sample ? 'page' : undefined} disabled={state.busy} onClick={openSample}><BookMarked /><span>{t('sample')}</span></button>
        </footer>
      </aside></div>}
      {rail.value && !wide && <button type="button" className="dsn-scrim" data-leaving={rail.leaving || undefined} aria-label={t('hideList')} onClick={() => setRailOverlay(false)} />}
      <main ref={setMain} className="dsn-main" aria-busy={state.busy}>
        <header className="dsn-bar">
          <button type="button" className="dsn-icon-button" title={t(railShown ? 'hideList' : 'showList')} aria-label={t(railShown ? 'hideList' : 'showList')} onClick={toggleRail}>{railShown ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
          {library && <div className="dsn-heading"><h2 className="dsn-view-title">{t('libraryRoot')}</h2><span className="dsn-tag">{t('count', { count: state.notes.length })}</span></div>}
          {library && state.notes.length > 0 && <button type="button" className="dsn-button dsn-tool" title={t('newIn', { folder: targetFolder })} disabled={state.busy} onClick={() => void create()}><Plus /><span>{t('new')}</span></button>}
          {sample && <div className="dsn-heading"><h2 className="dsn-view-title">{t('sample')}</h2><span className="dsn-tag">{t('sampleTag')}</span></div>}
          {state.active && <div className="dsn-heading">
            {crumbs.length > 0 && <nav className="dsn-crumbs" aria-label={t('folder')}>{crumbs.map((part, i) => {
              const path = crumbs.slice(0, i + 1).join('/');
              return <React.Fragment key={path}><button type="button" className="dsn-crumb" title={path} onClick={() => c.selectFolder(path)}>{part}</button><span aria-hidden>/</span></React.Fragment>;
            })}</nav>}
            {renaming ? <form className="dsn-title-form" onSubmit={event => { event.preventDefault(); void rename(); }}>
              <input ref={titleInput} aria-label={t('name')} value={title} maxLength={180} disabled={state.busy} onChange={event => setTitle(event.target.value)} onBlur={() => void rename()}
                onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancelledRename.current = true; setRenaming(false); } }} />
            </form> : <button type="button" className="dsn-document-title" onClick={beginRename} disabled={state.busy} title={`${t('rename')} · ${state.active}`}>{stem(state.active)}</button>}
          </div>}
          {doc && <>
            {!sample && <span className="dsn-save" data-state={status} aria-live="polite"><i aria-hidden />{t(status)}</span>}
            {hasOutline && <button ref={tocButton} type="button" className="dsn-button dsn-tool" data-outline-toggle aria-pressed={tocPressed} title={t(tocPressed ? 'hideOutline' : 'showOutline')}
              onClick={toggleOutline}><TableOfContents /><span>{t('outline')}</span></button>}
            {previewShown && <button type="button" className="dsn-button dsn-tool dsn-theme-tool" aria-haspopup="menu" title={t('themeMenu')}
              onClick={event => showMenu(t('themeMenu'), themeEntries())(anchorFrom(event.currentTarget))}><Palette /><span>{t('previewTheme')}</span></button>}
            {/* The sample is read-only: reading, or its source beside the rendering. */}
            <Segmented<ViewMode> label={t('modeLabel')} value={state.mode} disabled={state.busy} onChange={mode => void c.setMode(mode)} options={[
              { value: 'preview', label: t('read'), icon: <BookOpen />, title: `${t('read')} · Ctrl+E` },
              ...(sample ? [] : [{ value: 'edit' as const, label: t('edit'), icon: <PenLine />, title: `${t('edit')} · Ctrl+E` }]),
              { value: 'split', label: t('split'), icon: <Columns2 />, title: sample ? `${t('split')} · Ctrl+E` : undefined },
            ]} />
            {sample ? <button type="button" className="dsn-button dsn-button-secondary dsn-tool" title={t('saveSampleIn', { folder: targetFolder })} disabled={state.busy}
              onClick={() => void c.saveSample(`${t('sample')}.md`)}><CopyPlus /><span>{t('saveSample')}</span></button>
              : <button type="button" className="dsn-icon-button" title={t('documentMenu')} aria-label={t('documentMenu')} aria-haspopup="menu"
                onClick={event => showMenu(t('documentMenu'), documentEntries())(anchorFrom(event.currentTarget))}><MoreHorizontal /></button>}
          </>}
        </header>
        {state.error && !dialog && <div className="dsn-banner" role="alert"><CircleAlert /><span>{state.error}</span>
          {dirty && <><button type="button" className="dsn-button dsn-button-secondary" onClick={save} disabled={state.busy || state.saving}>{t('retry')}</button>
            <button type="button" className="dsn-button dsn-button-secondary" onClick={() => openDialog({ kind: 'copy' })} disabled={state.busy || state.saving}>{t('saveCopy')}</button></>}
          <button type="button" className="dsn-icon-button" aria-label={t('close')} onClick={c.dismissError}><X /></button></div>}
        {dragKind === 'files' && <div className="dsn-drop" role="status"><Upload /><strong>{state.busy ? t('busyImport') : t('dropInto', { folder: dropName })}</strong><span>{t('dropHint')}</span></div>}
        {doc ? <>
          <div className={`dsn-content dsn-mode-${state.mode}`}>
            {!reading && <div className="dsn-source-pane"><Suspense fallback={<p className="dsn-rendering">…</p>}>
              <MarkdownEditor key={doc} value={state.content} disabled={state.busy || sample} label={t('content')} placeholder={t('placeholder')} onChange={value => c.edit(value)} onSave={save} onReady={setEditorPort} />
            </Suspense></div>}
            {state.mode !== 'edit' && <div className="dsn-reading" data-rail={railed || undefined}><div className={`dsn-reading-pane dsn-theme-${theme}`} ref={readingRef} tabIndex={-1}>
              <div className="dsn-reading-layout">
                <div className="dsn-reading-main">
                  {state.content ? <Suspense fallback={<p className="dsn-rendering">…</p>}><MarkdownPreview key={doc} source={deferred} copyLabel={t('copyCode')} onHeadings={setHeadings} /></Suspense>
                    : <div className="dsn-blank"><FileText /><h2>{t('blankTitle')}</h2><p>{t('blankHint')}</p>
                      <button type="button" className="dsn-button dsn-button-secondary" onClick={() => void c.setMode('edit')}><PenLine />{t('edit')}</button></div>}
                </div>
                {docked && <Outline headings={outline} pane={previewPane} label={t('outline')} />}
              </div>
            </div>
            {railed && <OutlineRail headings={outline} pane={previewPane} label={t('outline')} open={tocOpen} onClose={closeToc} />}</div>}
          </div>
          {!reading && <footer className="dsn-status"><span>{t('characters', { count: state.content.length.toLocaleString() })} · {t('lines', { count: countLines(state.content).toLocaleString() })}</span><span>{t(sample ? 'sampleHint' : 'autosaveHint')}</span></footer>}
        </> : state.notes.length ? <AllNotes c={c} t={t} notes={state.notes} busy={state.busy} /> : <div className="dsn-welcome">
          {!state.loaded && state.busy ? <><LoaderCircle className="dsn-spin" /><p>{t('loading')}</p></> : <>
            <span className="dsn-welcome-mark"><NotebookPen /></span><h2>{t('empty')}</h2><p>{t('emptyHint')}</p>
            <div className="dsn-actions">
              <button type="button" className="dsn-button dsn-button-primary" disabled={state.busy} onClick={() => void create()}><Plus />{t('new')}</button>
              <button type="button" className="dsn-button dsn-button-secondary" disabled={state.busy} onClick={() => pickImport(state.folder)}><Upload />{t('importMarkdown')}</button>
            </div>
            <button type="button" className="dsn-link" disabled={state.busy} onClick={openSample}><BookMarked />{t('sampleLink')}</button>
          </>}
        </div>}
      </main>
      <Toast message={state.notice} closeLabel={t('close')} onDismiss={c.dismissNotice} />
      {shownMenu.value && <Menu anchor={shownMenu.value.anchor} entries={shownMenu.value.entries} label={shownMenu.value.label} onClose={closeMenu} leaving={shownMenu.leaving} onExited={shownMenu.settle} />}
      {dialog && (dialog.kind === 'deleteNote' || dialog.kind === 'deleteFolder') && <ConfirmDialog t={t} busy={state.busy} error={dialogError} onClose={closeDialog} onSubmit={() => void submit()}
        title={t(dialog.kind === 'deleteNote' ? 'deleteTitle' : 'deleteFolder')} body={t(dialog.kind === 'deleteNote' ? 'deleteHint' : 'deleteFolderHint', { name: dialog.kind === 'deleteNote' ? stem(dialog.path) : dialog.path })} />}
      {dialog?.kind === 'moveNote' && <MoveDialog path={dialog.path} folders={state.folders} t={t} busy={state.busy} error={dialogError} onClose={closeDialog} onSubmit={value => void submit(value)} />}
      {dialog?.kind === 'location' && <LocationDialog directory={state.directory} t={t} busy={state.busy} error={dialogError} onClose={closeDialog} onSubmit={value => void submit(value)} />}
      {dialog && (dialog.kind === 'newFolder' || dialog.kind === 'renameFolder' || dialog.kind === 'copy') && <NameDialog t={t} busy={state.busy} error={dialogError} onClose={closeDialog} onSubmit={value => void submit(value)}
        title={t(dialog.kind === 'copy' ? 'copyTitle' : dialog.kind)} label={t(dialog.kind === 'copy' ? 'name' : 'folderName')}
        note={dialog.kind === 'newFolder' ? `${t('folder')}：${dialog.parent ? dialog.parent.split('/').join(' / ') : t('rootFolder')}` : undefined}
        initial={dialog.kind === 'renameFolder' ? baseName(dialog.path) : dialog.kind === 'copy' ? `${stem(state.active ?? '')} ${t('copy')}` : ''} />}
    </LayerContext.Provider>
  </section>;
}
