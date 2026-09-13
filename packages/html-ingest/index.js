'use strict';
// Document ingest (build-spec-aws.md §5). Pure functions: strings/objects in,
// strings/objects out. Runs on every save AND again on every publish — the
// publish path never trusts stored HTML.
//
// Security stance: pasted HTML is untrusted even though the author is
// authenticated — an admin account is one phished password away from stored
// XSS on every page. Sanitization is allowlist-only via sanitize-html; nothing
// here is hand-rolled.
const { createHash } = require('crypto');
const parse5 = require('parse5');
const { adapter } = require('parse5-htmlparser2-tree-adapter');
const sanitizeHtml = require('sanitize-html');
const serialize = require('dom-serializer').default;
// UTF-8 text stays literal; only markup-significant characters become entities
// (the default numeric-encodes every non-ASCII character - em dashes, curly
// quotes - bloating pages and breaking byte comparisons against the templates).
const SERIALIZE_OPTS = { encodeEntities: 'utf8' };
const { textContent } = require('domutils');
const { SAFE_URL_SCHEMES, escapeHtml } = require('@uccsite/render/engine');

// Separator for composite hash/lookup keys — can't occur in tag names or text.
const SEP = '\u0000';

// ── Allowlist (spec §5.3 — do not widen without an ADR) ─────────────────────
// Widened 2026-09-13 for the migrated reports (docs/decisions/
// ingest-allowlist-widening.md): inert text-level semantics (cite, abbr, q,
// kbd, var, dfn, address, ins, del, wbr), <details open>, <a target rel
// download> (target restricted to _blank and rel forced to include noopener
// by transformAnchor below), and a DECORATIVE inline-SVG subset with geometry
// and paint attributes only — no href/xlink:href, no <use>, no <foreignObject>,
// no <script>/<style>/<animate>, so it is shape data, not a script vector.
const ALLOWED_TAGS = [
  'div', 'section', 'article', 'aside', 'header', 'footer', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'b', 'i', 'u', 's',
  'blockquote', 'code', 'pre', 'br', 'hr', 'small', 'sub', 'sup', 'time', 'mark',
  'cite', 'abbr', 'q', 'kbd', 'var', 'dfn', 'address', 'ins', 'del', 'wbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'img', 'picture', 'source', 'a', 'details', 'summary',
  'svg', 'g', 'path', 'polyline', 'polygon', 'line', 'circle', 'rect',
];

const GLOBAL_ATTRS = ['class', 'id', 'title', 'width', 'height', 'loading', 'decoding', 'lang', 'dir', 'role', 'aria-*', 'data-*'];
const SVG_PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-rule', 'clip-rule', 'transform', 'focusable'];
const ALLOWED_ATTRIBUTES = {
  '*': GLOBAL_ATTRS,
  a: [...GLOBAL_ATTRS, 'href', 'target', 'rel', 'download'],
  img: [...GLOBAL_ATTRS, 'src', 'srcset', 'sizes', 'alt'],
  source: [...GLOBAL_ATTRS, 'src', 'srcset', 'sizes'],
  td: [...GLOBAL_ATTRS, 'colspan', 'rowspan'],
  th: [...GLOBAL_ATTRS, 'colspan', 'rowspan'],
  time: [...GLOBAL_ATTRS, 'datetime'],
  details: [...GLOBAL_ATTRS, 'open'],
  // Attribute names are lowercased by the parser; the browser's HTML parser
  // re-cases viewbox → viewBox inside <svg> (the SVG attribute adjustment step).
  svg: [...GLOBAL_ATTRS, ...SVG_PAINT, 'viewbox', 'xmlns', 'preserveaspectratio'],
  g: [...GLOBAL_ATTRS, ...SVG_PAINT],
  path: [...GLOBAL_ATTRS, ...SVG_PAINT, 'd'],
  polyline: [...GLOBAL_ATTRS, ...SVG_PAINT, 'points'],
  polygon: [...GLOBAL_ATTRS, ...SVG_PAINT, 'points'],
  line: [...GLOBAL_ATTRS, ...SVG_PAINT, 'x1', 'y1', 'x2', 'y2'],
  circle: [...GLOBAL_ATTRS, ...SVG_PAINT, 'cx', 'cy', 'r'],
  rect: [...GLOBAL_ATTRS, ...SVG_PAINT, 'x', 'y', 'rx', 'ry'],
};

