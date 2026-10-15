import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { NotesController } from './controller';
import { createApi } from './api';
import { zh, en } from './dictionaries';
import { loadChunk } from './lazy-chunk';
import type { ClientContext } from './page';

export const inject = ['slots', 'locale'];
function LazyPage({ controller, ctx }: { controller: NotesController; ctx: ClientContext }) {
  const [Page, setPage] = useState<React.ComponentType<{ controller: NotesController; ctx: ClientContext }> | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadChunk<typeof import('./page')>('client.page.js').then(module => { if (alive) setPage(() => module.NotesPage); }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [attempt]);
  if (Page) return <Page controller={controller} ctx={ctx} />;
  return <div style={{ padding: 28, color: 'var(--dsw-alias-label-secondary)' }} role="status">{error ? <>笔记界面加载失败。<button onClick={() => { setError(''); setAttempt(value => value + 1); }}>重试</button></> : '正在打开笔记…'}</div>;
}
export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.locale.register('markdownNotes', { zh, en }), 'markdown-notes: locale');
  const controller = new NotesController(createApi());
  ctx.effect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (controller.dirty) { event.preventDefault(); event.returnValue = ''; void controller.flush().catch(() => {}); } };
    window.addEventListener('beforeunload', beforeUnload);
    return async () => { window.removeEventListener('beforeunload', beforeUnload); await controller.dispose(); };
  }, 'markdown-notes: lifetime');
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'markdown-notes', locale: 'markdownNotes' }, () => <LazyPage controller={controller} ctx={ctx} />));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'markdown-notes', order: 15, label: () => ctx.locale.bind('markdownNotes')('title'), locale: 'markdownNotes' }, () => <FileText size={20} strokeWidth={1.6} />));
}
