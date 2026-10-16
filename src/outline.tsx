import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Heading } from './markdown';

/** Headings that are worth navigating: up to three levels below the shallowest one in the document. */
export function outlineOf(headings: Heading[]) {
  const top = Math.min(...headings.map(h => h.level));
  return headings.filter(h => h.level <= top + 2 && h.text.trim()).slice(0, 300);
}

/**
 * Scroll spy without scroll listeners: an IntersectionObserver fires only when a heading crosses the top band,
 * and the active entry is the last heading above that band. A jumped-to entry stays current until its scroll ends or the
 * reader scrolls; the next crossing then updates it, so a short section followed by another heading cannot steal it.
 */
function useScrollSpy(headings: Heading[], pane: HTMLElement | null) {
  const [active, setActive] = useState<string | null>(null), locked = useRef<string | null>(null);
  useEffect(() => {
    if (!pane || !headings.length) return;
    const targets = headings.map(h => pane.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`)).filter((node): node is HTMLElement => !!node);
    const update = () => {
      if (locked.current) return;
      const limit = pane.getBoundingClientRect().top + Math.min(96, pane.clientHeight * .2);
      let current = targets[0]?.id ?? null;
      for (const target of targets) { if (target.getBoundingClientRect().top <= limit) current = target.id; else break; }
      setActive(current);
    };
    const observer = new IntersectionObserver(update, { root: pane, rootMargin: '0px 0px -80% 0px' });
    const release = () => { locked.current = null; };
    const intents = ['scrollend', 'wheel', 'pointerdown', 'keydown', 'touchstart'];
    intents.forEach(name => pane.addEventListener(name, release, { passive: true }));
    targets.forEach(target => observer.observe(target)); update();
    return () => { observer.disconnect(); intents.forEach(name => pane.removeEventListener(name, release)); };
  }, [pane, headings]);
  const jump = useCallback((id: string) => {
    locked.current = id; setActive(id);
    pane?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [pane]);
  return [active, jump] as const;
}

const levels = (headings: Heading[]) => { const top = Math.min(...headings.map(h => h.level)); return (h: Heading) => ({ '--level': h.level - top } as React.CSSProperties); };

function Entries({ headings, active, onJump }: { headings: Heading[]; active: string | null; onJump(id: string): void }) {
  const level = levels(headings);
  return <ol>{headings.map(h => <li key={h.id} style={level(h)}>
    <a href={`#${h.id}`} aria-current={h.id === active ? 'location' : undefined} onClick={event => { event.preventDefault(); onJump(h.id); }}>{h.text}</a>
  </li>)}</ol>;
}

/** Docked beside the article when the reading area has room for it. */
export const Outline = memo(function Outline({ headings, pane, label }: { headings: Heading[]; pane: HTMLElement | null; label: string }) {
  const [active, jump] = useScrollSpy(headings, pane);
  return <nav className="dsn-outline dsn-contents" aria-label={label}><p>{label}</p><Entries headings={headings} active={active} onJump={jump} /></nav>;
});

/**
 * Where the docked list does not fit (narrow widths, the split view): one tick per heading on the right edge shows the
 * shape of the document and the current section. Hovering the ticks peeks the full list and a tick jumps straight to its
 * section; the toolbar button pins the list open, which is also the keyboard and touch path.
 */
export const OutlineRail = memo(function OutlineRail({ headings, pane, label, open, onClose }: {
  headings: Heading[]; pane: HTMLElement | null; label: string; open: boolean; onClose(restoreFocus: boolean): void;
}) {
  const [active, jump] = useScrollSpy(headings, pane), panel = useRef<HTMLElement>(null);
  const level = levels(headings);
  useEffect(() => {
    const list = panel.current; if (!open || !list) return;
    const current = list.querySelector<HTMLElement>('[aria-current]') ?? list.querySelector<HTMLElement>('a');
    if (current) { list.scrollTop = current.offsetTop - list.clientHeight / 2; current.focus({ preventScroll: true }); }
    // The toolbar button toggles the list itself, so a press on it is not an outside press.
    const outside = (event: PointerEvent) => { const target = event.target as Element; if (!list.contains(target) && !target.closest?.('[data-outline-toggle]')) onClose(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open, onClose]);
  return <div className="dsn-outline-float" data-open={open || undefined}>
    <div className="dsn-outline-ticks" aria-hidden style={{ '--count': headings.length } as React.CSSProperties}>
      {headings.map(h => <i key={h.id} data-active={h.id === active || undefined} style={level(h)} onClick={() => jump(h.id)} />)}
    </div>
    <nav ref={panel} className="dsn-outline-panel dsn-contents" aria-label={label}
      onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); onClose(true); } }}>
      <p>{label}</p>
      <Entries headings={headings} active={active} onJump={id => { jump(id); if (open) { onClose(false); pane?.focus({ preventScroll: true }); } }} />
    </nav>
  </div>;
});
