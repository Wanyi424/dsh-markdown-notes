import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection, placeholder, highlightActiveLine } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { EditorScrollPort } from './scroll-sync';

// A writing surface rather than a code editor: proportional type, markup marks recede, structure stays visible.
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.32em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.18em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.07em', fontWeight: '650' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '650' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--dsw-alias-link)' },
  { tag: tags.monospace, fontFamily: 'var(--dsn-mono)', fontSize: '.92em' },
  { tag: tags.quote, color: 'var(--dsw-alias-label-secondary)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator, tags.labelName], color: 'var(--dsw-alias-label-tertiary)' },
]);

export function MarkdownEditor({ value, disabled, onChange, onSave, label, placeholder: hint, onReady }: {
  value: string; disabled: boolean; onChange(value: string): void; onSave(): void; label: string; placeholder: string; onReady?(port: EditorScrollPort | null): void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const emitted = useRef(value);
  const actions = useRef({ onChange, onSave, onReady }); actions.current = { onChange, onSave, onReady };
  const editable = useRef(new Compartment());
  useEffect(() => {
    const editor = new EditorView({ parent: parent.current!, state: EditorState.create({ doc: value, extensions: [
      markdown(), history(), drawSelection(), highlightActiveLine(),
      bracketMatching(), indentOnInput(), syntaxHighlighting(markdownStyle), EditorView.lineWrapping,
      placeholder(hint), editable.current.of(EditorState.readOnly.of(disabled)),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-s', run: () => { actions.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of(update => { if (update.docChanged) { emitted.current = update.state.doc.toString(); actions.current.onChange(emitted.current); } }),
      EditorView.domEventHandlers({ blur: () => { actions.current.onSave(); } }),
      EditorView.theme({
        '&': { height: '100%', background: 'transparent', color: 'var(--dsw-alias-label-primary)' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--dsn-font)', fontSize: '15px', lineHeight: '1.85' },
        '.cm-content': { maxWidth: '780px', margin: '0 auto', padding: '30px 0 120px', caretColor: 'var(--dsn-accent)' },
        '.cm-line': { padding: '0 36px' },
        '&.cm-focused': { outline: 'none' },
        '.cm-activeLine': { background: 'color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 55%, transparent)' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: 'var(--dsw-alias-bg-multi-select)' },
        '.cm-cursor': { borderLeftColor: 'var(--dsn-accent)', borderLeftWidth: '2px' },
        '.cm-placeholder': { color: 'var(--dsw-alias-label-tertiary)' },
      }),
    ] }) });
    view.current = editor; editor.focus();
    actions.current.onReady?.({
      element: editor.scrollDOM,
      lineCount: () => editor.state.doc.lines,
      position: () => {
        const top = editor.scrollDOM.scrollTop;
        const max = Math.max(0, editor.scrollDOM.scrollHeight - editor.scrollDOM.clientHeight);
        const height = Math.max(0, top - editor.documentPadding.top);
        const block = editor.lineBlockAtHeight(height);
        const line = editor.state.doc.lineAt(block.from).number;
        return { line: line + Math.max(0, Math.min(1, (height - block.top) / Math.max(1, block.height))), ratio: max ? top / max : 0, edge: top <= 1 ? 'start' : max > 0 && top >= max - 1 ? 'end' : null };
      },
      scrollToLine: value => {
        const line = Math.max(1, Math.min(editor.state.doc.lines, Math.floor(value)));
        const position = editor.state.doc.line(line).from;
        const fraction = Math.max(0, Math.min(1, value - line));
        editor.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 0 }) });
        if (fraction > .01) editor.requestMeasure({
          key: 'notes-synchronized-scroll',
          read: () => { const block = editor.lineBlockAt(position); return editor.documentPadding.top + block.top + fraction * block.height; },
          write: top => { editor.scrollDOM.scrollTop = top; },
        });
      },
    });
    return () => { actions.current.onReady?.(null); view.current = null; editor.destroy(); };
  }, []);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(disabled)) }); }, [disabled]);
  useEffect(() => {
    // Typing echoes back as the same value; only an external change needs the full-document comparison.
    const editor = view.current;
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    if (editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="dsn-editor" ref={parent} />;
}
