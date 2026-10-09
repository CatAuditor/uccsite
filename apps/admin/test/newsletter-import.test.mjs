import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../lib/convert-upload.mjs';
import { htmlToBlocks } from '../lib/newsletter-import.mjs';
import { normalizeBlocks } from '@uccsite/newsletter/render';

const MD = `# We've been busy

Three investigations in **three** weeks. Read [the report](https://utahciviccompact.org/mida).

## What happened

- one
- two
  - nested

### Next

More coming.

> Sunlight is the best disinfectant.
>
> — Brandeis

[Read more](https://utahciviccompact.org/alpr)

---

![Capitol](capitol.png)

| a | b |
|---|---|
| 1 | 2 |
`;

test('markdown → headline + newsletter blocks', () => {
  const { html } = markdownToHtml(MD, { keepImages: true });
  const { blocks, headline, notes } = htmlToBlocks(html);
  assert.equal(headline, "We've been busy");
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'heading', 'text', 'quote', 'button', 'divider', 'image', 'text']);
  assert.equal(blocks[0].markdown, 'Three investigations in **three** weeks. Read [the report](https://utahciviccompact.org/mida).');
  assert.equal(blocks[1].text, 'What happened');
  assert.equal(blocks[2].markdown, '- one\n- two\n- nested\n\n## Next\n\nMore coming.');
  assert.deepEqual(blocks[3], { type: 'quote', text: 'Sunlight is the best disinfectant.', cite: 'Brandeis' });
  assert.deepEqual(blocks[4], { type: 'button', label: 'Read more', url: 'https://utahciviccompact.org/alpr', align: 'center' });
  assert.equal(blocks[6].url, '', 'a relative image address is not usable in an email');
  assert.equal(blocks[6].alt, 'Capitol');
  assert.equal(blocks[7].markdown, '- a | b\n- 1 | 2');
  assert.ok(notes.some((n) => /image/.test(n)));
  assert.ok(notes.some((n) => /table/.test(n)));
  // Everything the converter emits is something the renderer accepts (the
  // address-less image is the one thing normalizeBlocks drops).
  assert.equal(normalizeBlocks(blocks).length, blocks.length - 1);
});

test('an h1 becomes a heading when the composer already has a headline', () => {
  const { blocks, headline } = htmlToBlocks('<h1>Title</h1><p>Body</p>', { headline: 'Kept' });
  assert.equal(headline, 'Kept');
  assert.deepEqual(blocks, [{ type: 'heading', text: 'Title' }, { type: 'text', markdown: 'Body' }]);
});

test('docx-style HTML: inline images lift out, unsafe links drop to text, wrappers unwrap', () => {
  const { blocks } = htmlToBlocks('<div><p>Before <img src="data:image/png;base64,AAAA" alt="pic"> after <a href="javascript:x">bad</a> <a href="mailto:a@b.c">mail</a></p><p><a href="https://x.y">Go</a></p></div>');
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'image', 'button']);
  assert.equal(blocks[0].markdown, 'Before after bad [mail](mailto:a@b.c)');
  assert.equal(blocks[1].url, '');
  assert.equal(blocks[1].alt, 'pic');
});

test('empty or junk input gives no blocks', () => {
  assert.deepEqual(htmlToBlocks('').blocks, []);
  assert.deepEqual(htmlToBlocks('<script>x</script><style>y</style>   ').blocks, []);
});
