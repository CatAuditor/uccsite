import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serialize, parse, validateBody, emptyBody, newSection, newBlock, BLOCK_TYPES, sampleHtml, slugify } from '../index.js';
const require = createRequire(import.meta.url);
const { ingest, parseFragmentTree } = require('@uccsite/html-ingest');

const doc = { title: 'A Report', author: 'Jarom Gillins' };

function body(sections) {
  const b = emptyBody();
  b.header.eyebrow = 'Policy Paper';
  b.header.summary = 'Lead <strong>text</strong>.';
  b.header.date = 'September 9, 2026';
  b.header.authorTitle = 'Director of Policy';
  b.sections = sections;
  return b;
}
function section(heading, blocks, extra = {}) { return { ...newSection(heading), ...extra, blocks }; }
function block(type, props) { return { ...newBlock(type), ...props }; }

test('serialize: header, byline, contents list and sections in the site frame', () => {
  const html = serialize(body([
    section('I. Summary', [block('prose', { html: '<p>One.</p>' })]),
    section('II. Findings', [block('callout', { variant: 'scope-box', label: 'Scope', html: '<p>Two.</p>' })], { tocLabel: 'Findings' }),
  ]), doc, { authorHref: '/team/jarom-gillins' });
  assert.match(html, /^<div class="subpage-hero">\n<div class="section-label">Policy Paper<\/div>\n<h1>A Report<\/h1>\n<p>Lead <strong>text<\/strong>\.<\/p>/);
  assert.match(html, /<div class="release-meta">\n<span class="release-badge">Utah Civic Compact<\/span>\n<span class="release-date">September 9, 2026<\/span>\n<span class="release-author">By <a href="\/team\/jarom-gillins">Jarom Gillins<\/a>, Director of Policy<\/span>/);
  assert.match(html, /<div class="paper-toc" role="navigation" aria-label="Contents">[\s\S]*<li><a href="#summary">I\. Summary<\/a><\/li>\n<li><a href="#findings">Findings<\/a><\/li>/);
  assert.match(html, /<h2 id="summary" data-section="s[a-z0-9]+">I\. Summary<\/h2>/);
  assert.match(html, /<div class="scope-box" data-block="b[a-z0-9]+">\n<div class="scope-box-label">Scope<\/div>\n<p>Two\.<\/p>\n<\/div>/);
  assert.match(html, /<div class="doc-body">\n<div class="doc-inner">/);
  assert.ok(html.trimEnd().endsWith('</div>\n</div>'));
});

test('serialize: text fields are escaped, rich text passes through, headline overrides the title', () => {
  const b = body([section('<script>', [block('quote', { source: 'A & B', html: '<p>"q"</p>', cite: '<a href="https://x.test">x</a>' })])]);
  b.header.headline = 'Ten cameras <were> searched';
  const html = serialize(b, doc);
  assert.match(html, /<h1>Ten cameras &lt;were&gt; searched<\/h1>/);
  assert.match(html, /<h2 id="script"[^>]*>&lt;script&gt;<\/h2>/);
  assert.match(html, /<span class="quote-source">A &amp; B<\/span>\n<p>"q"<\/p>\n<cite>— <a href="https:\/\/x.test">x<\/a><\/cite>/);
});

test('serialize: bands and full-width blocks leave the reading column', () => {
  const html = serialize(body([
    section('', [block('partsnav', { items: [{ num: 'Part 1', title: 'T', desc: 'D', href: '#p1' }] })]),
    section('Part 1', [block('prose', { html: '<p>a</p>' })], { band: true, bandClasses: ['s-abc123'] }),
    section('Part 2', [block('prose', { html: '<p>b</p>' })], { band: true, classes: ['report-section'] }),
  ]), doc);
  const bands = html.match(/<div class="doc-body[^"]*">/g);
  assert.deepEqual(bands, ['<div class="doc-body">', '<div class="doc-body s-abc123">', '<div class="doc-body">']);
  // the parts nav sits between the first band (byline) and the second
  assert.match(html, /<\/div>\n<\/div>\n<div class="parts-nav"/);
  assert.match(html, /<\/div>\n<div class="doc-body s-abc123">\n<div class="doc-inner">\n<h2 id="part-1"/);
  // a section wrapper sits inside the column
  assert.match(html, /<div class="doc-inner">\n<div class="report-section" data-section="s[a-z0-9]+">\n<h2 id="part-2"/);
});

