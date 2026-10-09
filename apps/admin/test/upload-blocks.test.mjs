import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../lib/convert-upload.mjs';
import { parse } from '@uccsite/doc-blocks';

// The authoring kit's own example (lib/authoring-kit.js "Builder markers")
// must come through the upload path as the blocks it promises.
const EXAMPLE = `<!-- ucc:header eyebrow="Surveillance investigation" date="August 12, 2026" author="Conner Radcliffe" -->
# Ten cameras in one Utah county were searched 5.1 million times

Weber County operates ten license plate reader cameras. Records the county released show 3,343 agencies ran 5,171,087 searches against the networks it administers.

## The numbers

<!-- ucc:stats -->
- 5,171,087 - Searches, February 2022 to July 2026
- 3,343 - Agencies that ran at least one search
<!-- /ucc -->

<!-- ucc:callout variant="scope-box" label="A note on this investigation" -->
Nothing on this page is a criticism of the sheriff's office. Weber County is the only county that has let anyone look.
<!-- /ucc -->

## What Utah law requires

<!-- ucc:quote source="Utah Code" -->
"cameras used in combination with computer algorithms to convert an image of a license plate into computer-readable data."

-- [§ 41-6a-2002(2)](https://le.utah.gov/xcode/Title41/Chapter6A/41-6a-S2002.html)
<!-- /ucc -->

<!-- ucc:figure caption="Figure 1. The order form" -->
![The Weber County order form, page 3](order-form.png)
<!-- /ucc -->

<!-- ucc:table variant="own-table" -->
| Field | Example |
|---|---|
| Agency | Ogden Police Department |
<!-- /ucc -->

<!-- ucc:accordion -->
### What this is about
Three candidates filed a petition.
### What happened next
The court dismissed it.
<!-- /ucc -->

<!-- ucc:cta variant="related-cta" heading="The records" -->
Every figure comes from released records.
- [Read the full investigation](/alpr)
<!-- /ucc -->
`;

test('kit example markdown → header fields and typed blocks', () => {
  const { html } = markdownToHtml(EXAMPLE, { keepImages: true });
  const r = parse(html);
  assert.equal(r.title, 'Ten cameras in one Utah county were searched 5.1 million times');
  assert.equal(r.author, 'Conner Radcliffe');
  assert.equal(r.body.header.eyebrow, 'Surveillance investigation');
  assert.equal(r.body.header.date, 'August 12, 2026');
  assert.match(r.body.header.summary, /^<p>Weber County operates/);
  assert.deepEqual(r.body.sections.map(s => s.heading), ['The numbers', 'What Utah law requires']);
  const [numbers, law] = r.body.sections;
  assert.deepEqual(numbers.blocks.map(b => b.type), ['stats', 'callout']);
  assert.deepEqual(numbers.blocks[0].items.map(i => i.num), ['5,171,087', '3,343']);
  assert.equal(numbers.blocks[0].items[1].desc, 'Agencies that ran at least one search');
  assert.equal(numbers.blocks[1].variant, 'scope-box');
  assert.equal(numbers.blocks[1].label, 'A note on this investigation');
  assert.match(numbers.blocks[1].html, /^<p>Nothing on this page/);
  assert.deepEqual(law.blocks.map(b => b.type), ['quote', 'figure', 'table', 'accordion', 'cta']);
  const [quote, figure, table, accordion, cta] = law.blocks;
  assert.equal(quote.source, 'Utah Code');
  assert.match(quote.html, /^<p>"cameras used/);
  assert.match(quote.cite, /^<a href="https:\/\/le\.utah\.gov[^"]+">§ 41-6a-2002\(2\)<\/a>$/);
  assert.equal(figure.alt, 'The Weber County order form, page 3');
  assert.equal(figure.caption, 'Figure 1. The order form');
  assert.equal(table.variant, 'own-table');
  assert.deepEqual(table.head, ['Field', 'Example']);
  assert.deepEqual(table.rows, [['Agency', 'Ogden Police Department']]);
  assert.deepEqual(accordion.items.map(i => i.summary), ['What this is about', 'What happened next']);
  assert.equal(accordion.items[0].open, true);
  assert.equal(cta.heading, 'The records');
  assert.deepEqual(cta.buttons, [{ label: 'Read the full investigation', href: '/alpr' }]);
  assert.equal(r.report.raw, 0, r.report.notes.join('; '));
});
