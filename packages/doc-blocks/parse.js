// HTML → blocks (docs/systems/document-builder.md "Parsing"). Three tiers,
// applied in one pass over the top-level flow of the fragment:
//
//   1. Builder markers the authoring kit teaches a writing tool to emit:
//      <!-- ucc:header eyebrow="…" date="…" -->            header fields
//      <!-- ucc:section eyebrow="…" dek="…" -->  (before an h2)
//      <!-- ucc:TYPE key="value" … --> … <!-- /ucc -->     one block of TYPE
//   2. The site's own markup (a legacy report, or HTML written from the kit):
//      div.subpage-hero, .release-meta, .paper-toc, h2 sections, and every
//      class the block registry renders (scope-box, stats-grid, …).
//   3. Heuristics for plain documents (.docx / Markdown conversions): the
//      h1 is the title, a short line above it the eyebrow, the first
//      paragraph the summary, "By Name, Title" the author, a date line the
//      date; each h2 starts a section; runs of p/h3/ul become Text blocks.
//
// Anything not recognised becomes a Custom HTML block, never dropped. The
// report says how many, so a conversion can be judged.
'use strict';
const serialize = require('dom-serializer').default;
const { textContent } = require('domutils');
const { parseFragmentTree, getClasses } = require('@uccsite/html-ingest');
const { BLOCK_TYPES, CALLOUT_VARIANTS, emptyBody, newSection, newId, slugify } = require('./schema');

const SER = { encodeEntities: 'utf8' };
const isEl = (n) => n && n.type === 'tag';
const isText = (n) => n && n.type === 'text';
const isComment = (n) => n && n.type === 'comment';
const isBlank = (n) => isText(n) && !n.data.trim();
const tag = (n) => (isEl(n) ? n.name.toLowerCase() : '');
const has = (n, cls) => isEl(n) && getClasses(n).includes(cls);
const inner = (n) => serialize(n.children || [], SER).trim();
const outer = (n) => serialize([n], SER).trim();
const text = (n) => textContent(n).replace(/\s+/g, ' ').trim();
const kids = (n) => (n.children || []).filter(c => !isBlank(c));
const elKids = (n) => (n.children || []).filter(isEl);
const find = (n, pred) => { for (const c of elKids(n)) { if (pred(c)) return c; const d = find(c, pred); if (d) return d; } return null; };
const findAll = (n, pred, out = []) => { for (const c of elKids(n)) { if (pred(c)) out.push(c); findAll(c, pred, out); } return out; };

