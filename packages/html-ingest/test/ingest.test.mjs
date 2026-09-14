// Phase 2 DoD (build-spec-aws.md §19): every sanitizer rule has a passing
// malicious-input test; node ids tested across paste → edit → re-paste with an
// asserted match rate; report-never-silently-drop verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ingest, stripNids } = require('../index.js');

const KIT = new Set(['lead', 'report-title', 'pull-quote', 'byline']);

// ── Sanitizer: malicious inputs ─────────────────────────────────────────────

test('strips <script> including its content', () => {
  const { bodyHtmlNormalized, report } = ingest('<p>hi</p><script>alert(1)</script>');
  assert.ok(!/script|alert/.test(bodyHtmlNormalized));
  assert.ok(report.removed.some(r => r.kind === 'tag' && r.tag === 'script'));
});

test('strips every on* event handler', () => {
  const { bodyHtmlNormalized, report } = ingest(
    '<p onclick="steal()" onmouseover="x()" ONLOAD="y()">text</p>');
  assert.ok(!/onclick|onmouseover|onload|steal/i.test(bodyHtmlNormalized));
  assert.ok(report.removed.some(r => String(r.attr).startsWith('on*')));
});

test('strips style attributes and <style> blocks', () => {
  const { bodyHtmlNormalized, report } = ingest(
    '<p style="position:fixed">x</p><style>body{display:none}</style>');
  assert.ok(!/style/i.test(bodyHtmlNormalized));
  assert.ok(report.removed.some(r => r.attr === 'style'));
});

