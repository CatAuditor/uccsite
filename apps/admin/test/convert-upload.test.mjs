import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, finishHtml, uploadKind } from '../lib/convert-upload.mjs';

test('markdown becomes semantic HTML, one block per line', () => {
  const { html, imagesOmitted } = markdownToHtml('# Headline\n\nLead **bold** and *em* and [a link](https://ksl.com).\n\n## Section\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted\n');
  assert.match(html, /^<h1>Headline<\/h1>\n/);
  assert.match(html, /<p>Lead <strong>bold<\/strong> and <em>em<\/em> and <a href="https:\/\/ksl.com">a link<\/a>\.<\/p>/);
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
  assert.match(html, /<table>[\s\S]*<th>a<\/th>[\s\S]*<td>2<\/td>/);
  assert.match(html, /<blockquote>\n<p>quoted<\/p>\n<\/blockquote>/);
  assert.equal(imagesOmitted, 0);
});

test('embedded images become numbered placeholders', () => {
  const { html, imagesOmitted } = finishHtml('<p>a</p><img src="data:image/png;base64,AAAA" alt=""><p>b</p><img src="x.png">');
  assert.equal(imagesOmitted, 2);
  assert.ok(!html.includes('<img'), html);
  assert.match(html, /\[Image 1 omitted/);
  assert.match(html, /\[Image 2 omitted/);
});

test('upload kinds by extension', () => {
  assert.equal(uploadKind('Report.DOCX'), 'docx');
  assert.equal(uploadKind('draft.md'), 'markdown');
  assert.equal(uploadKind('draft.txt'), 'markdown');
  assert.equal(uploadKind('page.htm'), 'html');
  assert.equal(uploadKind('photo.png'), null);
});
