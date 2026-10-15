import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, placeholder, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';

export function MarkdownEditor({ value, disabled, onChange, onSave, label }: {
  value: string; disabled: boolean; onChange(value: string): void; onSave(): void; label: string;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const actions = useRef({ onChange, onSave }); actions.current = { onChange, onSave };
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
    return () => { view.current = null; editor.destroy(); };
  }, []);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(disabled)) }); }, [disabled]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="dsn-editor" ref={parent} />;
}