test('rejects javascript: URLs', () => {
  const { bodyHtmlNormalized } = ingest('<a href="javascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(bodyHtmlNormalized));
});

test('rejects data: URLs on img src', () => {
  const { bodyHtmlNormalized } = ingest('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="">');
  assert.ok(!/data:/i.test(bodyHtmlNormalized));
});

test('rejects obfuscated scheme (whitespace/case tricks)', () => {
  const out1 = ingest('<a href="  JaVaScRiPt:alert(1)">x</a>').bodyHtmlNormalized;
  const out2 = ingest('<a href="jav&#x09;ascript:alert(1)">x</a>').bodyHtmlNormalized;
  assert.ok(!/javascript/i.test(out1));
  assert.ok(!/javascript/i.test(out2));
});

test('allows http, https, mailto, tel, relative, and #fragment URLs', () => {
  const html = '<a href="https://a.b">1</a><a href="mailto:x@y.z">2</a>'
    + '<a href="tel:+18015551212">3</a><a href="/page">4</a><a href="#sec">5</a>';
  const { bodyHtmlNormalized } = ingest(html);
  for (const frag of ['https://a.b', 'mailto:x@y.z', 'tel:+18015551212', '/page', '#sec']) {
    assert.ok(bodyHtmlNormalized.includes(frag), frag);
  }
});

test('strips iframe/object/embed/form/input/link/meta/base entirely', () => {
  const html = '<iframe src="https://evil"></iframe><object data="x"></object>'
    + '<embed src="x"><form action="/steal"><input name="pw"></form>'
    + '<link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0"><base href="https://evil/">'
    + '<p>survivor</p>';
  const { bodyHtmlNormalized } = ingest(html);
  assert.ok(!/iframe|object|embed|form|input|link|meta|base|evil|steal/i.test(bodyHtmlNormalized));
  assert.ok(bodyHtmlNormalized.includes('survivor'));
});

test('nested/malformed payloads cannot smuggle a script through', () => {
  const cases = [
    '<div><div><script>alert(1)</script></div></div>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<p><!--<script>alert(1)</script>-->x</p>',
    '<a href="java\u0000script:alert(1)">x</a>',
    '<details open ontoggle=alert(1)>x</details>',
  ];
  for (const c of cases) {
    const { bodyHtmlNormalized } = ingest(c, { knownClasses: KIT });
    assert.ok(!/<script|onerror|onload|ontoggle|javascript:/i.test(bodyHtmlNormalized), c);
  }
});

test('malformed HTML parses without throwing and still sanitizes', () => {
  const { bodyHtmlNormalized, report } = ingest('<p>unclosed <b>bold <table><td>cell');
  assert.ok(bodyHtmlNormalized.includes('unclosed'));
  assert.ok(Array.isArray(report.warnings));
});

test('sanitization is idempotent', () => {
  const first = ingest('<p onclick="x()">a</p><script>b</script><em>c</em>', { knownClasses: KIT });
  const second = ingest(stripNids(first.bodyHtmlNormalized), { knownClasses: KIT });
  assert.equal(stripNids(second.bodyHtmlNormalized), stripNids(first.bodyHtmlNormalized));
});

// ── Full-document paste ─────────────────────────────────────────────────────

test('full document paste extracts body and warns', () => {
  const { bodyHtmlNormalized, report } = ingest(
    '<!doctype html><html><head><title>T</title><meta name="x"></head><body><p>content</p></body></html>');
  assert.ok(bodyHtmlNormalized.includes('content'));
  assert.ok(!/title|meta/i.test(bodyHtmlNormalized));
  assert.ok(report.warnings.some(w => /body/i.test(w)));
});

// ── body_html_raw is untouched ──────────────────────────────────────────────

test('bodyHtmlRaw is byte-identical to the paste', () => {
  const raw = '<p style="x" onclick="y">RAW</p><script>z</script>';
  assert.equal(ingest(raw).bodyHtmlRaw, raw);
});

// ── Node ids ────────────────────────────────────────────────────────────────

test('nids are deterministic and unique', () => {
  const html = '<h1>Title</h1><p>one</p><p>one</p><p>two</p>';
  const a = ingest(html).bodyHtmlNormalized;
  const b = ingest(html).bodyHtmlNormalized;
  assert.equal(a, b);
  const nids = [...a.matchAll(/data-nid="([0-9a-f]+)"/g)].map(m => m[1]);
  assert.equal(nids.length, 4);
  assert.equal(new Set(nids).size, 4);
});

test('paste → edit → re-paste carries ids: >=80% match on a small edit', () => {
  const v1 = '<h1>Report</h1><p class="x">intro paragraph</p><p>second</p><p>third</p><ul><li>a</li><li>b</li></ul>';
  const first = ingest(v1, { knownClasses: KIT });
  // Edit: reword one paragraph, add one, keep the rest.
  const v2 = '<h1>Report</h1><p class="x">intro paragraph REVISED</p><p>second</p><p>third</p><p>brand new</p><ul><li>a</li><li>b</li></ul>';
  const second = ingest(v2, { knownClasses: KIT, previousNormalized: first.bodyHtmlNormalized });
  const { matched, new: fresh, removed } = second.report.match;
  assert.ok(matched >= 6, `matched ${matched}`);       // 7 of 8 carry over
  assert.equal(fresh, 1);                              // the brand-new <p>
  assert.equal(removed, 0);
  assert.ok(matched / (matched + fresh) >= 0.8);
});

test('identical re-paste matches 100%', () => {
  const v1 = '<h1>T</h1><p>a</p><p>b</p>';
  const first = ingest(v1);
  const second = ingest(v1, { previousNormalized: first.bodyHtmlNormalized });
  assert.deepEqual(second.report.match, { matched: 3, new: 0, removed: 0 });
  assert.equal(second.bodyHtmlNormalized, first.bodyHtmlNormalized);
});

// ── Class partition ─────────────────────────────────────────────────────────

test('known classes kept, foreign stripped and reported', () => {
  const { bodyHtmlNormalized, report } = ingest(
    '<p class="lead docx-para MsoNormal">x</p>', { knownClasses: KIT });
  assert.ok(/class="lead"/.test(bodyHtmlNormalized));
  assert.ok(!/docx-para|MsoNormal/.test(bodyHtmlNormalized));
  assert.equal(report.foreignClasses.length, 2);
});

test('foreignClassMap substitutes on ingest', () => {
  const { bodyHtmlNormalized, report } = ingest(
    '<p class="docx-heading">x</p>',
    { knownClasses: KIT, foreignClassMap: { 'docx-heading': 'report-title' } });
  assert.ok(/class="report-title"/.test(bodyHtmlNormalized));
  assert.equal(report.foreignClasses.length, 0);
});

// ── Accessibility gate ──────────────────────────────────────────────────────

test('img without alt blocks; alt="" passes', () => {
  const bad = ingest('<img src="/a.png">');
  assert.equal(bad.ok, false);
  assert.ok(bad.report.a11y.some(e => e.rule === 'img-alt'));
  const good = ingest('<img src="/a.png" alt="">');
  assert.equal(good.ok, true);
});

test('more than one h1 blocks', () => {
  const r = ingest('<h1>a</h1><h1>b</h1>');
  assert.equal(r.ok, false);
  assert.ok(r.report.a11y.some(e => e.rule === 'single-h1'));
});

test('skipped heading level blocks; proper order passes', () => {
  const bad = ingest('<h1>a</h1><h3>b</h3>');
  assert.ok(bad.report.a11y.some(e => e.rule === 'heading-skip'));
  const good = ingest('<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>');
  assert.equal(good.ok, true);
});

// ── Removal report completeness (diff-based; Phase 2 review regressions) ────

test('disallowed non-URL attributes are reported (e.g. contenteditable)', () => {
  const { bodyHtmlNormalized, report } = ingest('<p contenteditable="true" tabindex="0">x</p>');
  assert.ok(!/contenteditable|tabindex/.test(bodyHtmlNormalized));
  assert.ok(report.removed.some(r => r.kind === 'attribute' && r.attr === 'contenteditable'));
  assert.ok(report.removed.some(r => r.kind === 'attribute' && r.attr === 'tabindex'));
});

test('boolean download/open survive', () => {
  const out = stripNids(ingest('<a href="/x.csv" download>y</a><details open><summary>s</summary>t</details>').bodyHtmlNormalized);
  assert.match(out, /download/);
  assert.match(out, /<details open/);
});

test('<a target="_blank"> is kept and always carries rel="noopener"; other targets are dropped', () => {
  const a = ingest('<a href="https://a.b" target="_blank">x</a>').bodyHtmlNormalized;
  assert.match(a, /target="_blank"/);
  assert.match(a, /rel="noopener"/);
  const b = ingest('<a href="https://a.b" target="_blank" rel="nofollow">x</a>').bodyHtmlNormalized;
  assert.match(b, /rel="nofollow noopener"/);
  const c = ingest('<a href="https://a.b" target="_top">x</a>').bodyHtmlNormalized;
  assert.doesNotMatch(c, /target=/);
});

test('decorative inline SVG keeps geometry/paint attributes only; href and script never survive', () => {
  const svg = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"><path d="M1 1"/><a href="javascript:x"><circle cx="1" cy="1" r="1"/></a><script>x()</script><use href="#y"/></svg>';
  const out = stripNids(ingest(svg).bodyHtmlNormalized);
  assert.match(out, /<svg viewbox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor">/i);
  assert.match(out, /<path d="M1 1"\/?>/);
  assert.doesNotMatch(out, /javascript|<script|<use|href=/);
});

test('UTF-8 text stays literal (no numeric entities for em dashes or apostrophes)', () => {
  const out = stripNids(ingest("<p>it’s — fine &amp; <b>ok</b></p>").bodyHtmlNormalized);
  assert.equal(out, "<p>it’s — fine &amp; <b>ok</b></p>");
});

test('bad scheme in srcset is stripped AND reported', () => {
  const { bodyHtmlNormalized, report } = ingest('<img srcset="javascript:alert(1) 1x" alt="">');
  assert.ok(!/javascript/i.test(bodyHtmlNormalized));
  assert.ok(report.removed.some(r => r.kind === 'url' && r.attr === 'srcset'));
});

test('external URL in srcset gets a hotlink warning', () => {
  const { report } = ingest('<img srcset="https://evil.example/pic.png 1x" alt="">');
  assert.ok(report.warnings.some(w => /evil\.example/.test(w)));
});

test('relative image path gets a broken-page warning', () => {
  const { report } = ingest('<img src="images/chart.png" alt="">');
  assert.ok(report.warnings.some(w => /images\/chart\.png/.test(w)));
});

// ── stripNids ───────────────────────────────────────────────────────────────

test('stripNids removes every data-nid and nothing else', () => {
  const { bodyHtmlNormalized } = ingest('<p class="lead" data-x="keep">a</p>', { knownClasses: KIT });
  const stripped = stripNids(bodyHtmlNormalized);
  assert.ok(!/data-nid/.test(stripped));
  assert.ok(/data-x="keep"/.test(stripped));
  assert.ok(/class="lead"/.test(stripped));
});

test('allow_scripts keeps only allowlisted-host <script src>, always empty; off strips all', () => {
  const raw = '<p>a</p><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script><script src="https://evil.example/x.js"></script><script>alert(1)</script><script src="https://challenges.cloudflare.com/x.js">inline()</script><script src="http://challenges.cloudflare.com/y.js"></script>';
  const on = stripNids(ingest(raw, { allowScripts: true }).bodyHtmlNormalized);
  assert.equal(on, '<p>a</p><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script><script src="https://challenges.cloudflare.com/x.js"></script>');
  assert.doesNotMatch(on, /alert|inline\(|evil|http:/);
  assert.equal(stripNids(ingest(raw).bodyHtmlNormalized), '<p>a</p>');
});
