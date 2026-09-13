// Phase 2 DoD: style resolution tested including priority collisions and
// replace vs append; template rule set applied to a naked semantic document
// snapshot-matches; selector subset enforced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateSelector, matchCount, applyStyles, orphanedOverrides } = require('../index.js');
const { ingest } = require('@uccsite/html-ingest');

// ── Selector subset ─────────────────────────────────────────────────────────

test('accepts the supported selector subset', () => {
  for (const s of ['p', '.lead', 'main p', 'main > h1', 'p:first-of-type',
    'li:last-of-type', 'tr:nth-of-type(2)', 'tr:nth-of-type(odd)',
    'p:not(.lead)', 'blockquote > p:first-of-type', 'div.card p']) {
    assert.equal(validateSelector(s).ok, true, s);
  }
});

test('rejects everything outside the subset', () => {
  for (const s of ['#id', '[data-x]', 'p + p', 'p ~ p', 'a:hover', '*',
    'p:nth-child(2)', 'p::before', 'p, div', 'p:not(a > b)', '']) {
    assert.equal(validateSelector(s).ok, false, s);
  }
});

// ── Resolution ──────────────────────────────────────────────────────────────

const DOC = '<h1 data-nid="n1">Title</h1><p data-nid="n2" class="kept">intro</p><p data-nid="n3">second</p>';

test('rules union classes in ascending priority; paste classes survive as priority 0', () => {
  const out = applyStyles(DOC, [
    { id: 'r2', selector: 'p', classes: ['b'], priority: 2 },
    { id: 'r1', selector: 'p:first-of-type', classes: ['a'], priority: 1 },
  ]);
  assert.match(out, /<p data-nid="n2" class="kept a b">/);
  assert.match(out, /<p data-nid="n3" class="b">/);
});

test('priority collision: both rules apply, union is stable regardless of input order', () => {
  const rules = [
    { id: 'x', selector: 'h1', classes: ['one'], priority: 5 },
    { id: 'y', selector: 'h1', classes: ['two'], priority: 5 },
  ];
  const a = applyStyles(DOC, rules);
  const b = applyStyles(DOC, [...rules].reverse());
  assert.match(a, /class="one two"|class="two one"/);
  assert.equal(a, applyStyles(DOC, rules)); // deterministic for same input order
  assert.ok(/one/.test(b) && /two/.test(b));
});

test('override append adds to rule-derived classes', () => {
  const out = applyStyles(DOC,
    [{ id: 'r', selector: 'p', classes: ['ruled'], priority: 1 }],
    [{ documentId: 'd', nid: 'n2', classes: ['extra'], mode: 'append' }]);
  assert.match(out, /<p data-nid="n2" class="kept ruled extra">/);
});

test('override replace wins over everything', () => {
  const out = applyStyles(DOC,
    [{ id: 'r', selector: 'p', classes: ['ruled'], priority: 1 }],
    [{ documentId: 'd', nid: 'n2', classes: ['only'], mode: 'replace' }]);
  assert.match(out, /<p data-nid="n2" class="only">/);
  assert.match(out, /<p data-nid="n3" class="ruled">/); // others unaffected
});

test('replace with empty classes clears the attribute', () => {
  const out = applyStyles(DOC, [],
    [{ documentId: 'd', nid: 'n2', classes: [], mode: 'replace' }]);
  assert.match(out, /<p data-nid="n2">/);
});

test('invalid stored selector is inert, not fatal', () => {
  const out = applyStyles(DOC, [{ id: 'bad', selector: 'p:hover', classes: ['x'], priority: 1 }]);
  assert.ok(!/class="x"/.test(out));
});

test('matchCount previews rule reach', () => {
  assert.equal(matchCount(DOC, 'p'), 2);
  assert.equal(matchCount(DOC, 'p:first-of-type'), 1);
  assert.equal(matchCount(DOC, '#nope'), 0); // invalid → 0
});

test('orphanedOverrides finds overrides whose nid vanished', () => {
  const overrides = [
    { documentId: 'd', nid: 'n2', classes: ['a'], mode: 'append' },
    { documentId: 'd', nid: 'gone', classes: ['b'], mode: 'append' },
  ];
  const orphans = orphanedOverrides(DOC, overrides);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].nid, 'gone');
});

// ── Template rule set on a naked document (snapshot) ────────────────────────

test('report template rules style a naked semantic document — snapshot', () => {
  const naked = [
    '<h1>Ten Cameras</h1>',
    '<p>Records released under GRAMA show millions of searches.</p>',
    '<p>Second paragraph of body text.</p>',
    '<blockquote><p>A quoted passage.</p></blockquote>',
    '<h2>Findings</h2>',
    '<ul><li>first</li><li>second</li></ul>',
  ].join('');
  const KIT = new Set(['report-title', 'lead', 'pull-quote', 'body-copy', 'section-head']);
  const { bodyHtmlNormalized } = ingest(naked, { knownClasses: KIT });
  const TEMPLATE_RULES = [
    { id: 't1', scope: 'template', templateKey: 'report', selector: 'h1', classes: ['report-title'], priority: 10 },
    { id: 't2', scope: 'template', templateKey: 'report', selector: 'p:first-of-type', classes: ['lead'], priority: 10 },
    { id: 't3', scope: 'template', templateKey: 'report', selector: 'p', classes: ['body-copy'], priority: 5 },
    { id: 't4', scope: 'template', templateKey: 'report', selector: 'blockquote', classes: ['pull-quote'], priority: 10 },
    { id: 't5', scope: 'template', templateKey: 'report', selector: 'h2', classes: ['section-head'], priority: 10 },
  ];
  const styled = applyStyles(bodyHtmlNormalized, TEMPLATE_RULES).replace(/ data-nid="[0-9a-f]+"/g, '');

  // Inline expectation (no write-on-missing snapshot file — that pattern
  // passes vacuously on a fresh checkout). Note :first-of-type is per-parent,
  // so the blockquote's inner <p> is also "first of type" among its siblings.
  assert.equal(styled,
    '<h1 class="report-title">Ten Cameras</h1>'
    + '<p class="body-copy lead">Records released under GRAMA show millions of searches.</p>'
    + '<p class="body-copy">Second paragraph of body text.</p>'
    + '<blockquote class="pull-quote"><p class="body-copy lead">A quoted passage.</p></blockquote>'
    + '<h2 class="section-head">Findings</h2>'
    + '<ul><li>first</li><li>second</li></ul>');
});

// ── Regression: validator must be linear-time (was ReDoS-able) ──────────────

test('validateSelector rejects pathological input fast', () => {
  const start = Date.now();
  const r = validateSelector('a'.repeat(40) + '#');
  const ms = Date.now() - start;
  assert.equal(r.ok, false);
  assert.ok(ms < 100, `took ${ms}ms`);
});