// <a target>: only _blank survives, and it always carries rel="noopener"
// (reverse-tabnabbing). Any other rel tokens the author set are kept.
function transformAnchor(tagName, attribs) {
  const out = { ...attribs };
  if ('target' in out) {
    if (out.target !== '_blank') delete out.target;
    else {
      const rel = new Set(String(out.rel || '').split(/\s+/).filter(Boolean));
      rel.add('noopener');
      out.rel = [...rel].join(' ');
    }
  }
  return { tagName, attribs: out };
}

// The render engine's safeUrl() allowlist plus tel: (spec §5.3).
// javascript: and data: rejected.
const ALLOWED_SCHEMES = [...SAFE_URL_SCHEMES, 'tel'];

// Tags whose CONTENT must vanish with the tag (not leak as text).
const NON_TEXT_TAGS = ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'noscript'];

const HEADING_RE = /^h([1-6])$/;

// ── Tree helpers (htmlparser2-shape nodes from the parse5 adapter) ──────────
// These are THE parse/walk/class primitives for the normalized-HTML pipeline;
// @uccsite/style-apply imports them so the two packages can never disagree
// about parse options or which nodes count as elements.
function parseFragmentTree(html) {
  return parse5.parseFragment(html, { treeAdapter: adapter });
}

// htmlparser2 nodes: elements are type 'tag', except <script> ('script') and
// <style> ('style') — the violation scan must see those too.
const ELEMENT_TYPES = new Set(['tag', 'script', 'style']);

function* walkElements(node) {
  for (const child of node.children || []) {
    if (ELEMENT_TYPES.has(child.type)) {
      yield child;
      yield* walkElements(child);
    } else if (child.children) {
      yield* walkElements(child);
    }
  }
}

function getClasses(el) {
  return (el.attribs.class || '').split(/\s+/).filter(Boolean);
}

function setClasses(el, classes) {
  if (classes.length) el.attribs.class = classes.join(' ');
  else delete el.attribs.class;
}

function textOf(node, limit = 64) {
  return textContent(node).replace(/\s+/g, ' ').trim().slice(0, limit);
}

// ── Step 2: body extraction ─────────────────────────────────────────────────
function extractBody(raw, warnings) {
  if (!/<(!doctype|html|head|body)[\s>]/i.test(raw)) return raw;
  const doc = parse5.parse(raw, { treeAdapter: adapter });
  let body = null;
  for (const el of walkElements(doc)) {
    if (el.name === 'body') { body = el; break; }
  }
  warnings.push('A full HTML document was pasted; only the <body> content was kept. <head> metadata (title, meta tags) belongs in the Document\'s SEO fields.');
  return body ? serialize(body.children, SERIALIZE_OPTS) : raw;
}

// ── Step 3 aftermath: report what sanitization removed (spec §5.8 — "report,
// never silently drop"). Derived by DIFFING the pre- and post-sanitize trees,
// so the report cannot disagree with what the sanitizer actually did — there
// is no parallel re-implementation of its rules to drift out of sync.
const URL_ATTRS = ['href', 'src', 'srcset'];

function attrLabel(attr) {
  if (attr === 'style') return 'style';
  if (/^on/i.test(attr)) return 'on* event handler';
  return attr;
}

function countTagsAndAttrs(tree) {
  const tags = new Map();
  const attrs = new Map();
  for (const el of walkElements(tree)) {
    tags.set(el.name, (tags.get(el.name) || 0) + 1);
    for (const attr of Object.keys(el.attribs || {})) {
      const label = attrLabel(attr);
      attrs.set(label, (attrs.get(label) || 0) + 1);
    }
  }
  return { tags, attrs };
}

// Detail enrichment only: which URL values carried a scheme the sanitizer
// rejects (checked the way it does — after stripping control characters, so
// "java\u0000script:" obfuscation is caught).
function badScheme(value) {
  const cleaned = value.replace(/[\x00- ]+/g, '').trim();
  const m = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (m && !ALLOWED_SCHEMES.includes(m[1].toLowerCase())) return m[1].toLowerCase();
  if (cleaned.startsWith('//')) return 'protocol-relative';
  return null;
}

