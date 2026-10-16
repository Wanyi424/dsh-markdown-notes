import React, { memo, useMemo } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, Library, MoreHorizontal, Plus } from 'lucide-react';
import type { NotesController } from './controller';
import type { NoteSummary } from './contracts';
import type { Translate } from './dictionaries';
import { baseName, parentFolder } from './note-path';
import { anchorAt, anchorFrom, type MenuAnchor } from './ui';

export interface TreeTarget { kind: 'note' | 'folder' | 'root'; path: string }
export const NOTE_DRAG = 'application/x-dsn-note';
export const stem = (path: string) => baseName(path).replace(/\.md$/i, '');
const depthStyle = (depth: number) => ({ '--depth': Math.min(depth, 10) } as React.CSSProperties);

/** Arrow keys walk the visible rows; Right/Left open, close or climb folders, as in a file explorer. */
function navigate(event: React.KeyboardEvent<HTMLElement>, c: NotesController, expanded: Set<string>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.dsn-row-main')];
  const current = document.activeElement as HTMLButtonElement, index = rows.indexOf(current);
  if (index < 0) return;
  const row = current.closest<HTMLElement>('[data-folder],[data-note]'), folder = row?.dataset.folder;
  const focus = (i: number) => { event.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus(); };
  if (event.key === 'ArrowDown') focus(index + 1);
  else if (event.key === 'ArrowUp') focus(index - 1);
  else if (event.key === 'Home') focus(0);
  else if (event.key === 'End') focus(rows.length - 1);
  else if (event.key === 'ArrowRight' && folder) { event.preventDefault(); if (!expanded.has(folder)) c.toggleFolder(folder, true); else focus(index + 1); }
  else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (folder && expanded.has(folder)) { c.toggleFolder(folder, false); return; }
    const parent = parentFolder(folder ?? row?.dataset.note ?? '');
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-folder="${CSS.escape(parent)}"] .dsn-row-main`)?.focus();
  }
}

export const FolderTree = memo(function FolderTree({ c, t, notes, folders, expanded: open, active, folder, folderFocus, busy, dropTarget, onMenu, onCreateIn, onRename, onDragNote, onPicked }: {
  c: NotesController; t: Translate; notes: NoteSummary[]; folders: string[]; expanded: string[]; active: string | null; folder: string; folderFocus: boolean;
  busy: boolean; dropTarget: string | null; onMenu(target: TreeTarget, anchor: MenuAnchor): void; onCreateIn(folder: string): void; onRename(): void;
  onDragNote(path: string | null): void; onPicked(): void;
}) {
  // Build the index only when the library changes, not on every editor keystroke.
  const children = useMemo(() => {
    const result = new Map<string, { folders: string[]; notes: string[] }>();
    const group = (name: string) => {
      if (!result.has(name)) result.set(name, { folders: [], notes: [] });
      return result.get(name)!;
    };
    for (const name of folders) group(parentFolder(name)).folders.push(name);
    for (const { name } of notes) group(parentFolder(name)).notes.push(name);
    return result;
  }, [notes, folders]);
  const expanded = useMemo(() => new Set(open), [open]);
  const menu = (target: TreeTarget) => (event: React.MouseEvent) => { event.preventDefault(); onMenu(target, anchorAt(event)); };
  const render = (parent: string, depth: number): React.ReactNode => {
    const group = children.get(parent);
    return <ul className="dsn-tree-group" role="group" style={depthStyle(depth - 1)}>
      {group?.folders.map(path => {
        const isOpen = expanded.has(path), name = baseName(path);
        return <li key={path} style={depthStyle(depth)}>
          <div className="dsn-row" data-folder={path} data-selected={(folderFocus && folder === path) || undefined} data-drop={dropTarget === path || undefined}>
            <button type="button" className="dsn-row-main" aria-expanded={isOpen} aria-label={`${t('folder')} ${path}`} title={path} disabled={busy}
              // Decide the new state first: selecting also reveals the folder, which must not cancel the toggle.
              onClick={() => { c.selectFolder(path); c.toggleFolder(path, !isOpen); }} onContextMenu={menu({ kind: 'folder', path })}>
              <ChevronRight className="dsn-chevron" />{isOpen ? <FolderOpen /> : <Folder />}<span>{name}</span>
            </button>
            <span className="dsn-row-actions">
              <button type="button" className="dsn-row-action" aria-label={t('newIn', { folder: name })} title={t('newIn', { folder: name })} disabled={busy} onClick={() => onCreateIn(path)}><Plus /></button>
              <button type="button" className="dsn-row-action" aria-label={t('moreFor', { name })} title={t('moreFor', { name })} aria-haspopup="menu"
                onClick={event => onMenu({ kind: 'folder', path }, anchorFrom(event.currentTarget))}><MoreHorizontal /></button>
            </span>
          </div>
          {isOpen && render(path, depth + 1)}
        </li>;
      })}
      {group?.notes.map(path => {
        const name = stem(path);
        return <li key={path} style={depthStyle(depth)}>
          <div className="dsn-row" data-note={path} draggable={!busy}
            onDragStart={event => { event.dataTransfer.setData(NOTE_DRAG, path); event.dataTransfer.setData('text/plain', name); event.dataTransfer.effectAllowed = 'move'; onDragNote(path); }}
            onDragEnd={() => onDragNote(null)}>
            <button type="button" className="dsn-row-main dsn-note" aria-current={path === active ? 'page' : undefined} title={path} disabled={busy}
              onClick={() => { if (path !== active) void c.open(path); onPicked(); }} onDoubleClick={() => { if (path === active) onRename(); }}
              onContextMenu={menu({ kind: 'note', path })}><FileText /><span>{name}</span></button>
            <span className="dsn-row-actions">
              <button type="button" className="dsn-row-action" aria-label={t('moreFor', { name })} title={t('moreFor', { name })} aria-haspopup="menu"
                onClick={event => onMenu({ kind: 'note', path }, anchorFrom(event.currentTarget))}><MoreHorizontal /></button>
            </span>
          </div>
        </li>;
      })}
      {parent && !group?.folders.length && !group?.notes.length && <li className="dsn-tree-empty" style={depthStyle(depth)}>{t('emptyFolder')}</li>}
    </ul>;
  };
  return <nav className="dsn-tree" aria-label={t('list')} onKeyDown={event => navigate(event, c, expanded)}>
    <div className="dsn-row dsn-root-row" data-folder="" data-selected={(folderFocus && folder === '') || undefined} data-drop={dropTarget === '' || undefined}>
      <button type="button" className="dsn-row-main" aria-label={t('libraryRoot')} disabled={busy} onClick={() => c.selectFolder('')} onContextMenu={menu({ kind: 'root', path: '' })}>
        <Library /><span>{t('libraryRoot')}</span><small>{notes.length}</small>
      </button>
    </div>
    {render('', 0)}
  </nav>;
});

function highlight(text: string, query: string) {
  const at = text.toLowerCase().indexOf(query);
  return at < 0 || !query ? text : <>{text.slice(0, at)}<mark>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

export const FilterResults = memo(function FilterResults({ c, t, matches, active, query, onPicked }: {
  c: NotesController; t: Translate; matches: NoteSummary[]; active: string | null; query: string; onPicked(): void;
}) {
  const q = query.trim().toLowerCase();
  return <div className="dsn-results" role="list" aria-label={t('filter')}>
    <p className="dsn-results-count">{matches.length ? t('filterCount', { count: matches.length }) : t('filterEmpty', { query: query.trim() })}</p>
    {matches.map(note => <button key={note.name} type="button" role="listitem" className="dsn-result" aria-current={note.name === active ? 'page' : undefined} title={note.name}
      onClick={() => { if (note.name !== active) void c.open(note.name); onPicked(); }}>
      <FileText /><span><strong>{highlight(stem(note.name), q)}</strong>{parentFolder(note.name) && <small>{parentFolder(note.name).split('/').join(' / ')}</small>}</span>
    </button>)}
  </div>;
});
