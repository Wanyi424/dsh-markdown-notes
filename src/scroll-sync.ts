export interface EditorScrollPort {
  element: HTMLElement;
  position(): { line: number; ratio: number; edge: 'start' | 'end' | null };
  lineCount(): number;
  scrollToLine(line: number): void;
}
export interface ScrollAnchor { line: number; top: number }

export function interpolate(anchors: ScrollAnchor[], value: number, from: 'line' | 'top', to: 'line' | 'top'): number {
  if (!anchors.length) return 0;
  if (value <= anchors[0][from]) return anchors[0][to];
  for (let i = 1; i < anchors.length; i++) {
    if (value > anchors[i][from]) continue;
    const previous = anchors[i - 1], next = anchors[i];
    const distance = next[from] - previous[from];
    return distance > 0 ? previous[to] + (next[to] - previous[to]) * (value - previous[from]) / distance : next[to];
  }
  return anchors[anchors.length - 1][to];
}

/** One frame per user scroll. Generated scroll events are ignored; no polling or per-frame document parsing. */
export function synchronizeScroll(editor: EditorScrollPort, preview: HTMLElement): () => void {
  let anchors: ScrollAnchor[] = [];
  let dirty = true;
  let disposed = false;
  let frame = 0;
  let leader: 'editor' | 'preview' = 'editor';
  let userScroll = false;
  let lastLine: number | null = null;
  let lastEdge: 'start' | 'end' | null = null;
  const expected = new WeakMap<HTMLElement, number>();
  const maxScroll = (element: HTMLElement) => Math.max(0, element.scrollHeight - element.clientHeight);
  const move = (element: HTMLElement, top: number) => {
    const next = Math.max(0, Math.min(top, maxScroll(element)));
    if (Math.abs(element.scrollTop - next) <= 1) return;
    element.scrollTop = next;
    expected.set(element, element.scrollTop);
  };
  const measure = () => {
    if (!dirty) return;
    dirty = false;
    anchors = [];
    const origin = preview.getBoundingClientRect().top;
    for (const node of preview.querySelectorAll<HTMLElement>('[data-dsn-line]')) {
      const line = Number(node.dataset.dsnLine);
      if (!Number.isFinite(line) || line < 1 || !node.getClientRects().length) continue;
      const top = node.getBoundingClientRect().top - origin + preview.scrollTop;
      const previous = anchors.at(-1);
      if (previous && (line <= previous.line || top <= previous.top)) continue;
      anchors.push({ line, top });
    }
    if (anchors.length) anchors.push({ line: Math.max(editor.lineCount() + 1, anchors.at(-1)!.line + 1), top: preview.scrollHeight });
  };
  const flush = () => {
    frame = 0;
    if (disposed) return;
    const layoutChanged = dirty;
    measure();
    if (leader === 'preview' && layoutChanged && !userScroll && lastLine !== null) {
      // Images and lazy diagrams may grow above the current reading position.
      // Preserve its source anchor instead of letting the visible paragraph jump.
      if (lastEdge === 'start') { move(preview, 0); move(editor.element, 0); }
      else if (lastEdge === 'end') { move(preview, maxScroll(preview)); move(editor.element, maxScroll(editor.element)); }
      else { move(preview, interpolate(anchors, lastLine, 'line', 'top')); editor.scrollToLine(lastLine); }
      return;
    }
    userScroll = false;
    if (leader === 'editor') {
      const position = editor.position();
      lastLine = position.line; lastEdge = position.edge;
      if (position.edge === 'start') move(preview, 0);
      else if (position.edge === 'end') move(preview, maxScroll(preview));
      else move(preview, anchors.length ? interpolate(anchors, position.line, 'line', 'top') : position.ratio * maxScroll(preview));
    } else {
      const max = maxScroll(preview);
      lastEdge = preview.scrollTop <= 1 ? 'start' : max > 0 && preview.scrollTop >= max - 1 ? 'end' : null;
      lastLine = anchors.length ? interpolate(anchors, preview.scrollTop, 'top', 'line') : null;
      if (lastEdge === 'start') move(editor.element, 0);
      else if (lastEdge === 'end') move(editor.element, maxScroll(editor.element));
      else if (anchors.length) {
        editor.scrollToLine(lastLine!);
      } else move(editor.element, (max ? preview.scrollTop / max : 0) * maxScroll(editor.element));
    }
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(flush); };
  // Only the pane receiving user input drives the other pane. CodeMirror can adjust
  // scroll offsets during virtual layout; those generated events must not reverse leadership.
  const editorIntent = () => { leader = 'editor'; expected.delete(editor.element); dirty = true; };
  const previewIntent = () => { leader = 'preview'; expected.delete(preview); dirty = true; };
  const intents = ['wheel', 'pointerdown', 'touchstart', 'keydown'];
  for (const event of intents) {
    editor.element.addEventListener(event, editorIntent, { passive: true });
    preview.addEventListener(event, previewIntent, { passive: true });
  }
  const scrolled = (origin: 'editor' | 'preview', element: HTMLElement) => {
    if (origin !== leader) return;
    const target = expected.get(element);
    if (target !== undefined && Math.abs(target - element.scrollTop) < 2) return;
    expected.delete(element); userScroll = true; schedule();
  };
  const editorScroll = () => scrolled('editor', editor.element);
  const previewScroll = () => scrolled('preview', preview);
  editor.element.addEventListener('scroll', editorScroll, { passive: true });
  preview.addEventListener('scroll', previewScroll, { passive: true });
  const resize = new ResizeObserver(() => { dirty = true; schedule(); });
  resize.observe(preview);
  let observedArticle: Element | null = null;
  const observeArticle = () => {
    const article = preview.querySelector('.dsn-prose');
    if (article === observedArticle) return;
    if (observedArticle) resize.unobserve(observedArticle);
    observedArticle = article;
    if (article) resize.observe(article);
  };
  const mutations = new MutationObserver(() => { dirty = true; observeArticle(); schedule(); });
  mutations.observe(preview, { childList: true, subtree: true });
  observeArticle(); schedule();
  return () => {
    disposed = true; cancelAnimationFrame(frame);
    editor.element.removeEventListener('scroll', editorScroll);
    preview.removeEventListener('scroll', previewScroll);
    for (const event of intents) { editor.element.removeEventListener(event, editorIntent); preview.removeEventListener(event, previewIntent); }
    mutations.disconnect(); resize.disconnect();
  };
}