function reportRemovals(rawTree, cleanTree, rawHtmlForUrls, report) {
  const before = countTagsAndAttrs(rawTree);
  const after = countTagsAndAttrs(cleanTree);
  for (const [tag, count] of before.tags) {
    const removed = count - (after.tags.get(tag) || 0);
    if (removed > 0) report.removed.push({ kind: 'tag', tag, count: removed });
  }
  for (const [attr, count] of before.attrs) {
    const removed = count - (after.attrs.get(attr) || 0);
    if (removed > 0) report.removed.push({ kind: 'attribute', attr, count: removed });
  }
  // URL detail entries (values), in addition to the attribute counts above.
  for (const el of walkElements(rawTree)) {
    for (const attr of URL_ATTRS) {
      const value = el.attribs?.[attr];
      if (!value) continue;
      const candidates = attr === 'srcset'
        ? value.split(',').map(c => c.trim().split(/\s+/)[0]).filter(Boolean)
        : [value.trim()];
      for (const val of candidates) {
        const scheme = badScheme(val);
        if (scheme) report.removed.push({ kind: 'url', tag: el.name, attr, scheme, value: val.slice(0, 80) });
      }
    }
  }
}

// Element ids the site's chrome and scripts (js/main.js, partials) look up —
// an author id with one of these would borrow site behaviour/markup.
const RESERVED_ID_RE = /^(main|site-header|nav(-.*)?|donate(-.*)?|modal(-.*)?|join-form|form-success|tracker(-.*)?|skip-link|site-footer)$/i;

// ── Step 3: sanitize ────────────────────────────────────────────────────────
function sanitize(html) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset'],
    allowProtocolRelative: false,
    nonTextTags: NON_TEXT_TAGS,
    disallowedTagsMode: 'discard',
    // Boolean attributes (no value) are dropped by default; these are the
    // ones the allowlist admits in boolean form.
    allowedEmptyAttributes: ['alt', 'download', 'open'],
    transformTags: {
      a: transformAnchor,
      '*': (tagName, attribs) => {
        if (attribs.id && RESERVED_ID_RE.test(attribs.id)) { const { id, ...rest } = attribs; return { tagName, attribs: rest }; }
        return { tagName, attribs };
      },
    },
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
  });
}

// ── Step 4: deterministic node ids ──────────────────────────────────────────
function computeNid(tag, depth, ordinal, text) {
  return createHash('sha256').update([tag, depth, ordinal, text].join(SEP)).digest('hex').slice(0, 8);
}

function collectNodes(tree) {
  const nodes = [];
  (function recurse(node, depth) {
    let ordinal = 0;
    for (const child of node.children || []) {
      if (child.type !== 'tag') continue;
      nodes.push({ el: child, tag: child.name, depth, ordinal, text: textOf(child) });
      ordinal++;
      recurse(child, depth + 1);
    }
  })(tree, 0);
  return nodes;
}