test('serialize: a legacy frame and legacy box class are written back verbatim', () => {
  const b = body([section('S', [block('callout', { variant: 'callout', legacyClass: 'report-callout', legacyLabelClass: 'callout-label', label: 'Working definition', html: '<p>x</p>' })])]);
  b.header.frame = ['report-body', 'container'];
  const html = serialize(b, doc);
  assert.match(html, /<div class="report-body">\n<div class="container">/);
  assert.ok(!html.includes('doc-body'));
  assert.match(html, /<div class="report-callout" data-block="[^"]+">\n<div class="callout-label">Working definition<\/div>/);
  // parse reads it back the same way
  const r = parse(html);
  assert.deepEqual(r.body.header.frame, ['report-body', 'container']);
  const c = r.body.sections[0].blocks[0];
  assert.equal(c.type, 'callout');
  assert.equal(c.legacyClass, 'report-callout');
  assert.equal(c.label, 'Working definition');
});

test('serialize: byline block replaces the top byline; letterhead layout has no hero', () => {
  const b = body([section('Part 1', [block('byline', {}), block('prose', { html: '<p>a</p>' })])]);
  const html = serialize(b, doc);
  assert.equal((html.match(/release-meta/g) || []).length, 1);
  assert.ok(html.indexOf('<h2') < html.indexOf('release-meta'));
  const letter = body([section('', [block('raw', { html: '<header class="masthead">x</header>' })])]);
  letter.header.layout = 'none';
  const l = serialize(letter, doc);
  assert.ok(!l.includes('subpage-hero') && !l.includes('release-meta'), l);
});

test('every block type has a renderer, an empty() and (when sampled) a sample that survives the ingest', () => {
  for (const [type, def] of Object.entries(BLOCK_TYPES)) {
    const html = serialize(body([section('S', [newBlock(type)])]), doc);
    assert.ok(html.includes('data-block='), `${type} renders`);
    assert.equal(typeof def.empty(), 'object');
    if (def.sample) {
      const s = sampleHtml(type);
      const r = ingest(s, { knownClasses: new Set(['x']) });
      assert.ok(r.bodyHtmlNormalized.length > 0, type);
      assert.equal(r.report.removed.length, 0, `${type}: ${JSON.stringify(r.report.removed)}`);
    }
  }
});

test('validateBody fills defaults and reports unknown block types', () => {
  const { ok, errors, body: b } = validateBody({ header: { eyebrow: 'E' }, sections: [{ heading: 'H', blocks: [{ type: 'prose', html: '<p>x</p>' }, { type: 'nope' }] }] });
  assert.equal(ok, false);
  assert.match(errors[0], /unknown type "nope"/);
  assert.equal(b.header.badge, 'Utah Civic Compact');
  assert.equal(b.sections[0].blocks.length, 1);
  assert.ok(b.sections[0].blocks[0].id);
  assert.equal(validateBody(null).ok, false);
});

test('slugify matches the hand-written anchors', () => {
  assert.equal(slugify('III. What was actually purchased?'), 'what-was-actually-purchased');
  assert.equal(slugify('Appendix A. Draft definitions'), 'appendix-a-draft-definitions');
  assert.equal(slugify('Join Us'), 'join-us');
});

