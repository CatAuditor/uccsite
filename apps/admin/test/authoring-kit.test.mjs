import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthoringKit } from '../lib/authoring-kit.js';

const kit = {
  entries: [
    { className: 'pull-quote', label: 'Pull quote', applies: ['div'], description: 'Large quoted line.', group: 'Report pages' },
    { className: 'nav-links', label: 'Nav', applies: ['ul'], description: 'Site nav.', group: 'Navigation' },
    { className: 'undoc', label: 'undoc', applies: [], description: '', group: undefined },
  ],
  undocumented: ['undoc'],
};
const rules = [
  { scope: 'template', templateKey: 'report', selector: 'main > h1', classes: ['report-title'], priority: 10, note: 'headline' },
  { scope: 'page', documentId: 'x', selector: 'p', classes: ['lead'], priority: 10 },
];

test('kit carries the static sections and the dynamic catalog, rules and tokens', () => {
  const md = buildAuthoringKit({ kit, rules, coverageKeys: ['alpr'], generatedAt: new Date('2026-10-05T12:00:00Z') });
  assert.match(md, /^# Utah Civic Compact: authoring kit/);
  assert.match(md, /Generated 2026-10-05/);
  for (const h of ['## 1. What this file is', '## 2. Voice', '## 3. Page fields', '## 4. Shape of a piece', '## 5. HTML rules', '## 6. Styling', '## 7. Before you hand it over']) assert.ok(md.includes(h), h);
  assert.match(md, /\| `main > h1` \| `report-title` \| headline \|/);
  assert.ok(!md.includes('`lead`'), 'page-scoped rules are not template rules');
  assert.match(md, /\| `pull-quote` \| `<div>` \| Large quoted line\. \|/);
  assert.ok(!md.includes('nav-links'), 'chrome groups are hidden from authors');
  assert.ok(!md.includes('| `undoc`'), 'unannotated classes are not offered');
  assert.match(md, /Keys that exist today: `alpr`/);
  assert.match(md, /`blockquote`, `code`/);
  assert.ok(!md.includes('`svg`') && !md.includes('`header`'), 'svg/chrome tags are not offered');
});

test('kit degrades without rules or coverage keys', () => {
  const md = buildAuthoringKit({ kit: { entries: [], undocumented: [] } });
  assert.match(md, /No template rules are defined yet/);
  assert.match(md, /No coverage keys exist yet/);
  assert.match(md, /No annotated classes were found/);
});

test('the kit practises its own voice rules: no em or en dashes in the static text', () => {
  const md = buildAuthoringKit({ kit: { entries: [], undocumented: [] } });
  const hits = [...md.matchAll(/[—–]/g)].length;
  assert.equal(hits, 0, 'kit text contains em/en dashes');
  const dynamic = buildAuthoringKit({ kit: { entries: [{ className: 'x', applies: ['p'], description: 'A — dashed description', group: 'Typography' }], undocumented: [] }, rules: [{ scope: 'template', selector: 'p', classes: ['x'], priority: 1, note: 'an – en dash' }] });
  assert.equal([...dynamic.matchAll(/[—–]/g)].length, 0, 'dynamic text is dash-normalised');
});