// Assign data-nid to every element. On re-paste, carry ids forward from the
// previous normalized tree in spec §5.4 order: exact (tag, text) first, then
// (tag, per-tag ordinal); anything else gets a new id. (A hash-equality
// shortcut pass was removed: a carried-forward nid can coincide with another
// node's structural hash and steal it — see the Phase 2 review.)
function assignNids(tree, previousNormalized, report) {
  const nodes = collectNodes(tree);
  const used = new Set();
  for (const n of nodes) {
    n.hash = computeNid(n.tag, n.depth, n.ordinal, n.text);
  }

  if (previousNormalized) {
    const prevNodes = collectNodes(parseFragmentTree(previousNormalized))
      .map(p => ({ ...p, nid: p.el.attribs['data-nid'] }))
      .filter(p => p.nid);
    const unmatchedPrev = new Set(prevNodes);
    const byTagText = new Map(); // key -> { queue, cursor } keeps pass 1 O(N)
    for (const p of prevNodes) {
      const key = p.tag + SEP + p.text;
      if (!byTagText.has(key)) byTagText.set(key, { queue: [], cursor: 0 });
      byTagText.get(key).queue.push(p);
    }

    let matched = 0;
    // Pass 1: exact (tag, text), consuming each previous node at most once, FIFO.
    for (const n of nodes) {
      const bucket = byTagText.get(n.tag + SEP + n.text);
      if (!bucket) continue;
      while (bucket.cursor < bucket.queue.length && !unmatchedPrev.has(bucket.queue[bucket.cursor])) {
        bucket.cursor++;
      }
      const p = bucket.queue[bucket.cursor];
      if (p) { n.nid = p.nid; unmatchedPrev.delete(p); bucket.cursor++; matched++; }
    }
    // Pass 2: (tag, per-tag ordinal).
    const perTagNew = {};
    const perTagPrev = {};
    for (const p of prevNodes) {
      (perTagPrev[p.tag] = perTagPrev[p.tag] || []).push(p);
    }
    for (const n of nodes) {
      const idx = (perTagNew[n.tag] = (perTagNew[n.tag] ?? -1) + 1);
      if (n.nid) continue;
      const p = (perTagPrev[n.tag] || [])[idx];
      if (p && unmatchedPrev.has(p)) { n.nid = p.nid; unmatchedPrev.delete(p); matched++; }
    }
    report.match = { matched, new: nodes.filter(n => !n.nid).length, removed: unmatchedPrev.size };
  }

  for (const n of nodes) {
    if (!n.nid) n.nid = n.hash;
    // Guarantee uniqueness (hash collisions or duplicate carries).
    let nid = n.nid, salt = 0;
    while (used.has(nid)) nid = computeNid(n.tag, n.depth, n.ordinal, n.text + SEP + (++salt));
    n.nid = nid;
    used.add(nid);
    n.el.attribs['data-nid'] = nid;
  }
  return nodes;
}

// ── Step 5: class partition ─────────────────────────────────────────────────
function partitionClasses(nodes, knownClasses, foreignClassMap, report) {
  for (const n of nodes) {
    const raw = getClasses(n.el);
    if (!raw.length) continue;
    const kept = [];
    for (let cls of raw) {
      if (foreignClassMap[cls] && knownClasses.has(foreignClassMap[cls])) cls = foreignClassMap[cls];
      if (knownClasses.has(cls)) kept.push(cls);
      else report.foreignClasses.push({ nid: n.nid, class: cls });
    }
    setClasses(n.el, kept);
  }
}

// ── Step 6: asset URL review. Rewriting relative paths to fingerprinted CDN
// URLs lands in Phase 8 with the media library (deviation recorded in
// build-spec addenda); until then both external and relative asset URLs are
// warned about — either kind is a future broken page.
function assetUrls(el) {
  const urls = [];
  if (el.attribs.src) urls.push(el.attribs.src.trim());
  if (el.attribs.srcset) {
    for (const c of el.attribs.srcset.split(',')) {
      const url = c.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    }
  }
  return urls;
}

function flagAssetUrls(nodes, report) {
  for (const n of nodes) {
    if (n.tag !== 'img' && n.tag !== 'source') continue;
    for (const url of assetUrls(n.el)) {
      if (/^https?:\/\//i.test(url)) {
        report.warnings.push(`External image on ${n.nid}: ${url.slice(0, 100)} — hotlinked images break when the host removes them; upload to the media library instead.`);
      } else if (!url.startsWith('/') && !url.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        report.warnings.push(`Relative image path on ${n.nid}: ${url.slice(0, 100)} — this won't resolve on the published page; upload to the media library and use its URL.`);
      }
    }
  }
}

