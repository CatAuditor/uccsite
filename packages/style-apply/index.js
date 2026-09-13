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
const { selectAll } = require('css-select');
const { textContent } = require('domutils');
const serialize = require('dom-serializer').default;
// UTF-8 text stays literal; only markup-significant characters become entities
// (the default numeric-encodes every non-ASCII character - em dashes, curly
// quotes - bloating pages and breaking byte comparisons against the templates).
const SERIALIZE_OPTS = { encodeEntities: 'utf8' };
// Shared tree/class primitives — style-apply must parse the normalized HTML
// with exactly the options ingest serialized it under.
const { parseFragmentTree, walkElements, getClasses, setClasses } = require('@uccsite/html-ingest');

// type StyleRule = { id, scope: 'template'|'page', templateKey?, documentId?,
//                    selector, classes: string[], priority, note? }
// type StyleOverride = { documentId, nid, classes: string[], mode: 'replace'|'append' }

// Validation is a hand-rolled linear tokenizer, NOT one big regex — a nested-
// quantifier regex here was ReDoS-able from the rule editor (verified hang on
// ~20 chars of input). Grammar:
//   selector := compound ( (' ' | ' > ') compound )*
//   compound := (tag | class)+ pseudo*  |  pseudo+
//   pseudo   := :first-of-type | :last-of-type | :nth-of-type(<n|odd|even>) | :not(tag|class)
const TAG_RE = /^[a-z][a-z0-9]*/;
const CLASS_RE = /^\.[A-Za-z0-9_-]+/;
const PSEUDO_RE = /^:(first-of-type|last-of-type|nth-of-type\((?:\d+|odd|even)\)|not\((?:[a-z][a-z0-9]*|\.[A-Za-z0-9_-]+)\))/;

function consumeCompound(s) {
  let i = 0, simples = 0, pseudos = 0;
  for (;;) {
    const rest = s.slice(i);
    let m;
    if (pseudos === 0 && ((m = rest.match(TAG_RE)) || (m = rest.match(CLASS_RE)))) {
      simples++; i += m[0].length;
    } else if ((m = rest.match(PSEUDO_RE))) {
      pseudos++; i += m[0].length;
    } else {
      break;
    }
  }
  return (simples + pseudos) > 0 ? i : -1;
}

// validateSelector(selector) → { ok: true } | { ok: false, reason }
function validateSelector(selector) {
  const s = String(selector || '').trim();
  if (!s) return { ok: false, reason: 'Empty selector' };
  if (s.includes(',')) return { ok: false, reason: 'Selector lists (commas) are not supported — one rule per selector' };
  let i = 0;
  let expectCompound = true;
  while (i < s.length) {
    if (expectCompound) {
      const len = consumeCompound(s.slice(i));
      if (len <= 0) return unsupported();
      i += len;
      expectCompound = false;
    } else {
      const m = s.slice(i).match(/^\s*(>\s*)?/);
      if (!m || m[0].length === 0) return unsupported();
      i += m[0].length;
      expectCompound = true;
    }
  }
  if (expectCompound) return unsupported(); // trailing combinator
  return { ok: true };

  function unsupported() {
    return { ok: false, reason: 'Only tag, .class, descendant, >, :first-of-type, :last-of-type, :nth-of-type(), and :not(<tag or .class>) are supported' };
  }
}

// Documents are body FRAGMENTS, but they publish inside <main id="main">
// (the header partial opens it). Selectors are evaluated against a synthetic
// <main> root so `main > h1` means "top-level heading" exactly as it will on
// the page — applyStyles, explainStyles and matchCount all go through here.
function rootedTree(html) {
  const tree = parseFragmentTree(html);
  const wrapper = parseFragmentTree('<main></main>').children[0];
  wrapper.children = tree.children;
  for (const child of wrapper.children) child.parent = wrapper;
  return { tree, wrapper };
}
const select = (selector, wrapper) => selectAll(selector, [wrapper]).filter(el => el !== wrapper);

// Tags whose lack of classes is expected — never counted as "unstyled"
// (the pre-publish signal is about blocks an editor can style).
const INERT_TAGS = new Set(['br', 'wbr', 'hr', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'code', 'kbd', 'var',
  'dfn', 'abbr', 'cite', 'q', 'mark', 'time', 'span', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption',
  'summary', 'source', 'picture', 'g', 'path', 'polyline', 'polygon', 'line', 'circle', 'rect', 'svg']);

