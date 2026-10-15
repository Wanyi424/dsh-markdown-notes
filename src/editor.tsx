import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, placeholder, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
import type { EditorScrollPort } from './scroll-sync';

export function MarkdownEditor({ value, disabled, onChange, onSave, label, onReady }: {
  value: string; disabled: boolean; onChange(value: string): void; onSave(): void; label: string; onReady?(port: EditorScrollPort | null): void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const actions = useRef({ onChange, onSave, onReady }); actions.current = { onChange, onSave, onReady };
  const editable = useRef(new Compartment());
  useEffect(() => {
    const editor = new EditorView({ parent: parent.current!, state: EditorState.create({ doc: value, extensions: [
      markdown(), history(), lineNumbers(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
      bracketMatching(), indentOnInput(), syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
      placeholder('从这里开始记录…'), editable.current.of(EditorState.readOnly.of(disabled)),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-s', run: () => { actions.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of(update => { if (update.docChanged) actions.current.onChange(update.state.doc.toString()); }),
      EditorView.domEventHandlers({ blur: () => { actions.current.onSave(); } }),
      EditorView.theme({ '&': { height: '100%', background: 'transparent' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, "Cascadia Code", Consolas, "Microsoft YaHei", monospace', fontSize: '14px', lineHeight: '1.9' }, '.cm-content': { padding: '24px 20px', caretColor: 'var(--dsw-alias-label-primary)' }, '.cm-gutters': { background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', border: 'none', paddingRight: '8px' }, '.cm-lineNumbers .cm-gutterElement': { paddingLeft: '12px' }, '&.cm-focused': { outline: 'none' }, '.cm-activeLine': { background: 'var(--dsw-alias-interactive-bg-hover)' }, '.cm-activeLineGutter': { background: 'transparent' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: 'var(--dsw-alias-bg-multi-select)' }, '.cm-cursor': { borderLeftColor: 'var(--dsw-alias-label-primary)' } }),
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
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="dsn-editor" ref={parent} />;
}
