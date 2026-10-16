import React, { memo, useEffect, useRef, useState } from 'react';
import type { Heading } from './markdown';

/** Headings that are worth navigating: up to three levels below the shallowest one in the document. */
export function outlineOf(headings: Heading[]) {
  const top = Math.min(...headings.map(h => h.level));
  return headings.filter(h => h.level <= top + 2 && h.text.trim()).slice(0, 300);
}

/**
 * Scroll spy without scroll listeners: an IntersectionObserver fires only when a heading crosses the top band,
 * and the active entry is the last heading above that band. A clicked entry stays current until its scroll ends or the
 * reader scrolls; the next crossing then updates it, so a short section followed by another heading cannot steal it.
 */
export const Outline = memo(function Outline({ headings, pane, label }: { headings: Heading[]; pane: HTMLElement | null; label: string }) {
  const [active, setActive] = useState<string | null>(null), locked = useRef<string | null>(null);
  const top = Math.min(...headings.map(h => h.level));
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
  return <nav className="dsn-outline" aria-label={label}>
    <p>{label}</p>
    <ol>{headings.map(h => <li key={h.id} style={{ '--level': h.level - top } as React.CSSProperties}>
      <a href={`#${h.id}`} aria-current={h.id === active ? 'location' : undefined} onClick={event => {
        event.preventDefault(); locked.current = h.id; setActive(h.id);
        pane?.querySelector(`#${CSS.escape(h.id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }}>{h.text}</a>
    </li>)}</ol>
  </nav>;
});
