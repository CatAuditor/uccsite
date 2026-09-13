import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseStyleKit, classNames } = require('../index.js');

const SAMPLE = `
/* MAIN */
:root { --navy: #123; }

/* @class lead
   @label Lead paragraph
   @applies p
   @group Typography
   @desc Larger intro paragraph. Use on the first paragraph after the title. */
.lead { font-size: 1.25rem; line-height: 1.5; }

.btn { display: inline-flex; }
.btn-primary { background: var(--navy); }

@media (max-width: 600px) {
  .lead { font-size: 1.1rem; }
  .mobile-only { display: block; }
}

h2.section-title, .card .badge { color: red; }
`;

test('annotated class carries label/applies/group/desc', () => {
  const kit = parseStyleKit(SAMPLE);
  const lead = kit.entries.find(e => e.className === 'lead');
  assert.equal(lead.label, 'Lead paragraph');
  assert.deepEqual(lead.applies, ['p']);
  assert.equal(lead.group, 'Typography');
  assert.match(lead.description, /intro paragraph/);
  assert.match(lead.declarations, /font-size: 1\.25rem/);
  // the @media redefinition appends
  assert.match(lead.declarations, /1\.1rem/);
});

test('unannotated classes are catalogued with name as label and listed undocumented', () => {
  const kit = parseStyleKit(SAMPLE);
  const btn = kit.entries.find(e => e.className === 'btn');
  assert.equal(btn.label, 'btn');
  assert.ok(kit.undocumented.includes('btn'));
  assert.ok(!kit.undocumented.includes('lead'));
});

test('classes inside @media and compound/multi selectors are found', () => {
  const names = classNames(parseStyleKit(SAMPLE));
  for (const c of ['mobile-only', 'section-title', 'card', 'badge', 'btn-primary']) {
    assert.ok(names.has(c), c);
  }
  assert.ok(!names.has('root'));
});

// ── Regressions from the Phase 2 review ─────────────────────────────────────

test('block-less at-statements do not swallow the following rule', () => {
  const kit = parseStyleKit('@import url(x.css); @charset "utf-8"; .lead { font-size: 1rem; } .after { color: red; }');
  const names = classNames(kit);
  assert.ok(names.has('lead'), 'lead survived the @import');
  assert.ok(names.has('after'));
});

test('braces inside strings and comments do not corrupt blocks', () => {
  const kit = parseStyleKit('.a { content: "}"; color: red; } .b { /* } */ background: blue; } .c { color: green; }');
  const a = kit.entries.find(e => e.className === 'a');
  const b = kit.entries.find(e => e.className === 'b');
  assert.match(a.declarations, /color: red/);
  assert.match(b.declarations, /background: blue/);
  assert.ok(classNames(kit).has('c'));
});

test('duplicate rule bodies dedupe without substring false positives', () => {
  const kit = parseStyleKit('.x { color: red; } .x { color: red; } .x { color: r }');
  const x = kit.entries.find(e => e.className === 'x');
  // exact duplicate collapsed; "color: r" kept even though it's a substring
  assert.equal(x.declarations, 'color: red; /* + */ color: r');
});

test('entries carry only the declared StyleKitEntry shape', () => {
  const kit = parseStyleKit('.y { color: red; }');
  assert.deepEqual(Object.keys(kit.entries[0]).sort(),
    ['applies', 'className', 'declarations', 'description', 'group', 'label']);
});

test('parses the real stylesheet without errors and finds known classes', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'css', 'styles.css'), 'utf8');
  const kit = parseStyleKit(css);
  assert.ok(kit.entries.length > 100, `found ${kit.entries.length} classes`);
  const names = classNames(kit);
  for (const c of ['btn', 'btn-primary', 'section-title', 'site-header', 'tracker-recent', 'donation-tracker']) {
    assert.ok(names.has(c), c);
  }
});