const PROSE_TAGS = new Set(['p', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'hr', 'pre', 'dl']);
const WRAPPER_CLASSES = ['paper-body', 'paper-inner', 'briefing-body', 'briefing-inner', 'report-body', 'report-section', 'theory-body', 'theory-section', 'privacy-body', 'doc-body', 'doc-inner', 'container', 'section', 'prose', 'page'];
const CALLOUT_ROOTS = Object.fromEntries(CALLOUT_VARIANTS.map(v => [v.root, v]));
const CALLOUT_ALIASES = { acknowledgment: 'scope-box', 'report-callout': 'callout', 'report-callout-dark': 'callout-dark', 'theory-stat': 'finding-box' };
// Per-part scoped classes the Document migration minted (stratos: .s-cdbd22
// on a wrapper, styled in the page CSS). They ride along on the section.
const SCOPED_RE = /^s-[0-9a-f]{6}$/;
const TOKEN_RE = /^\{\{(video|coverage):([A-Za-z0-9_-]+)\}\}$/;
const DATE_RE = /^(?:(?:updated|published|filed)\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i;
const BYLINE_RE = /^by\s+([^,]+?)(?:,\s*(.+))?$/i;

// parseMarker(comment) → { kind, attrs } for "ucc:kind a="b"" comments.
function parseMarker(data) {
  const m = String(data).trim().match(/^ucc:([a-z-]+)\s*([\s\S]*)$/i);
  if (!m) return null;
  const attrs = {};
  for (const a of m[2].matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a[2];
  return { kind: m[1].toLowerCase(), attrs };
}
const isEndMarker = (n) => isComment(n) && /^\s*\/ucc\s*$/.test(n.data);

// ─── block builders (element → block props, or null when not a clean fit) ───

function quoteFrom(el) {
  const source = find(el, c => has(c, 'quote-source'));
  const cite = elKids(el).find(c => tag(c) === 'cite') || find(el, c => tag(c) === 'cite');
  const body = (el.children || []).filter(c => c !== source && c !== cite && !isBlank(c));
  return { source: source ? text(source) : '', html: serialize(body, SER).trim(), cite: cite ? inner(cite).replace(/^[—–-]\s*/, '') : '' };
}

function calloutFrom(el, root) {
  const v = CALLOUT_ROOTS[root];
  let label = '';
  let body;
  if (v.labelTag) {
    const h = elKids(el).find(c => tag(c) === v.labelTag);
    label = h ? text(h) : '';
    body = (el.children || []).filter(c => c !== h);
  } else if (v.labelInline) {
    const term = find(el, c => has(c, v.labelClass));
    if (term) { label = text(term); term.parent.children.splice(term.parent.children.indexOf(term), 1); }
    body = el.children || [];
  } else {
    const l = elKids(el).find(c => has(c, v.labelClass));
    label = l ? text(l) : '';
    body = (el.children || []).filter(c => c !== l);
  }
  return { variant: v.value, label, html: serialize(body.filter(c => !isBlank(c)), SER).trim().replace(/^<p>\s+/, '<p>') };
}

function statsFrom(el, variant) {
  const cardCls = variant === 'band' ? 'impact-stat' : 'stat-card';
  const numCls = variant === 'band' ? 'impact-number' : 'stat-num';
  const descCls = variant === 'band' ? 'impact-label' : 'stat-desc';
  const cards = findAll(el, c => has(c, cardCls));
  if (!cards.length) return null;
  const items = cards.map(c => {
    const num = find(c, x => has(x, numCls)); const desc = find(c, x => has(x, descCls));
    return { num: num ? text(num) : '', desc: desc ? inner(desc) : '', wide: has(c, 'wide') };
  });
  // Anything in a card other than number + description would be lost.
  if (cards.some(c => elKids(c).some(x => !has(x, numCls) && !has(x, descCls)))) return null;
  return { variant, items };
}

function figureFrom(el) {
  const img = find(el, c => tag(c) === 'img');
  if (!img) return null;
  const cap = elKids(el).find(c => tag(c) === 'figcaption');
  if (elKids(el).some(c => c !== img && c !== cap && tag(c) !== 'picture')) return null;
  return { src: img.attribs.src || '', alt: img.attribs.alt || '', caption: cap ? inner(cap) : '', width: img.attribs.width || '', height: img.attribs.height || '' };
}

function tableFrom(el) {
  const table = tag(el) === 'table' ? el : find(el, c => tag(c) === 'table');
  if (!table) return null;
  const others = elKids(el).filter(c => c !== table);
  if (tag(el) !== 'table' && others.length) return null;
  const cells = findAll(table, c => tag(c) === 'td' || tag(c) === 'th');
  if (cells.some(c => c.attribs.colspan || c.attribs.rowspan)) return null;
  const caption = find(table, c => tag(c) === 'caption');
  const trs = findAll(table, c => tag(c) === 'tr');
  const headRow = trs.find(tr => elKids(tr).every(c => tag(c) === 'th') && elKids(tr).length);
  const head = headRow ? elKids(headRow).map(inner) : [];
  const rows = trs.filter(tr => tr !== headRow).map(tr => {
    const cls = (tr.attribs.class || '').trim();
    const cs = elKids(tr).map(inner);
    return cls ? { cells: cs, cls } : cs;
  });
  const width = head.length || (Array.isArray(rows[0]) ? rows[0].length : rows[0]?.cells.length);
  if (rows.some(r => (Array.isArray(r) ? r : r.cells).length !== width)) return null;
  const tcls = getClasses(table);
  const variant = tcls.find(c => ['own-table', 'rank-table', 'timeline-table', 'doc-table'].includes(c)) || (tcls.includes('defs-table') || tcls.includes('report-table') ? 'doc-table' : 'doc-table');
  return { variant, caption: caption ? inner(caption) : '', head, rows };
}

function filesFrom(el) {
  const links = elKids(el);
  if (!links.length || links.some(a => tag(a) !== 'a')) return null;
  return { items: links.map(a => ({ label: text(a), href: a.attribs.href || '' })) };
}

function ctaFrom(el, variant) {
  const h = elKids(el).find(c => /^h[2-4]$/.test(tag(c)));
  const p = elKids(el).find(c => tag(c) === 'p');
  const buttons = elKids(el).filter(c => tag(c) === 'a');
  if (elKids(el).some(c => c !== h && c !== p && tag(c) !== 'a')) return null;
  return { variant, heading: h ? text(h) : '', html: p ? inner(p) : '', buttons: buttons.map(a => ({ label: text(a), href: a.attribs.href || '' })) };
}

function sourcesGridFrom(el) {
  const items = elKids(el).filter(c => has(c, 'source-item'));
  if (!items.length || items.length !== elKids(el).length) return null;
  const out = [];
  for (const it of items) {
    const a = find(it, c => tag(c) === 'a');
    const strong = find(it, c => tag(c) === 'strong');
    const p = elKids(it).find(c => tag(c) === 'p');
    const label = strong ? text(strong) : a ? text(a) : '';
    if (!label) return null;
    const rest = elKids(it).filter(c => c !== p && c !== strong && c !== a);
    if (rest.length) return null;
    out.push({ label, html: p ? inner(p) : '', href: a ? a.attribs.href || '' : '' });
  }
  return { variant: 'grid', items: out };
}

function accordionItem(el) {
  const summary = elKids(el).find(c => tag(c) === 'summary');
  const body = elKids(el).find(c => has(c, 'section-body'));
  const rest = (el.children || []).filter(c => c !== summary && c !== body && !isBlank(c));
  return { summary: summary ? text(summary) : '', html: body ? inner(body) : serialize(rest, SER).trim(), open: 'open' in (el.attribs || {}) };
}

// blockFor(el) → { type, ...props } | null (null = not a block on its own)
function blockFor(el) {
  const t = tag(el);
  const cls = getClasses(el);
  const root = cls.find(c => CALLOUT_ROOTS[c]) || cls.map(c => CALLOUT_ALIASES[c]).find(Boolean);
  if (t === 'blockquote') return { type: 'quote', ...quoteFrom(el) };
  if (cls.includes('pull-quote')) { const q = quoteFrom(el); return { type: 'pullquote', html: q.html.replace(/^<p>([\s\S]*)<\/p>$/, '$1'), cite: q.cite }; }
  if (root) return { type: 'callout', ...calloutFrom(el, root) };
  if (cls.includes('stats-grid')) { const s = statsFrom(el, 'cards'); return s && { type: 'stats', ...s }; }
  if (cls.includes('impact')) { const s = statsFrom(el, 'band'); return s && { type: 'stats', ...s }; }
  if (t === 'figure') { const f = figureFrom(el); return f && { type: 'figure', ...f }; }
  if (t === 'table' || cls.some(c => /table-wrap$|^table-scroll$/.test(c))) { const tb = tableFrom(el); return tb && { type: 'table', ...tb }; }
  if (cls.includes('table-downloads')) { const f = filesFrom(el); return f && { type: 'files', ...f }; }
  if (cls.includes('related-cta') || cls.includes('download-cta')) { const c = ctaFrom(el, cls.includes('download-cta') ? 'download-cta' : 'related-cta'); return c && { type: 'cta', ...c }; }
  if (cls.includes('sources-list')) return { type: 'sources', variant: 'list', html: inner(el), items: [] };
  if (cls.includes('sources-grid')) { const g = sourcesGridFrom(el); return g && { type: 'sources', ...g, html: '' }; }
  if (cls.includes('doc-accordion')) return { type: 'accordion', items: elKids(el).filter(c => tag(c) === 'details').map(accordionItem) };
  if (cls.includes('parts-nav')) {
    const cards = elKids(el);
    if (cards.every(a => tag(a) === 'a' && has(a, 'part-card'))) {
      const part = (a, c) => { const d = find(a, x => has(x, c)); return d ? (c === 'part-card-desc' ? inner(d) : text(d)) : ''; };
      return { type: 'partsnav', items: cards.map(a => ({ num: part(a, 'part-card-num'), title: part(a, 'part-card-title'), desc: part(a, 'part-card-desc'), href: a.attribs.href || '' })) };
    }
  }
  if (cls.includes('ask-list') || cls.includes('ask-item')) {
    const items = cls.includes('ask-list') ? elKids(el) : [el];
    if (items.every(it => has(it, 'ask-item') && elKids(it).length === 2 && tag(elKids(it)[0]) === 'h3' && tag(elKids(it)[1]) === 'p')) {
      return { type: 'asks', items: items.map(it => ({ heading: text(elKids(it)[0]), html: inner(elKids(it)[1]) })) };
    }
  }
  if (cls.includes('join-grid')) {
    const cards = elKids(el);
    if (cards.every(c => has(c, 'join-card') && elKids(c).length === 2 && tag(elKids(c)[0]) === 'strong' && tag(elKids(c)[1]) === 'p')) {
      return { type: 'cards', items: cards.map(c => ({ heading: text(elKids(c)[0]), html: inner(elKids(c)[1]) })) };
    }
  }
  if (cls.includes('contact-cta')) { const c = ctaFrom(el, 'contact-cta'); return c && { type: 'cta', ...c }; }
  if (t === 'p') { const m = text(el).match(TOKEN_RE); if (m && elKids(el).length === 0) return m[1] === 'video' ? { type: 'video', id: m[2] } : { type: 'coverage', key: m[2] }; }
  return null;
}

// Marker-wrapped content: <!-- ucc:TYPE … --> nodes <!-- /ucc -->
function blockFromMarker(kind, attrs, nodes) {
  const def = BLOCK_TYPES[kind];
  if (!def) return null;
  const html = serialize(nodes, SER).trim();
  const block = { type: kind, ...def.empty(), ...attrs };
  if (kind === 'prose' || kind === 'raw' || kind === 'sources') block.html = html;
  else if (kind === 'callout') { const tmp = parseFragmentTree(`<div class="${CALLOUT_ROOTS[block.variant] ? block.variant : 'callout'}">${html}</div>`); Object.assign(block, calloutFrom(tmp.children[0], CALLOUT_ROOTS[block.variant] ? block.variant : 'callout'), attrs.label ? { label: attrs.label } : {}); }
  else if (kind === 'quote') { const tmp = parseFragmentTree(`<blockquote>${html}</blockquote>`); Object.assign(block, quoteFrom(tmp.children[0]), attrs.source ? { source: attrs.source } : {}, attrs.cite ? { cite: attrs.cite } : {}); }
  else if (kind === 'pullquote') { const tmp = parseFragmentTree(`<div>${html}</div>`); const q = quoteFrom(tmp.children[0]); block.html = q.html.replace(/^<p>([\s\S]*)<\/p>$/, '$1'); if (!attrs.cite) block.cite = q.cite; }
  else if (kind === 'table') { const tmp = parseFragmentTree(`<div>${html}</div>`); const tb = tableFrom(tmp.children[0]); if (!tb) return null; Object.assign(block, tb, attrs.variant ? { variant: attrs.variant } : {}); }
  else if (kind === 'figure') { const tmp = parseFragmentTree(`<figure>${html}</figure>`); const f = figureFrom(tmp.children[0]); if (!f) return null; Object.assign(block, f, attrs); }
  else if (kind === 'stats') {
    // <li>5,171,087 — Searches since 2022</li> or <p>number</p><p>desc</p> pairs
    const tmp = parseFragmentTree(`<div>${html}</div>`);
    const lis = findAll(tmp.children[0], c => tag(c) === 'li');
    block.items = lis.map(li => { const [num, ...rest] = inner(li).split(/\s+[—–-]\s+/); return { num: num.replace(/<[^>]+>/g, '').trim(), desc: rest.join(' - ').trim(), wide: false }; });
  } else if (kind === 'files' || kind === 'cta') {
    const tmp = parseFragmentTree(`<div>${html}</div>`);
    const links = findAll(tmp.children[0], c => tag(c) === 'a').map(a => ({ label: text(a), href: a.attribs.href || '' }));
    if (kind === 'files') block.items = links; else { block.buttons = links; const h = find(tmp.children[0], c => /^h[2-4]$/.test(tag(c))); const p = find(tmp.children[0], c => tag(c) === 'p'); if (h && !attrs.heading) block.heading = text(h); if (p) block.html = inner(p); }
  } else if (kind === 'accordion') {
    // h3 + following content per item
    const tmp = parseFragmentTree(`<div>${html}</div>`);
    const items = []; let cur = null;
    for (const c of kids(tmp.children[0])) {
      if (/^h[3-4]$/.test(tag(c))) { cur = { summary: text(c), html: '', open: items.length === 0 }; items.push(cur); }
      else if (cur) cur.html += outer(c);
    }
    block.items = items;
  }
  return block;
}

// ─── the pass ───

function unwrap(nodes) {
  // Flatten the legacy wrappers so the stream is the body's flow.
  const out = [];
  for (const n of nodes) {
    if (isBlank(n)) continue;
    if (isEl(n) && !has(n, 'subpage-hero') && (tag(n) === 'div' || tag(n) === 'section' || tag(n) === 'main' || tag(n) === 'article')) {
      const cls = getClasses(n);
      const wrapper = cls.length === 0 || cls.every(c => WRAPPER_CLASSES.includes(c) || /^bg-/.test(c) || SCOPED_RE.test(c));
      // Only unwrap when the element is not itself a block and holds flow
      // content (a heading, meta strip, or several children).
      if (wrapper && !blockFor(n) && (find(n, c => /^h[12]$/.test(tag(c)) || has(c, 'release-meta')) || kids(n).length > 1)) {
        const scoped = cls.filter(c => SCOPED_RE.test(c));
        const isBand = cls.some(c => /-body$/.test(c));
        if (scoped.length || isBand) out.push({ type: 'comment', data: `ucc:section${isBand ? ' band="1"' : ''} classes="${scoped.join(' ')}"` });
        out.push(...unwrap(n.children));
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

function readHero(hero, header, out) {
  const label = find(hero, c => has(c, 'section-label'));
  const h1 = find(hero, c => tag(c) === 'h1');
  const ctas = find(hero, c => has(c, 'hero-ctas'));
  const prov = find(hero, c => has(c, 'hero-provenance'));
  if (label) header.eyebrow = text(label);
  if (h1) out.title = text(h1);
  const ps = elKids(hero).filter(c => tag(c) === 'p' && c !== prov && c !== label);
  header.summary = ps.map(outer).join('\n');
  const cta = (a) => ({ label: text(a), href: a.attribs.href || '', kind: has(a, 'hero-secondary') ? 'secondary' : 'primary', icon: find(a, c => tag(c) === 'svg') ? 'download' : '' });
  const direct = elKids(hero).filter(a => tag(a) === 'a' && (has(a, 'hero-download') || has(a, 'hero-secondary')));
  header.ctas = [...(ctas ? elKids(ctas).filter(a => tag(a) === 'a') : []), ...direct].map(cta);
  if (prov) header.provenance = inner(prov);
  const leftovers = elKids(hero).filter(c => c !== label && c !== h1 && c !== ctas && c !== prov && tag(c) !== 'p' && !direct.includes(c));
  return leftovers;
}

function readMeta(meta, header, out) {
  for (const s of elKids(meta)) {
    if (has(s, 'release-badge')) header.badge = text(s);
    else if (has(s, 'release-badge-status')) header.status = text(s);
    else if (has(s, 'release-date')) header.date = text(s);
    else if (has(s, 'release-author')) {
      const m = text(s).match(BYLINE_RE);
      if (m) { out.author = m[1].trim(); header.authorTitle = (m[2] || '').trim(); }
      const a = find(s, c => tag(c) === 'a'); if (a) out.authorHref = a.attribs.href || '';
    } else if (has(s, 'download-inline')) { header.metaLinkLabel = text(s); header.metaLinkHref = s.attribs.href || ''; }
  }
}

function parse(html, opts = {}) {
  const tree = parseFragmentTree(String(html || ''));
  const out = { title: '', author: '', authorHref: '', body: emptyBody(), extras: [], report: { raw: 0, notes: [], wrappers: [] } };
  const header = out.body.header;
  const sections = out.body.sections;
  const nodes = unwrap(tree.children);
  for (const w of findAll(tree, c => getClasses(c).some(x => WRAPPER_CLASSES.includes(x)))) for (const c of getClasses(w)) if (WRAPPER_CLASSES.includes(c) && !out.report.wrappers.includes(c)) out.report.wrappers.push(c);

  let section = null;            // current section
  let prose = null;              // open Text block being accumulated
  let sawHero = false, sawH1 = false, sawMeta = false, tocEl = null, pendingSection = null, preH1Raw = false;
  let bandCount = 0;
  const sectionExtra = () => {
    const p = pendingSection; pendingSection = null;
    if (!p) return {};
    const band = Boolean(p.band) && bandCount++ > 0; // the first band is the default column
    if (p.band && !band) bandCount = 1;
    return { eyebrow: p.eyebrow || '', dek: p.dek || '', tocLabel: p.tocLabel || '', band, classes: p.classes ? p.classes.split(/\s+/).filter(Boolean) : [] };
  };
  const ensureSection = () => { if (!section) { section = newSection(''); sections.push(section); } return section; };
  const flushProse = () => { prose = null; };
  const push = (block) => { flushProse(); ensureSection().blocks.push({ id: newId(), ...block }); };
  const pushRaw = (n, why) => { out.report.raw++; out.report.notes.push(`${why}: <${tag(n) || n.type}${isEl(n) && n.attribs.class ? ` class="${n.attribs.class}"` : ''}>`); if (!sawH1) preH1Raw = true; push({ type: 'raw', html: outer(n) }); };
  const addProse = (n) => { if (!prose) { prose = { id: newId(), type: 'prose', html: '' }; ensureSection().blocks.push(prose); } prose.html += (prose.html ? '\n' : '') + outer(n); };
  const startSection = (heading, anchor, extra = {}) => { flushProse(); section = { ...newSection(heading), anchor: anchor || '', ...extra }; sections.push(section); };

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (isText(n)) { if (n.data.trim()) addProse(n); continue; }
    if (isComment(n)) {
      const mk = parseMarker(n.data);
      if (!mk) continue;
      if (mk.kind === 'header') { Object.assign(header, mk.attrs); if (mk.attrs.author) out.author = mk.attrs.author; continue; }
      if (mk.kind === 'section') { pendingSection = mk.attrs; continue; }
      // wrapped block
      const inside = [];
      let j = i + 1;
      for (; j < nodes.length && !isEndMarker(nodes[j]); j++) inside.push(nodes[j]);
      const block = blockFromMarker(mk.kind, mk.attrs, inside);
      if (block) { push(block); i = j; continue; }
      out.report.notes.push(`unknown marker ucc:${mk.kind}`);
      continue;
    }
    if (!isEl(n)) continue;
    const t = tag(n);

    if (has(n, 'subpage-hero')) { sawHero = true; sawH1 = true; for (const left of readHero(n, header, out)) pushRaw(left, 'hero leftover'); continue; }
    if (has(n, 'release-meta')) {
      sawMeta = true; readMeta(n, header, out);
      // A byline inside a section (stratos: under the first part header) stays there.
      if (section && (section.heading || section.blocks.length)) push({ type: 'byline' });
      continue;
    }
    if (has(n, 'paper-provenance')) { header.note = inner(n); continue; }
    if (has(n, 'paper-toc')) { tocEl = n; continue; }
    if (has(n, 'part-header')) {
      const h2 = find(n, c => tag(c) === 'h2'); const eye = find(n, c => has(c, 'part-header-eyebrow')); const dek = elKids(n).find(c => tag(c) === 'p');
      if (h2) { startSection(text(h2), h2.attribs.id, { ...sectionExtra(), eyebrow: eye ? text(eye) : '', dek: dek ? inner(dek) : '' }); continue; }
    }
    if (t === 'h1' && !sawH1 && preH1Raw) {
      // A letterhead-style page (masthead before the title): no hero, the
      // page draws its own top. Keep the title where it is.
      sawH1 = true; header.layout = 'none'; out.title = text(n); push({ type: 'raw', html: outer(n) }); continue;
    }
    if (t === 'h1' && !sawH1) {
      sawH1 = true; out.title = text(n);
      // Heuristic header: a short line just above the h1 is the eyebrow.
      if (section && section.blocks.length === 1 && section.blocks[0].type === 'prose') {
        const m = section.blocks[0].html.match(/^<p>([^<]{2,60})<\/p>$/);
        if (m && !/[.!?]$/.test(m[1])) { header.eyebrow = m[1]; sections.pop(); section = null; prose = null; }
      }
      continue;
    }
    if (t === 'h2') { startSection(text(n), n.attribs.id, sectionExtra()); continue; }
    if (has(n, 'ask-item')) {
      // a run of ask-items is one Asks block
      const run = [n];
      while (i + 1 < nodes.length && has(nodes[i + 1], 'ask-item')) run.push(nodes[++i]);
      const asks = run.map(blockFor);
      if (asks.every(Boolean)) { push({ type: 'asks', items: asks.flatMap(a => a.items) }); continue; }
      for (const r of run) pushRaw(r, 'no block for');
      continue;
    }

    // Heuristic header fields before the first section (plain documents).
    if (!sawHero && sawH1 && header.layout !== 'none' && !sections.some(s => s.heading) && t === 'p' && elKids(n).every(c => ['a', 'strong', 'em', 'br'].includes(tag(c)))) {
      const s = text(n);
      const by = s.match(BYLINE_RE);
      if (by && s.length < 120) { out.author = by[1].trim(); header.authorTitle = (by[2] || '').trim(); continue; }
      if (DATE_RE.test(s) && s.length < 80) { header.date = s; continue; }
      if (!header.summary && !prose) { header.summary = outer(n); continue; }
    }

    if (t === 'details') {
      // a run of <details> is one accordion
      const items = [accordionItem(n)];
      while (i + 1 < nodes.length && tag(nodes[i + 1]) === 'details') items.push(accordionItem(nodes[++i]));
      push({ type: 'accordion', items });
      continue;
    }
    const block = blockFor(n);
    if (block) { push(block); continue; }
    if (PROSE_TAGS.has(t)) { addProse(n); continue; }
    if (t === 'p') { addProse(n); continue; }
    pushRaw(n, 'no block for');
  }

  // Contents list: auto when its links are the sections in order (labels
  // may be shorter than the headings), else keep it verbatim.
  const legacy = sawHero || out.report.wrappers.length > 0;
  if (tocEl) {
    const links = findAll(tocEl, c => tag(c) === 'a').map(a => ({ href: (a.attribs.href || '').replace(/^#/, ''), text: text(a) }));
    const heads = sections.filter(s => s.heading);
    const same = links.length === heads.length && links.every((l, k) => l.href === (heads[k].anchor || slugify(heads[k].heading)));
    if (same) { header.toc = 'auto'; links.forEach((l, k) => { if (l.text !== heads[k].heading) heads[k].tocLabel = l.text; }); }
    else { header.toc = 'none'; const first = sections[0] && !sections[0].heading ? sections[0] : (sections.unshift(newSection('')), sections[0]); first.blocks.unshift({ id: newId(), type: 'raw', html: outer(tocEl) }); out.report.raw++; out.report.notes.push('contents list does not match the headings; kept as HTML'); }
  } else header.toc = legacy || sections.filter(s => s.heading).length < 2 ? 'none' : 'auto';
  // A legacy page without a meta strip prints none; a plain upload gets the default badge.
  if (legacy && !sawMeta) header.badge = '';
  for (const s of sections) for (const b of s.blocks) if (b.type === 'prose') b.html = b.html.trim();
  // Drop an empty leading section.
  if (sections.length && !sections[0].heading && !sections[0].blocks.length) sections.shift();
  return out;
}

module.exports = { parse, parseMarker, blockFor };
