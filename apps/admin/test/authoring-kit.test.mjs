import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthoringKit, buildAuthoringKitHtml } from '../lib/authoring-kit.js';

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
  assert.match(md, /^# Utah Civic Compact: authoring and style kit/);
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
  assert.match(md, /<div class="subpage-hero">[\s\S]*<section class="section bg-cream">\n  <div class="container">\n    <div class="prose">/, 'skeleton uses the document frame with the prose wrapper');
  assert.ok(!md.includes('nav-links'), 'chrome groups are hidden from authors');
  assert.ok(!md.includes('`undoc`'), 'unannotated classes are not offered');
  assert.match(md, /Keys that exist today: `alpr`/);
  assert.match(md, /\*\*Classes copied from an existing page on the site\.\*\*[^\n]*paper-body[^\n]*release-meta/, 'warns against reusing per-page classes from live pages');
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

test('the .html download is one self-contained page: site CSS embedded, fragment rendered live and shown as source', () => {
  const siteCss = '.subpage-hero { background: navy; } /* a </style> inside a comment must not close the block */';
  const html = buildAuthoringKitHtml({ kit, rules, coverageKeys: ['alpr'], designTokens: '--navy: #1B2F4E;', siteCss, generatedAt: new Date('2026-10-05T12:00:00Z') });
  assert.match(html, /^<!DOCTYPE html>\n<html lang="en">/);
  assert.match(html, /<title>Utah Civic Compact: authoring and style kit for long-form pages<\/title>/);
  assert.ok(html.includes('<style>\n.subpage-hero { background: navy; } /* a <\/style> inside'), 'site CSS embedded verbatim with </style> escaped');
  assert.ok(html.includes('<div class="kit-note">'), 'file note explains the embedded stylesheet');
  assert.match(html, /<div class="kit-live">[\s\S]*<div class="subpage-hero">\n  <div class="section-label">Surveillance investigation<\/div>/, 'fragment rendered live');
  assert.ok(html.includes('&lt;div class=&quot;subpage-hero&quot;&gt;'), 'fragment source shown escaped');
  assert.equal((html.match(/<div class="kit-live">/g) || []).length, 1, 'live block spliced exactly once');
  assert.ok(!html.includes('<!--KIT:LIVE-->'), 'marker consumed');
  assert.match(html, /<h2>6\. Styling/, 'markdown headings rendered');
  assert.match(html, /<table>[\s\S]*<code>main &gt; h1<\/code>/, 'rules table rendered');
  assert.equal((html.match(/<div class="kit-doc">/g) || []).length, 2, 'guide text wrapped before and after the live block');
});

test('the .html download carries a stale-stylesheet warning first when the route passes a notice', () => {
  const html = buildAuthoringKitHtml({ kit, notice: 'The live site stylesheet differs from the admin build.' });
  const warn = html.indexOf('<div class="kit-note kit-warn">'), note = html.indexOf('<div class="kit-note">');
  assert.ok(warn > 0 && warn < note, 'warning precedes the file note');
  assert.match(html, /Warning: this kit may be incomplete\.<\/strong> The live site stylesheet differs/);
  assert.ok(!buildAuthoringKitHtml({ kit }).includes('<div class="kit-note kit-warn">'), 'no warning without a notice');
});
