import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMarkdownRenderer } from '../src/markdown';
import { SAMPLE_CONTENT } from '../src/sample';

const render = createMarkdownRenderer(() => '');
test('bundled sample preserves the supplied document exactly', async () => {
  assert.equal(SAMPLE_CONTENT, await readFile(new URL('../src/assets/sample.md', import.meta.url), 'utf8'));
  assert.ok(SAMPLE_CONTENT.includes('[访问 Wanyi424 的 GitHub 主页](https://github.com/Wanyi424)'));
  assert.ok(SAMPLE_CONTENT.includes('/docs/images/plugin-banner.png'));
  assert.ok(!SAMPLE_CONTENT.includes('logo-2.png'));
});
test('sample resolves formulas, local diagrams, ruby, callouts and inline extensions', () => {
  const doc = render(SAMPLE_CONTENT);
  assert.equal(doc.diagrams.filter(d => d.kind === 'mermaid').length, 4);
  assert.equal(doc.diagrams.filter(d => d.kind === 'infographic').length, 1);
  for (const text of ['class="katex"', '<ruby>', '<mark>高亮</mark>', '<ins>下划线</ins>', 'dsn-callout-tip', 'dsn-callout-theorem', 'dsn-callout-definition', 'dsn-callout-proof', 'PlantUML 源码', 'hljs']) assert.ok(doc.html.includes(text), text);
  assert.ok(!doc.html.includes('class="katex-error"'));
});
test('all heading levels, tasks, footnotes, TOC and nested lists are rendered', () => {
  const doc = render('# H1\n\n[TOC]\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\n- [x] done\n- [ ] todo\n\n1. first\n   - nested\n\nReference[^1]\n\n[^1]: Footnote content\n');
  assert.equal(doc.headings.length, 6);
  for (const fragment of ['<h6', 'dsn-toc', 'href="#dsn-heading-1"', 'task-list-item-checkbox', 'footnotes', '<ol ', '<ul ']) assert.ok(doc.html.includes(fragment), fragment);
});
test('syntax samples inside code fences stay literal; malformed math does not abort the page', () => {
  const doc = render('```markdown\n==mark== [你好]{nǐ} $x$\n```\n\n$\\notARealCommand$\n\n## Still readable');
  assert.equal(doc.diagrams.length, 0);
  assert.ok(!doc.html.includes('<mark>'));
  assert.ok(!doc.html.includes('<ruby>'));
  assert.ok(doc.html.includes('Still readable'));
});
test('descriptive alt text becomes an image caption; placeholder alts do not', () => {
  const doc = render('![河边的晚霞](a.png)\n\n![IMG_2024.jpg](b.jpg)\n\n![](c.png)\n');
  assert.equal(doc.html.match(/class="dsn-image-caption"/g)?.length, 1);
  assert.ok(doc.html.includes('<span class="dsn-image-caption" aria-hidden="true">河边的晚霞</span>'));
});