test('parse: markers from the authoring kit become header fields and typed blocks', () => {
  const html = `<!-- ucc:header eyebrow="Policy Paper" date="September 9, 2026" author="Jarom Gillins" author-title="Director of Policy" -->
<h1>Title</h1>
<p>Lead paragraph.</p>
<!-- ucc:section eyebrow="Part 1" dek="One sentence." -->
<h2>First</h2>
<p>Body.</p>
<!-- ucc:callout variant="scope-box" label="Scope" --><p>Only this.</p><!-- /ucc -->
<!-- ucc:stats --><ul><li>5,171,087 — Searches</li><li>3,343 — Agencies</li></ul><!-- /ucc -->
<!-- ucc:quote source="Utah Code" --><p>"text"</p><p>— <a href="https://le.utah.gov">§ 1</a></p><!-- /ucc -->
<h2>Second</h2>
<p>More.</p>`;
  const r = parse(html);
  assert.equal(r.title, 'Title');
  assert.equal(r.author, 'Jarom Gillins');
  assert.equal(r.body.header.eyebrow, 'Policy Paper');
  assert.equal(r.body.header.authorTitle, 'Director of Policy');
  assert.equal(r.body.header.summary, '<p>Lead paragraph.</p>');
  assert.equal(r.body.header.toc, 'auto');
  const [s1, s2] = r.body.sections;
  assert.equal(s1.heading, 'First');
  assert.equal(s1.eyebrow, 'Part 1');
  assert.equal(s1.dek, 'One sentence.');
  assert.deepEqual(s1.blocks.map(b => b.type), ['prose', 'callout', 'stats', 'quote']);
  assert.equal(s1.blocks[1].variant, 'scope-box');
  assert.equal(s1.blocks[1].label, 'Scope');
  assert.equal(s1.blocks[1].html, '<p>Only this.</p>');
  assert.deepEqual(s1.blocks[2].items.map(i => [i.num, i.desc]), [['5,171,087', 'Searches'], ['3,343', 'Agencies']]);
  assert.equal(s1.blocks[3].source, 'Utah Code');
  assert.equal(s2.heading, 'Second');
  assert.equal(r.report.raw, 0);
});

test('parse: plain document heuristics (a .docx conversion)', () => {
  const html = `<p>Surveillance investigation</p>
<h1>Ten cameras</h1>
<p>Weber County operates ten cameras.</p>
<p>By Conner Radcliffe, Investigations</p>
<p>August 12, 2026</p>
<h2>The numbers</h2>
<p>a</p><ul><li>b</li></ul>
<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
<blockquote><p>quoted</p></blockquote>
<h2>Second</h2><p>c</p>`;
  const r = parse(html);
  assert.equal(r.body.header.eyebrow, 'Surveillance investigation');
  assert.equal(r.title, 'Ten cameras');
  assert.equal(r.body.header.summary, '<p>Weber County operates ten cameras.</p>');
  assert.equal(r.author, 'Conner Radcliffe');
  assert.equal(r.body.header.authorTitle, 'Investigations');
  assert.equal(r.body.header.date, 'August 12, 2026');
  assert.equal(r.body.header.badge, 'Utah Civic Compact');
  assert.deepEqual(r.body.sections.map(s => s.heading), ['The numbers', 'Second']);
  assert.deepEqual(r.body.sections[0].blocks.map(b => b.type), ['prose', 'table', 'quote']);
  assert.deepEqual(r.body.sections[0].blocks[1].head, ['A', 'B']);
  assert.equal(r.report.raw, 0);
});

test('parse: unknown markup is kept as Custom HTML and counted', () => {
  const r = parse('<h1>T</h1><h2>S</h2><div class="weird"><p>x</p><p>y</p></div><p>z</p>');
  assert.equal(r.report.raw, 1);
  assert.deepEqual(r.body.sections[0].blocks.map(b => b.type), ['raw', 'prose']);
  assert.match(r.body.sections[0].blocks[0].html, /^<div class="weird">/);
});

// Legacy conversion: every tracked document round-trips with identical text.
function flatText(html) {
  const out = [];
  (function walk(n) { for (const c of n.children || []) { if (c.type === 'text' && c.data.trim()) out.push(c.data.replace(/\s+/g, ' ').trim()); walk(c); } })(parseFragmentTree(html));
  return out.join(' ');
}
for (const slug of ['how-did-this-happen', 'alpr', 'stratos', 'weber-county', 'privacy-report', 'theory', 'privacy', 'dignity-index-statement']) {
  test(`legacy round-trip: ${slug}`, () => {
    const legacy = JSON.parse(readFileSync(new URL(`../../../docs/migration/documents/${slug}.document.json`, import.meta.url), 'utf8'));
    const r = parse(legacy.bodyHtmlRaw);
    if (r.title && r.title !== legacy.title) r.body.header.headline = r.title;
    const html = serialize(r.body, { title: legacy.title, author: r.author || legacy.author }, { authorHref: r.authorHref });
    const known = new Set();
    const a = ingest(legacy.bodyHtmlRaw, { knownClasses: known }).bodyHtmlNormalized;
    const b = ingest(html, { knownClasses: known }).bodyHtmlNormalized;
    assert.equal(flatText(b), flatText(a));
    if (slug !== 'dignity-index-statement') assert.equal(r.report.raw, 0, r.report.notes.join('; '));
  });
}