// ── Step 7: accessibility gate (blocks publish; docs/systems/accessibility.md) ─
function a11yGate(nodes, report) {
  let h1s = 0;
  let lastLevel = 0;
  for (const n of nodes) {
    if (n.tag === 'img' && !('alt' in n.el.attribs)) {
      report.a11y.push({ nid: n.nid, rule: 'img-alt', message: 'Image is missing an alt attribute (use alt="" only if decorative).' });
    }
    const h = n.tag.match(HEADING_RE);
    if (h) {
      const level = Number(h[1]);
      if (level === 1 && ++h1s > 1) {
        report.a11y.push({ nid: n.nid, rule: 'single-h1', message: 'More than one <h1> — a page gets exactly one.' });
      }
      if (lastLevel && level > lastLevel + 1) {
        report.a11y.push({ nid: n.nid, rule: 'heading-skip', message: `Heading level skips from h${lastLevel} to h${level}.` });
      }
      lastLevel = level;
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────
// ingest(rawHtml, { knownClasses, foreignClassMap, previousNormalized })
//   → { bodyHtmlRaw, bodyHtmlNormalized, report, ok }
// report: { warnings[], removed[], foreignClasses[], a11y[], match|null }
// ok === true ⇔ publishable: the a11y gate passed and the input was non-empty.
// (report.removed / warnings / foreignClasses inform, never block.)
// Note on spec §5.1 "reject unparseable input": HTML5 parsing never fails —
// parse5 error-recovers per spec, which is what real pastes need. Malformed
// structure therefore repairs rather than rejects; the removal report and
// warnings surface what changed.
function ingest(rawHtml, opts = {}) {
  const { knownClasses = new Set(), foreignClassMap = {}, previousNormalized = null } = opts;
  const report = { warnings: [], removed: [], foreignClasses: [], a11y: [], match: null };

  if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
    report.warnings.push('Empty input.');
    return { bodyHtmlRaw: rawHtml ?? '', bodyHtmlNormalized: '', report, ok: false };
  }

  const bodyOnly = extractBody(rawHtml, report.warnings);
  const rawTree = parseFragmentTree(bodyOnly);
  const clean = sanitize(bodyOnly);
  const tree = parseFragmentTree(clean);
  reportRemovals(rawTree, tree, bodyOnly, report);
  const nodes = assignNids(tree, previousNormalized, report);
  partitionClasses(nodes, knownClasses, foreignClassMap, report);
  flagAssetUrls(nodes, report);
  a11yGate(nodes, report);

  return {
    bodyHtmlRaw: rawHtml,           // exactly what was pasted — never mutated
    bodyHtmlNormalized: serialize(tree.children, SERIALIZE_OPTS),
    report,
    ok: report.a11y.length === 0,
  };
}

// replaceTextTokens(html, re, render) → html. Runs `render(match)` for token
// matches found in TEXT NODES only — never attribute values, never inside
// <pre>/<code> (an example of the token syntax stays literal). The rendered
// replacement is parsed as a fragment and spliced in place, so it can carry
// markup (compose uses this for {{coverage:}} / {{video:}}).
function replaceTextTokens(html, re, render) {
  const tree = parseFragmentTree(html);
  const inVerbatim = (node) => {
    for (let p = node.parent; p && p.type !== 'root'; p = p.parent) {
      if (p.name === 'pre' || p.name === 'code') return true;
    }
    return false;
  };
  const visit = (parent) => {
    for (const node of [...parent.children]) {
      if (node.type === 'text') {
        if (!re.test(node.data) || inVerbatim(node)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        // Only the developer-owned render() output is parsed as markup. The
        // author's text around the tokens is re-escaped before parsing, so
        // "&lt;meta …&gt;" typed as text can never become an element here.
        const pieces = [];
        let last = 0;
        for (const m of node.data.matchAll(re)) {
          pieces.push(escapeHtml(node.data.slice(last, m.index)));
          pieces.push(render(...m));
          last = m.index + m[0].length;
        }
        pieces.push(escapeHtml(node.data.slice(last)));
        const frag = parseFragmentTree(pieces.join(''));
        const i = parent.children.indexOf(node);
        for (const n of frag.children) n.parent = parent;
        parent.children.splice(i, 1, ...frag.children);
      } else if (node.children) visit(node);
    }
  };
  visit(tree);
  return serialize(tree.children, SERIALIZE_OPTS);
}

// Strip every data-nid — compose calls this; a published page never carries them.
function stripNids(html) {
  const tree = parseFragmentTree(html);
  for (const el of walkElements(tree)) delete el.attribs['data-nid'];
  return serialize(tree.children, SERIALIZE_OPTS);
}

module.exports = {
  ingest, stripNids, replaceTextTokens, ALLOWED_TAGS, ALLOWED_SCHEMES,
  // shared tree/class primitives (used by @uccsite/style-apply)
  parseFragmentTree, walkElements, getClasses, setClasses,
};
