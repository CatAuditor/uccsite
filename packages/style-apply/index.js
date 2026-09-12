'use strict';
// Styling resolution (build-spec-aws.md §6.2-6.4). Pure.
//
// Rules match STRUCTURE (css-select over the normalized tree), so they survive
// re-pasting completely. Overrides target a node id and can be orphaned by a
// re-paste — the ingest match report says which.
//
// Per element (§6.4): matching rules in ascending priority union their
// classes; then the override (append adds, replace wins). Known classes that
// survived the paste count as priority 0 (they're already in the class attr).
//
// Selector subset (§6.2): tag, class, descendant, child, :first-of-type,
// :last-of-type, :nth-of-type(), :not(<simple>). Anything else is rejected at
// save time — arbitrary selector support is a debugging liability.
const parse5 = require('parse5');
const { adapter } = require('parse5-htmlparser2-tree-adapter');
const { selectAll } = require('css-select');
const serialize = require('dom-serializer').default;

// type StyleRule = { id, scope: 'template'|'page', templateKey?, documentId?,
//                    selector, classes: string[], priority, note? }
// type StyleOverride = { documentId, nid, classes: string[], mode: 'replace'|'append' }

const SIMPLE = String.raw`(?:[a-z][a-z0-9]*|\.[A-Za-z0-9_-]+)`;
const PSEUDO = String.raw`(?::(?:first-of-type|last-of-type|nth-of-type\((?:\d+|odd|even)\)|not\(${SIMPLE}\)))`;
const COMPOUND = `(?:${SIMPLE}+${PSEUDO}*|${PSEUDO}+)`;
const SELECTOR_RE = new RegExp(`^${COMPOUND}(?:\\s*(?:>\\s*)?${COMPOUND})*$`);

// validateSelector(selector) → { ok: true } | { ok: false, reason }
function validateSelector(selector) {
  const s = String(selector || '').trim();
  if (!s) return { ok: false, reason: 'Empty selector' };
  if (s.includes(',')) return { ok: false, reason: 'Selector lists (commas) are not supported — one rule per selector' };
  if (!SELECTOR_RE.test(s)) {
    return { ok: false, reason: 'Only tag, .class, descendant, >, :first-of-type, :last-of-type, :nth-of-type(), and :not(<tag or .class>) are supported' };
  }
  return { ok: true };
}

function parseTree(html) {
  return parse5.parseFragment(html, { treeAdapter: adapter });
}

// matchCounts(html, selector) → number of elements matched (for the rule
// editor's match-count preview; validates first).
function matchCount(html, selector) {
  const v = validateSelector(selector);
  if (!v.ok) return 0;
  return selectAll(selector, parseTree(html).children).length;
}

// applyStyles(normalizedHtml, rules, overrides) → styled HTML string.
// data-nid attributes are preserved (the editor preview needs them); the
// publish compose step strips them via html-ingest's stripNids.
function applyStyles(normalizedHtml, rules = [], overrides = []) {
  const tree = parseTree(normalizedHtml);
  const perNode = new Map(); // element -> Set(classes), seeded from surviving paste classes

  const collect = (el) => {
    if (!perNode.has(el)) {
      perNode.set(el, new Set((el.attribs.class || '').split(/\s+/).filter(Boolean)));
    }
    return perNode.get(el);
  };

  for (const rule of [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))) {
    const v = validateSelector(rule.selector);
    if (!v.ok) continue; // save-time validation is the gate; a bad stored rule is inert
    for (const el of selectAll(rule.selector, tree.children)) {
      const set = collect(el);
      for (const cls of rule.classes || []) set.add(cls);
    }
  }

  const byNid = new Map(overrides.map((o) => [o.nid, o]));
  for (const el of allElements(tree)) {
    const nid = el.attribs['data-nid'];
    const override = nid && byNid.get(nid);
    let classes = perNode.has(el)
      ? [...perNode.get(el)]
      : (el.attribs.class || '').split(/\s+/).filter(Boolean);
    if (override) {
      classes = override.mode === 'replace'
        ? [...(override.classes || [])]
        : [...new Set([...classes, ...(override.classes || [])])];
    }
    if (classes.length) el.attribs.class = classes.join(' ');
    else delete el.attribs.class;
  }

  return serialize(tree.children);
}

function* allElements(node) {
  for (const child of node.children || []) {
    if (child.type === 'tag') {
      yield child;
      yield* allElements(child);
    } else if (child.children) {
      yield* allElements(child);
    }
  }
}

// orphanedOverrides(normalizedHtml, overrides) → overrides whose nid no longer
// exists (surfaced after a re-paste).
function orphanedOverrides(normalizedHtml, overrides) {
  const present = new Set();
  for (const el of allElements(parseTree(normalizedHtml))) {
    if (el.attribs['data-nid']) present.add(el.attribs['data-nid']);
  }
  return (overrides || []).filter((o) => !present.has(o.nid));
}

module.exports = { validateSelector, matchCount, applyStyles, orphanedOverrides };
