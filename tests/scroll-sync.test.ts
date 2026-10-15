import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate } from '../src/scroll-sync';
import { createMarkdownRenderer } from '../src/markdown';

test('source-line interpolation follows uneven block heights in both directions', () => {
  const anchors = [{ line: 1, top: 40 }, { line: 5, top: 100 }, { line: 15, top: 800 }, { line: 20, top: 900 }];
  assert.equal(interpolate(anchors, 10, 'line', 'top'), 450);
  assert.equal(interpolate(anchors, 450, 'top', 'line'), 10);
  assert.equal(interpolate(anchors, 0, 'top', 'line'), 1);
  assert.equal(interpolate(anchors, 1000, 'top', 'line'), 20);
});
test('rendered headings, paragraphs, code and diagram blocks carry source lines', () => {
  const render = createMarkdownRenderer(html => html);
  const result = render('# 标题\n\n段落\n\n```js\nconst a = 1;\n```\n\n```mermaid\ngraph LR\nA-->B\n```\n');
  for (const line of [1, 3, 5, 9]) assert.ok(result.html.includes(`data-dsn-line="${line}"`));
});
