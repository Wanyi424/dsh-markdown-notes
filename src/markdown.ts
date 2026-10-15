import MarkdownIt from 'markdown-it';
import { escapeHtml } from 'markdown-it/lib/common/utils.mjs';
import type { PluginSimple, PluginWithParams } from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import mark from 'markdown-it-mark';
import ins from 'markdown-it-ins';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import footnote from 'markdown-it-footnote';
import container from 'markdown-it-container';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';

export interface Diagram { kind: 'mermaid' | 'infographic'; source: string; index: number }
export interface Heading { id: string; text: string; level: number }
export interface RenderedDocument { html: string; diagrams: Diagram[]; headings: Heading[] }
interface Environment { diagrams: Diagram[]; headings: Heading[]; copy: string }
const titles: Record<string, string> = { note: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING', caution: 'CAUTION', theorem: '定理', lemma: '引理', definition: '定义', proof: '证明' };
const escape = escapeHtml;
const kindOf = (s: string) => Object.hasOwn(titles, s.toLowerCase()) ? s.toLowerCase() : 'note';
function callout(kind: string, title: string) {
  return `<aside class="dsn-callout dsn-callout-${kindOf(kind)}"><div class="dsn-callout-title">${escape(title || titles[kind.toLowerCase()] || kind)}</div><div class="dsn-callout-body">`;
}

export function createMarkdownRenderer(sanitizeRaw: (html: string) => string) {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: false });
  // These two plugins publish CJS MarkdownIt types; their runtime API is shared with ESM.
  md.use(mark).use(ins).use(sub).use(sup).use(footnote as unknown as PluginSimple)
    .use(texmath, { engine: katex, delimiters: ['dollars', 'brackets'], katexOptions: { throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000 } })
    .use(container as unknown as PluginWithParams, 'callout', {
      validate: (params: string) => /^[^\s:]+/.test(params.trim()),
      render: (tokens: Token[], index: number) => {
        if (tokens[index].nesting === -1) return '</div></aside>\n';
        const [kind, ...title] = tokens[index].info.trim().split(/\s+/);
        return callout(kind, title.join(' '));
      },
    });
  md.renderer.rules.html_block = (tokens, index) => sanitizeRaw(tokens[index].content);
  md.renderer.rules.html_inline = (tokens, index) => sanitizeRaw(tokens[index].content);
  md.inline.ruler.before('link', 'ruby', (state, silent) => {
    if (state.src[state.pos] !== '[') return false;
    const match = /^\[([^\]\n]+)\](?:\{([^}\n]+)\}|\^\(([^)\n]+)\))/.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) { const token = state.push('ruby', 'ruby', 0); token.meta = { text: match[1], annotation: match[2] ?? match[3] }; }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.ruby = (tokens, i) => {
    const { text, annotation } = tokens[i].meta as { text: string; annotation: string };
    const parts = annotation.split(/[・．。-]/);
    const chars = [...text];
    if (parts.length > 1 && parts.length === chars.length) return chars.map((char, j) => `<ruby>${escape(char)}<rp>(</rp><rt>${escape(parts[j])}</rt><rp>)</rp></ruby>`).join('');
    return `<ruby>${escape(text)}<rp>(</rp><rt>${escape(annotation)}</rt><rp>)</rp></ruby>`;
  };
  md.core.ruler.after('inline', 'notes_structure', state => {
    const env = state.env as Environment;
    state.tokens.forEach((token, i) => {
      if (token.type === 'heading_open') {
        const inline = state.tokens[i + 1];
        const text = (inline.children ?? []).filter(t => !['html_inline'].includes(t.type)).map(t => t.content).join('');
        const id = `dsn-heading-${env.headings.length}`;
        token.attrSet('id', id);
        env.headings.push({ id, text, level: Number(token.tag.slice(1)) });
      }
      if (token.type === 'blockquote_open') {
        const inline = state.tokens[i + 2];
        if (inline?.type !== 'inline') return;
        const match = /^\[!([^\]]+)\]([^\n]*)(?:\n|$)/.exec(inline.content);
        if (!match) return;
        const end = state.tokens.findIndex((t, j) => j > i && t.type === 'blockquote_close' && t.level === token.level);
        if (end < 0) return;
        token.type = 'callout_open'; token.meta = { kind: match[1], title: match[2].trim() };
        state.tokens[end].type = 'callout_close';
        inline.content = inline.content.slice(match[0].length);
        inline.children = [];
        state.md.inline.parse(inline.content, state.md, state.env, inline.children);
      }
    });
    state.tokens.forEach((token, i) => {
      if (token.type === 'inline' && token.content.trim() === '[TOC]' && state.tokens[i - 1]?.type === 'paragraph_open') {
        token.type = 'notes_toc'; state.tokens[i - 1].hidden = true; state.tokens[i + 1].hidden = true;
      }
    });
  });
  md.renderer.rules.callout_open = (tokens, i) => callout(tokens[i].meta.kind, tokens[i].meta.title);
  md.core.ruler.after('notes_structure', 'notes_tasks', state => {
    state.tokens.forEach((token, i) => {
      if (token.type !== 'inline' || state.tokens[i - 1]?.type !== 'paragraph_open' || state.tokens[i - 2]?.type !== 'list_item_open') return;
      const match = /^\[([ xX])\] /.exec(token.content);
      if (!match || token.children?.[0]?.type !== 'text') return;
      token.children[0].content = token.children[0].content.slice(3);
      const checkbox = new state.Token('notes_checkbox', 'input', 0);
      checkbox.meta = { checked: match[1].toLowerCase() === 'x' };
      token.children.unshift(checkbox);
      state.tokens[i - 2].attrSet('class', 'task-list-item');
    });
  });
  md.renderer.rules.notes_checkbox = (tokens, i) => `<input class="task-list-item-checkbox" type="checkbox" disabled ${tokens[i].meta.checked ? 'checked' : ''} aria-label="${tokens[i].meta.checked ? '已完成' : '未完成'}">`;
  md.renderer.rules.callout_close = () => '</div></aside>\n';
  md.renderer.rules.notes_toc = (_tokens, _i, _options, env: Environment) => `<nav class="dsn-toc" aria-label="目录">${env.headings.filter(h => h.level > 1).map(h => `<a class="dsn-toc-level-${h.level}" href="#${h.id}">${escape(h.text)}</a>`).join('')}</nav>`;
  const linkOpen = md.renderer.rules.link_open ?? ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    if (!tokens[i].attrGet('href')?.startsWith('#')) { tokens[i].attrSet('target', '_blank'); tokens[i].attrSet('rel', 'noopener noreferrer'); }
    return linkOpen(tokens, i, options, env, self);
  };
  md.renderer.rules.fence = (tokens, i, _options, env: Environment) => {
    const token = tokens[i];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (language === 'mermaid' || language === 'infographic') {
      const index = env.diagrams.length;
      env.diagrams.push({ kind: language, source: token.content, index });
      return `<div class="dsn-diagram-slot" data-dsn-diagram="${index}"></div>`;
    }
    let code = escape(token.content);
    if (language && hljs.getLanguage(language)) code = hljs.highlight(token.content, { language, ignoreIllegals: true }).value;
    const note = language === 'plantuml' ? '<div class="dsn-code-note">PlantUML 源码 · 本地保留，不发送至外部渲染服务</div>' : '';
    return `<figure class="dsn-code"><figcaption><span>${escape(language || 'text')}</span><button type="button" data-dsn-copy="true" aria-label="${escape(env.copy)}">${escape(env.copy)}</button></figcaption><pre><code class="hljs">${code}</code></pre>${note}</figure>`;
  };
  md.renderer.rules.table_open = () => '<div class="dsn-table-scroll"><table>';
  md.renderer.rules.table_close = () => '</table></div>';
  return (source: string, copy = '复制'): RenderedDocument => {
    const env: Environment = { diagrams: [], headings: [], copy };
    return { html: md.render(source, env), diagrams: env.diagrams, headings: env.headings };
  };
}