// matchCount(html, selector) → number of elements matched (for the rule
// editor's match-count preview; validates first). matchCountTree takes an
// already-rooted tree so a page can parse each document once.
function matchCount(html, selector) {
  return matchCountTree(rootedTree(html), selector);
}
function matchCountTree(rooted, selector) {
  const v = validateSelector(selector);
  if (!v.ok) return 0;
  return select(selector, rooted.wrapper).length;
}

// applyStyles(normalizedHtml, rules, overrides) → styled HTML string.
// data-nid attributes are preserved (the editor preview needs them); the
// publish compose step strips them via html-ingest's stripNids.
function applyStyles(normalizedHtml, rules = [], overrides = []) {
  const { tree, wrapper } = rootedTree(normalizedHtml);

  // Seed every element once from its surviving paste classes (priority 0).
  const perNode = new Map();
  for (const el of walkElements(tree)) {
    perNode.set(el, new Set(getClasses(el)));
  }

  for (const rule of [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))) {
    const v = validateSelector(rule.selector);
    if (!v.ok) continue; // save-time validation is the gate; a bad stored rule is inert
    for (const el of select(rule.selector, wrapper)) {
      const set = perNode.get(el);
      if (!set) continue;
      for (const cls of rule.classes || []) set.add(cls);
    }
  }

  const byNid = new Map(overrides.map((o) => [o.nid, o]));
  for (const [el, set] of perNode) {
    const nid = el.attribs['data-nid'];
    const override = nid && byNid.get(nid);
    let classes = [...set];
    if (override) {
      classes = override.mode === 'replace'
        ? [...(override.classes || [])]
        : [...new Set([...classes, ...(override.classes || [])])];
    }
    setClasses(el, classes);
  }

  return serialize(tree.children, SERIALIZE_OPTS);
}

// explainStyles(normalizedHtml, rules, overrides) → rows in document order,
// one per element — the editor's element tree (§6.5): what the paste
// carried, which rule contributed which classes, the override, and the
// resolved class list. Same resolution as applyStyles, kept side by side.
//   row = { nid, tag, depth, text, pasteClasses, ruleClasses: [{ ruleId, classes }],
//           override: { classes, mode } | null, classes, unstyled }
function explainStyles(normalizedHtml, rules = [], overrides = []) {
  const { tree, wrapper } = rootedTree(normalizedHtml);
  const rows = new Map(); // el → row
  const depthOf = (el) => { let d = 0; for (let p = el.parent; p && p !== wrapper && p.type !== 'root'; p = p.parent) d++; return d; };
  for (const el of walkElements(tree)) {
    rows.set(el, {
      nid: el.attribs['data-nid'] || '',
      tag: el.name,
      depth: depthOf(el),
      text: textContent(el).replace(/\s+/g, ' ').trim().slice(0, 60),
      pasteClasses: getClasses(el),
      ruleClasses: [],
      override: null,
      classes: [],
      unstyled: false,
    });
  }
  for (const rule of [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))) {
    if (!validateSelector(rule.selector).ok) continue;
    for (const el of select(rule.selector, wrapper)) {
      const row = rows.get(el);
      if (row) row.ruleClasses.push({ ruleId: rule.id, classes: [...(rule.classes || [])] });
    }
  }
  const byNid = new Map(overrides.map((o) => [o.nid, o]));
  for (const row of rows.values()) {
    const set = new Set(row.pasteClasses);
    for (const r of row.ruleClasses) for (const c of r.classes) set.add(c);
    const o = row.nid && byNid.get(row.nid);
    if (o) {
      row.override = { classes: [...(o.classes || [])], mode: o.mode === 'replace' ? 'replace' : 'append' };
      row.classes = o.mode === 'replace' ? [...(o.classes || [])] : [...new Set([...set, ...(o.classes || [])])];
    } else row.classes = [...set];
    row.unstyled = row.classes.length === 0 && row.ruleClasses.length === 0 && !INERT_TAGS.has(row.tag);
  }
  return [...rows.values()];
}

// orphanedOverrides(normalizedHtml, overrides) → overrides whose nid no longer
// exists (surfaced after a re-paste). Runs on the rare re-paste path, so the
// extra parse is fine.
function orphanedOverrides(normalizedHtml, overrides) {
  const present = new Set();
  for (const el of walkElements(parseFragmentTree(normalizedHtml))) {
    if (el.attribs['data-nid']) present.add(el.attribs['data-nid']);
  }
  return (overrides || []).filter((o) => !present.has(o.nid));
}

module.exports = { validateSelector, matchCount, matchCountTree, rootedTree, applyStyles, explainStyles, orphanedOverrides, INERT_TAGS };
