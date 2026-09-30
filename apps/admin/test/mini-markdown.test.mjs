import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../lib/mini-markdown.mjs';

test('headings, paragraphs, bullets, bold, code, links', () => {
  const html = renderMarkdown('## 2026-09-30 — Cutover\nSite moved **to AWS**.\n\n- DNS flipped\n- `migrate-d1` re-run\n\n[admin](/files) and [KSL](https://ksl.com)');
  assert.match(html, /<h3>2026-09-30 — Cutover<\/h3>/);
  assert.match(html, /<p>Site moved <strong>to AWS<\/strong>\.<\/p>/);
  assert.match(html, /<ul><li>DNS flipped<\/li><li><code>migrate-d1<\/code> re-run<\/li><\/ul>/);
  assert.match(html, /<a href="\/files">admin<\/a>/);
  assert.match(html, /<a href="https:\/\/ksl.com" target="_blank" rel="noopener">KSL<\/a>/);
});

test('raw HTML and script URLs never survive', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n[x](javascript:alert(1))\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'), html);
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('href="javascript'), html);
  assert.match(html, /&lt;script&gt;/);
});

test('a bullet can wrap onto an indented next line', () => {
  assert.match(renderMarkdown('- first part\n  second part'), /<li>first part second part<\/li>/);
});
