import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { createMarkdownRenderer, type Diagram } from './markdown';
import katexCss from './katex-style';
import { infographicIcons } from './infographic-icons';
import { loadChunk } from './lazy-chunk';

async function copyText(text: string, owner: HTMLElement) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Some desktop carriers deny the async clipboard API. */ }
  const focused = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.className = 'dsn-copy-buffer'; field.value = text; field.setAttribute('aria-hidden', 'true');
  owner.append(field); field.select();
  try { if (!document.execCommand('copy')) throw new Error('Clipboard unavailable'); }
  finally { field.remove(); focused?.focus({ preventScroll: true }); }
}

function sanitizeRaw(html: string) {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'button', 'input', 'textarea'], FORBID_ATTR: ['id', 'name', 'class'], ALLOW_DATA_ATTR: false });
  for (const element of fragment.querySelectorAll('[style]')) {
    const width = element instanceof HTMLImageElement ? element.style.width : '';
    element.removeAttribute('style');
    if (/^\d+(?:px)?$/.test(width)) element.setAttribute('width', String(parseInt(width)));
  }
  const wrapper = document.createElement('div'); wrapper.append(fragment);
  return wrapper.innerHTML;
}

let diagramQueue: Promise<unknown> = Promise.resolve();
let diagramId = 0;
const mermaidCache = new Map<string, { id: string; svg: string }>();
let cachedChars = 0;
function DiagramView({ diagram, dark }: { diagram: Diagram; dark: boolean }) {
  const figure = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const tooLarge = diagram.source.length > 32_000;
  const complex = diagram.source.length > 8_000 || diagram.source.split('\n').length > 180;
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { root: figure.current?.closest('.dsn-reading-pane') ?? null, rootMargin: '180px' });
    observer.observe(figure.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || tooLarge || (complex && !approved)) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const container = host.current!;
    container.replaceChildren(); setError(''); setReady(false);
    const execute = async () => {
      if (cancelled) return;
      if (diagram.kind === 'mermaid') {
        const key = `${dark ? 'dark' : 'light'}\0${diagram.source}`;
        const id = `dsn-mermaid-${++diagramId}`;
        const cached = mermaidCache.get(key);
        if (cached) { container.innerHTML = cached.svg.split(cached.id).join(id); setReady(true); return; }
        const { default: mermaid } = await loadChunk<typeof import('./mermaid-chunk')>('client.mermaid.js');
        if (cancelled) return;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'system-ui, Microsoft YaHei, sans-serif', flowchart: { htmlLabels: false }, suppressErrorRendering: true });
        const { svg } = await mermaid.render(id, diagram.source, container);
        if (cancelled) return;
        container.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'], ADD_ATTR: ['dominant-baseline'] });
        const safe = container.innerHTML;
        if (safe.length < 500_000) {
          mermaidCache.set(key, { id, svg: safe }); cachedChars += safe.length;
          while (mermaidCache.size > 12 || cachedChars > 1_000_000) { const first = mermaidCache.keys().next().value!; cachedChars -= mermaidCache.get(first)!.svg.length; mermaidCache.delete(first); }
        }
        setReady(true);
      } else {
        const { Infographic, parseSyntax, getFonts, registerFont, setDefaultFont } = await loadChunk<typeof import('./infographic-chunk')>('client.infographic.js');
        if (cancelled) return;
        // Infographic eagerly loads all registered fonts, even unused ones. Keep the bundled renderer fully local.
        getFonts().forEach(font => registerFont({ ...font, fontFamily: font.fontFamily.replace(/^["']|["']$/g, ''), baseUrl: '', fontWeight: {} }));
        setDefaultFont('Microsoft YaHei');
        const parsed = parseSyntax(diagram.source);
        if (parsed.errors.length) throw new Error(parsed.errors.map(e => e.message).join('\n'));
        // Only template/data are accepted. Local icon resources are embedded; no search or remote asset loaders.
        const clean = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(clean);
          if (!value || typeof value !== 'object') return value;
          const result: Record<string, unknown> = {};
          for (const [key, item] of Object.entries(value)) {
            if (key === 'icon') { const svg = typeof item === 'string' ? infographicIcons[item.replace(/^mdi:/, '')] : undefined; if (svg) result.icon = svg; }
            else if (!['illus', 'image', 'fontFamily', 'style', 'container', 'resource'].includes(key)) result[key] = clean(item);
          }
          return result;
        };
        const graphic = new Infographic({ container, width: '100%', height: 320, editable: false,
          template: parsed.options.template, data: clean(parsed.options.data) as never,
          themeConfig: { colorBg: dark ? '#191b20' : '#ffffff', colorPrimary: '#5570aa', base: { text: { 'font-family': 'Arial, Microsoft YaHei, sans-serif' } } },
        });
        destroy = () => graphic.destroy();
        graphic.on('error', (value: unknown) => { if (!cancelled) setError(value instanceof Error ? value.message : '信息图语法不完整，请检查源码。'); });
        graphic.on('loaded', () => { if (!cancelled) setReady(true); });
        graphic.render();
      }
    };
    diagramQueue = diagramQueue.catch(() => {}).then(execute).catch(error => { if (!cancelled) { container.replaceChildren(); setError(error instanceof Error ? error.message : String(error)); } });
    return () => { cancelled = true; destroy?.(); container.replaceChildren(); };
  }, [diagram.kind, diagram.source, dark, visible, approved]);
  return <figure ref={figure} className={`dsn-diagram ${error ? 'dsn-diagram-error' : ''}`}>
    <figcaption>{diagram.kind === 'mermaid' ? 'Mermaid' : 'Infographic'}</figcaption>
    {!ready && !error && <div className="dsn-rendering">{tooLarge ? <details><summary>图表过大，保留源码以避免阻塞界面</summary><pre>{diagram.source}</pre></details> : complex && !approved ? <>图表内容较多，按需绘制。<button onClick={() => setApproved(true)}>绘制图表</button></> : visible ? '正在绘制图表…' : '滚动到此处时绘制图表'}</div>}
    <div className="dsn-diagram-canvas" ref={host} />
    {error && <div className="dsn-render-error" role="status"><p>此图表暂时无法渲染：{error}</p><pre>{diagram.source}</pre></div>}
  </figure>;
}

