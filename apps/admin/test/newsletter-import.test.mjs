import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../lib/convert-upload.mjs';
import { htmlToBlocks, sanitizeRich } from '../lib/newsletter-import.mjs';
import { normalizeBlocks, renderEmail } from '@uccsite/newsletter/render';
import { renderWebBody } from '@uccsite/newsletter/web';

const MD = `# We've been busy

Three investigations in **three** weeks. Read [the report](https://utahciviccompact.org/mida).

## What happened

1. first
2. second
   - nested under second
   - and again

### Next

More coming.

> Sunlight is the best disinfectant.
>
> — Brandeis

- [ ] todo
- [x] done

\`\`\`
  indented code
    stays
\`\`\`

---

![Capitol](capitol.png)

| a | b |
|---|---|
| 1 | 2 |

Lead ~~struck~~ text.
`;

test('markdown → headline + rich blocks keeping lists, tables, code; images lift out', () => {
  const { html } = markdownToHtml(MD, { keepImages: true });
  const { blocks, headline, notes } = htmlToBlocks(html);
  assert.equal(headline, "We've been busy");
  assert.deepEqual(blocks.map((b) => b.type), ['rich', 'image', 'rich']);
  const a = blocks[0].html;
  assert.match(a, /<p>Three investigations in <strong>three<\/strong> weeks\. Read <a href="https:\/\/utahciviccompact.org\/mida">the report<\/a>\.<\/p>/);
  assert.match(a, /<h2>What happened<\/h2>/);
  assert.match(a, /<ol>\s*<li>first<\/li>\s*<li>second\s*<ul>\s*<li>nested under second<\/li>/);
  assert.match(a, /<h3>Next<\/h3>/);
  assert.match(a, /<blockquote>\s*<p>Sunlight is the best disinfectant\.<\/p>\s*<p>— Brandeis<\/p>\s*<\/blockquote>/);
  assert.match(a, /<li>☐ todo<\/li>/);
  assert.match(a, /<li>☑ done<\/li>/);
  assert.match(a, /<pre><code>  indented code\n    stays\n<\/code><\/pre>/);
  assert.match(a, /<hr \/>/);
  assert.equal(blocks[1].url, '', 'a relative image address is not usable in an email');
  assert.equal(blocks[1].alt, 'Capitol');
  const b = blocks[2].html;
  assert.match(b, /<table>[\s\S]*<th>a<\/th>[\s\S]*<td>2<\/td>[\s\S]*<\/table>/);
  assert.match(b, /<del>struck<\/del>/);
  assert.ok(notes.some((n) => /image/.test(n)));
  // Everything emitted is something the renderer accepts (only the
  // address-less image is dropped by normalizeBlocks).
  assert.equal(normalizeBlocks(blocks).length, blocks.length - 1);
});

test('h1 stays in the document when the composer already has a headline', () => {
  const { blocks, headline } = htmlToBlocks('<h1>Title</h1><p>Body</p>', { headline: 'Kept' });
  assert.equal(headline, 'Kept');
  assert.deepEqual(blocks, [{ type: 'rich', html: '<h1>Title</h1><p>Body</p>' }]);
});

test('docx-style HTML: blank paragraphs, underline, footnotes kept; inline images lift out after their paragraph; wrappers unwrap', () => {
  const src = '<div><p>Before <img src="data:image/png;base64,AAAA" alt="pic"> after <a href="javascript:x">bad</a> <a href="mailto:a@b.c">mail</a><sup><a href="#footnote-1">[1]</a></sup></p><p></p><p><u>under</u> <s>gone</s> H<sub>2</sub>O</p><p><img src="https://x.y/a.png" alt="alone"></p><ol><li><p>Foot<a href="#footnote-ref-1">↑</a></p></li></ol></div>';
  const { blocks } = htmlToBlocks(src);
  assert.deepEqual(blocks.map((b) => b.type), ['rich', 'image', 'rich', 'image', 'rich']);
  assert.equal(blocks[0].html, '<p>Before  after <a>bad</a> <a href="mailto:a@b.c">mail</a><sup><a href="#footnote-1">[1]</a></sup></p>', 'a fragment link is harmless and keeps the footnote mark');
  assert.equal(blocks[1].alt, 'pic');
  assert.equal(blocks[1].url, '');
  assert.equal(blocks[2].html, '<p></p><p><u>under</u> <s>gone</s> H<sub>2</sub>O</p>');
  assert.equal(blocks[3].url, 'https://x.y/a.png');
  assert.equal(blocks[4].html, '<ol><li><p>Foot<a href="#footnote-ref-1">↑</a></p></li></ol>');
});

test('sanitizeRich: no script, style, class, event handler, image or unsafe link survives; text of dropped tags stays', () => {
  const out = sanitizeRich('<p class="x" style="color:red" onclick="e()">Hi <span>there</span><script>alert(1)</script></p><style>p{}</style><img src="https://x.y/a.png"><table><tr><td colspan="2">c</td></tr></table><a href="http://ok.org">ok</a><a href="data:text/html,x">no</a>');
  assert.equal(out, '<p>Hi there</p><table><tr><td colspan="2">c</td></tr></table><a href="http://ok.org">ok</a><a>no</a>');
  assert.equal(sanitizeRich('<script>x</script><style>y</style>   '), '');
});

test('rich blocks render inline-styled in the email and class-only on the web; the text twin reads them', () => {
  const html = '<p>Para</p><p></p><ol start="3"><li>three<ul><li>deep</li></ul></li></ol><table><tr><th>h</th><td>d</td></tr></table><pre><code>x  y</code></pre>';
  const { html: email, text } = renderEmail({ blocks: [{ type: 'rich', html }] });
  assert.match(email, /<p class="em-text" style="margin:0 0 20px;[^"]*">Para<\/p>/);
  assert.match(email, /<p class="em-text" style="[^"]*">&nbsp;<\/p>/, 'a blank paragraph keeps its height');
  assert.match(email, /<ol start="3" style="margin:0 0 20px;padding-left:24px;">/);
  assert.match(email, /<ul style="margin:6px 0 0;padding-left:24px;">/, 'a nested list is tighter');
  assert.match(email, /<th class="em-text" style="[^"]*font-weight:700;text-align:left;">h<\/th>/);
  assert.match(email, /<pre class="em-quote" style="[^"]*white-space:pre-wrap;[^"]*"><code style="[^"]*">x  y<\/code><\/pre>/);
  assert.match(text, /Para\n\n- three\n- deep\n\nh \| d\n\nx y/);
  const web = renderWebBody({ blocks: [{ type: 'rich', html }] });
  assert.ok(web.includes(`<div class="nl-rich">${html}</div>`));
  assert.ok(!web.includes('style='));
});

test('empty or junk input gives no blocks', () => {
  assert.deepEqual(htmlToBlocks('').blocks, []);
  assert.deepEqual(htmlToBlocks('<script>x</script><style>y</style>   ').blocks, []);
});
