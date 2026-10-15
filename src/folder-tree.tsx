import React, { useMemo } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import type { NotesState, NotesController } from './controller';
import type { Translate } from './dictionaries';
import { baseName, parentFolder } from './note-path';

export function FolderTree({ state, controller, t, onRename }: {
  state: NotesState; controller: NotesController; t: Translate; onRename(): void;
}) {
  // Build the index only when the library changes, not on every editor keystroke.
  const children = useMemo(() => {
    const result = new Map<string, { folders: string[]; notes: string[] }>();
    const group = (name: string) => {
      if (!result.has(name)) result.set(name, { folders: [], notes: [] });
      return result.get(name)!;
    };
    for (const name of state.folders) group(parentFolder(name)).folders.push(name);
    for (const { name } of state.notes) group(parentFolder(name)).notes.push(name);
    return result;
  }, [state.notes, state.folders]);
  const expanded = new Set(state.expanded);
  const render = (parent: string, depth: number): React.ReactNode => {
    const group = children.get(parent);
    return <ul className="dsn-tree-group">
      {group?.folders.map(folder => <li key={folder}>
        <div className={`dsn-folder-row ${state.folder === folder ? 'dsn-folder-selected' : ''}`} style={{ paddingLeft: Math.min(depth, 8) * 14 }}>
          <button className="dsn-folder-toggle" aria-label={`${t(expanded.has(folder) ? 'collapseFolder' : 'expandFolder')} ${baseName(folder)}`}
            aria-expanded={expanded.has(folder)} onClick={() => controller.toggleFolder(folder)}>{expanded.has(folder) ? <ChevronDown /> : <ChevronRight />}</button>
          <button className="dsn-folder-name" title={folder} disabled={state.busy} aria-label={`${t('folder')} ${folder}`} aria-pressed={state.folder === folder}
            onClick={() => controller.selectFolder(folder)}>{expanded.has(folder) ? <FolderOpen /> : <Folder />}<span>{baseName(folder)}</span></button>
        </div>
        {expanded.has(folder) && render(folder, depth + 1)}
      </li>)}
      {group?.notes.map(name => <li key={name}>
        <button className={`dsn-note ${name === state.active ? 'dsn-selected' : ''}`} style={{ paddingLeft: 24 + Math.min(depth, 8) * 14 }}
          title={name} disabled={state.busy} aria-current={name === state.active ? 'page' : undefined}
          onDoubleClick={() => { if (name === state.active) onRename(); }}
          onClick={() => { if (name !== state.active) void controller.open(name); else controller.selectFolder(parentFolder(name)); }}>
          <FileText /><span>{baseName(name).replace(/\.md$/i, '')}</span>
        </button>
      </li>)}
      {parent && !group?.folders.length && !group?.notes.length && <li className="dsn-empty-folder" style={{ paddingLeft: 24 + Math.min(depth, 8) * 14 }}>{t('emptyFolder')}</li>}
    </ul>;
  };
  return <nav className="dsn-list" aria-label={t('list')}>
    <button className={`dsn-root-folder ${state.folder === '' ? 'dsn-folder-selected' : ''}`} disabled={state.busy}
      aria-pressed={state.folder === ''} onClick={() => controller.selectFolder('')}><FolderOpen /><span>{t('rootFolder')}</span></button>
    {render('', 0)}
  </nav>;
}