function PreviewBody({ source, copyLabel = '复制', onHeadings }: {
  source: string; copyLabel?: string; onHeadings?: (headings: ReturnType<ReturnType<typeof createMarkdownRenderer>>['headings']) => void;
}) {
  const article = useRef<HTMLElement>(null);
  const [slots, setSlots] = useState<Element[]>([]);
  const [dark, setDark] = useState(false);
  const [allowLarge, setAllowLarge] = useState(false);
  const large = source.length > 120_000 && !allowLarge;
  const copyTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { copyTimers.current.forEach(clearTimeout); copyTimers.current.clear(); }, [source]);
  const render = useMemo(() => createMarkdownRenderer(sanitizeRaw), []);
  const doc = useMemo(() => {
    if (large) return { html: '', diagrams: [], headings: [] };
    const rendered = render(source, copyLabel);
    return { ...rendered, html: DOMPurify.sanitize(rendered.html, { ADD_TAGS: ['eq', 'eqn', 'section'], ADD_ATTR: ['data-dsn-copy', 'data-dsn-diagram'], FORBID_TAGS: ['style'], ALLOW_DATA_ATTR: true }) };
  }, [render, source, copyLabel, large]);
  useEffect(() => {
    setSlots([...article.current!.querySelectorAll('[data-dsn-diagram]')]);
    onHeadings?.(doc.headings);
  }, [doc]);
  // The headings belong to this preview: they leave with it, so the page never shows another note's contents.
  useEffect(() => () => onHeadings?.([]), []);
  useEffect(() => {
    const sync = () => {
      const color = getComputedStyle(article.current!).color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      setDark(color[0] * .299 + color[1] * .587 + color[2] * .114 > 160);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true });
    const media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', sync);
    return () => { observer.disconnect(); media.removeEventListener('change', sync); };
  }, []);
  return <><style>{katexCss}</style>{large && <div className="dsn-large-document"><p>文档较大，已暂停自动预览以保持界面流畅。可以编辑源码，或手动加载排版。</p><button onClick={() => setAllowLarge(true)}>加载预览</button></div>}<article ref={article} className={`dsn-prose ${dark ? 'dsn-prose-dark' : ''}`} onClick={async event => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('[data-dsn-copy]');
    if (button) {
      const code = button.closest('figure')?.querySelector('pre')?.textContent ?? '';
      try { await copyText(code, article.current!); button.textContent = '已复制'; button.setAttribute('aria-label', '已复制'); }
      catch { button.textContent = '复制失败，请手动选择'; button.setAttribute('aria-label', '复制失败，请手动选择'); }
      const timer = setTimeout(() => { if (button.isConnected) { button.textContent = copyLabel; button.setAttribute('aria-label', copyLabel); } copyTimers.current.delete(timer); }, 2000);
      copyTimers.current.add(timer);
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      const id = decodeURIComponent(anchor.getAttribute('href')!.slice(1));
      const destination = article.current?.querySelector(`#${CSS.escape(id)}`);
      if (destination) { event.preventDefault(); destination.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }
  }} dangerouslySetInnerHTML={{ __html: doc.html }} />
    {slots.map((slot, i) => doc.diagrams[i] && createPortal(<DiagramView diagram={doc.diagrams[i]} dark={dark} />, slot, `${i}-${doc.diagrams[i].source}`))}
  </>;
}
export const MarkdownPreview = memo(PreviewBody);
