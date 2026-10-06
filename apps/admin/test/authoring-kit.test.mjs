import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthoringKit } from '../lib/authoring-kit.js';

const kit = {
  entries: [
    { className: 'pull-quote', label: 'Pull quote', applies: ['div'], description: 'Large quoted line.', group: 'Report pages', declarations: 'font-size: 28px; color: var(--navy);' },
    { className: 'impact-grid', label: 'Impact Grid', applies: ['div'], description: 'Used on <div> in index. Sets: display: flex; (auto)', group: 'Impact stats', declarations: 'display: flex; /* + */ flex-direction: column;' },
    { className: 'nav-links', label: 'Nav', applies: ['ul'], description: 'Site nav.', group: 'Navigation', declarations: 'display: flex;' },
    { className: 'undoc', label: 'undoc', applies: [], description: '', group: undefined, declarations: 'color: red;' },
  ],
  undocumented: ['undoc'],
};
const rules = [
  { scope: 'template', templateKey: 'report', selector: 'main > h1', classes: ['report-title'], priority: 10, note: 'headline' },
  { scope: 'page', documentId: 'x', selector: 'p', classes: ['lead'], priority: 10 },
];

test('kit carries the static sections and the dynamic catalog, rules and tokens', () => {
  const md = buildAuthoringKit({ kit, rules, coverageKeys: ['alpr'], designTokens: '\n  --navy: #1B2F4E;\n  --red: #C0392B;\n', generatedAt: new Date('2026-10-05T12:00:00Z') });
  assert.match(md, /^# Utah Civic Compact: authoring kit/);
  assert.match(md, /Generated 2026-10-05/);
  for (const h of ['## 1. What this file is', '## 2. Voice', '## 3. Page fields', '## 4. Shape of a piece', '## 5. HTML rules', '## 6. Styling', '### 6.1 Document frame', '### 6.2 Design tokens', '### 6.3 Template rules', '### 6.4 Reference fragment', '### 6.5 Classes you may use', '## 7. Before you hand it over']) assert.ok(md.includes(h), h);
  assert.match(md, /<!-- 1\. Hero[\s\S]*<div class="subpage-hero">[\s\S]*<section class="impact section">[\s\S]*<div class="news-section">/, 'reference fragment is present');
  assert.match(md, /\*\*Not in the current stylesheet\*\*[^\n]*`subpage-hero`/, 'classes the test stylesheet lacks are flagged');
  assert.match(md, /\*\*Offered in 6\.5 but not shown above:\*\* `pull-quote`/, 'offered classes the example omits are listed');
  assert.ok(!/Offered in 6\.5 but not shown above:[^\n]*`impact-grid`/.test(md), 'a class the example uses is not listed as unshown');
  assert.match(md, /\| `main > h1` \| `report-title` \| headline \|/);
  assert.ok(!md.includes('`lead`'), 'page-scoped rules are not template rules');
  assert.match(md, /- `pull-quote` on `<div>`: Large quoted line\.\n  CSS: `font-size: 28px; color: var\(--navy\);`/, 'catalog entry carries its CSS');
  assert.match(md, /- `impact-grid` on `<div>`: Used on `<div>` in index\.\n  CSS: `display: flex; \/\* \+ \*\/ flex-direction: column;`/, 'auto "Sets:" tail is dropped, CSS printed once');
  assert.match(md, /```css\n--navy: #1B2F4E;\n--red: #C0392B;\n```/, 'design tokens printed one per line');
  assert.match(md, /<div class="subpage-hero">[\s\S]*<section class="section">\n  <div class="container">/, 'skeleton uses the document frame');
  assert.ok(!md.includes('nav-links'), 'chrome groups are hidden from authors');
  assert.ok(!md.includes('`undoc`'), 'unannotated classes are not offered');
  assert.match(md, /Keys that exist today: `alpr`/);
  assert.match(md, /`blockquote`, `code`/);
  assert.ok(!md.includes('`svg`') && !md.includes('`header`'), 'svg/chrome tags are not offered');
});

test('kit degrades without rules or coverage keys', () => {
  const md = buildAuthoringKit({ kit: { entries: [], undocumented: [] } });
  assert.match(md, /No template rules are defined yet/);
  assert.match(md, /No coverage keys exist yet/);
  assert.match(md, /No annotated classes were found/);
  assert.match(md, /design tokens could not be read/);
});

test('the kit practises its own voice rules: no em or en dashes in the static text', () => {
  const md = buildAuthoringKit({ kit: { entries: [], undocumented: [] } });
  const hits = [...md.matchAll(/[—–]/g)].length;
  assert.equal(hits, 0, 'kit text contains em/en dashes');
  const dynamic = buildAuthoringKit({ kit: { entries: [{ className: 'x', applies: ['p'], description: 'A — dashed description', group: 'Typography' }], undocumented: [] }, rules: [{ scope: 'template', selector: 'p', classes: ['x'], priority: 1, note: 'an – en dash' }] });
  assert.equal([...dynamic.matchAll(/[—–]/g)].length, 0, 'dynamic text is dash-normalised');
});
