// blocks → body HTML (docs/systems/document-builder.md "Markup"). The output
// is the fragment saved as documents.body_html_raw, so it still goes through
// the ingest on save and on publish: text fields are escaped here, rich text
// fields (inline/html) pass through and are sanitised by the ingest. Every
// block root carries data-block="<id>" so the live preview can map a click
// back to the block being edited (the ingest keeps data-* attributes).
import engine from '@uccsite/render/engine.js';
import { BLOCK_TYPES, CALLOUT_VARIANTS, CTA_VARIANTS, CTA_ICONS, slugify, fullWidth } from './schema.js';

const { escapeHtml } = engine;

const esc = (s) => escapeHtml(String(s ?? ''));
const nl = '\n';

// Rich text that is meant to be one paragraph may arrive wrapped in <p>
// (contenteditable does that); block-level rich text may arrive bare.
function inline(html) {
  const s = String(html ?? '').trim();
  const m = s.match(/^<p>([\s\S]*)<\/p>$/i);
  return m && !/<p[\s>]/i.test(m[1]) ? m[1] : s;
}
function paragraphs(html) {
  const s = String(html ?? '').trim();
  if (!s) return '';
  return /^<(p|h[1-6]|ul|ol|div|table|blockquote|figure|pre|details|hr)\b/i.test(s) ? s : `<p>${s}</p>`;
}
function attrs(block, extra = '') {
  const cls = [extra, ...(Array.isArray(block.classes) ? block.classes : [])].filter(Boolean).join(' ');
  return `${cls ? ` class="${esc(cls)}"` : ''} data-block="${esc(block.id)}"`;
}
function link(href, label, { external, cls } = {}) {
  const ext = external || /^https?:\/\//i.test(String(href || '')) && !/^https?:\/\/(www\.)?utahciviccompact\.org/i.test(href);
  return `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}${cls ? ` class="${esc(cls)}"` : ''}>${inline(label)}</a>`;
}

// Text blocks write their children bare, each top-level element tagged with
// the block id, so the page flow (and :first-of-type / :last-child rules in a
// legacy page's CSS) is exactly what a hand-written page would have.
function tagChildren(html, id) {
  return String(html || '').replace(/^<([a-z][a-z0-9]*)(\s|>)/gim, (m, t, rest) => `<${t} data-block="${esc(id)}"${rest === '>' ? '>' : ' '}`);
}

const renderers = {
  prose: (b) => tagChildren(paragraphs(b.html), b.id),

  quote: (b) => [
    `<blockquote${attrs(b)}>`,
    b.source ? `<span class="quote-source">${esc(b.source)}</span>` : '',
    paragraphs(b.html),
    b.cite ? `<cite>— ${inline(b.cite)}</cite>` : '',
    `</blockquote>`,
  ].filter(Boolean).join(nl),

  pullquote: (b) => [
    `<div${attrs(b, 'pull-quote')}>`,
    `<p>${inline(b.html)}</p>`,
    b.cite ? `<cite>${inline(b.cite)}</cite>` : '',
    `</div>`,
  ].filter(Boolean).join(nl),

  callout: (b) => {
    const v = CALLOUT_VARIANTS.find(x => x.value === b.variant) || CALLOUT_VARIANTS[0];
    // legacyClass: a converted page's own box class (report-callout,
    // theory-stat, acknowledgment) written INSTEAD of the variant's root so
    // the page CSS keeps styling it; choosing a variant in the editor clears it.
    const root = b.legacyClass || v.root;
    const labelClass = b.legacyLabelClass || v.labelClass;
    let label = '';
    if (b.label) {
      if (v.labelTag) label = `<${v.labelTag}>${esc(b.label)}</${v.labelTag}>`;
      else if (v.labelInline) label = ''; // draft-def: the term sits inside the first paragraph
      else label = `<div class="${esc(labelClass)}">${esc(b.label)}</div>`;
    }
    let body = paragraphs(b.html);
    if (b.label && v.labelInline) body = body.replace(/^<p>/i, `<p><span class="${esc(labelClass)}">${esc(b.label)}</span> `);
    return [`<div${attrs(b, root)}>`, label, body, `</div>`].filter(Boolean).join(nl);
  },

  stats: (b) => {
    const items = Array.isArray(b.items) ? b.items : [];
    if (b.variant === 'band') {
      const cells = items.map(it => `<div class="impact-stat"><div class="impact-number">${esc(it.num)}</div><div class="impact-label">${inline(it.desc)}</div></div>`);
      return `<section${attrs(b, 'impact section')}><div class="container"><div class="impact-grid">${nl}${cells.join(`${nl}<div class="impact-divider"></div>${nl}`)}${nl}</div></div></section>`;
    }
    const cells = items.map(it => `<div class="stat-card${it.wide ? ' wide' : ''}"><div class="stat-num">${esc(it.num)}</div><div class="stat-desc">${inline(it.desc)}</div></div>`);
    return `<div${attrs(b, 'stats-grid')}>${nl}${cells.join(nl)}${nl}</div>`;
  },

  figure: (b) => [
    `<figure${attrs(b, 'evidence-figure')}>`,
    `<img src="${esc(b.src)}" alt="${esc(b.alt)}"${b.width ? ` width="${esc(b.width)}"` : ''}${b.height ? ` height="${esc(b.height)}"` : ''} loading="lazy" />`,
    b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : '',
    `</figure>`,
  ].filter(Boolean).join(nl),

  table: (b) => {
    const head = Array.isArray(b.head) ? b.head : [];
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const variant = b.variant || 'doc-table';
    const row = (cells, tag, cls) => `<tr${cls ? ` class="${esc(cls)}"` : ''}>${(Array.isArray(cells) ? cells : cells.cells || []).map(c => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
    const table = [
      `<table class="${esc(variant)}">`,
      b.caption ? `<caption>${inline(b.caption)}</caption>` : '',
      head.length ? `<thead>${row(head, 'th')}</thead>` : '',
      `<tbody>${nl}${rows.map(r => row(r, 'td', Array.isArray(r) ? '' : r.cls)).join(nl)}${nl}</tbody>`,
      `</table>`,
    ].filter(Boolean).join(nl);
    const cls = esc(b.legacyClass || variant);
    if (b.bare) return table.replace(/^<table class="[^"]*">/, `<table${attrs(b, cls)}>`);
    const wrap = b.legacyWrap || (variant === 'rank-table' ? 'table-scroll' : variant === 'doc-table' ? 'doc-table-wrap' : 'table-wrap');
    return `<div${attrs(b, wrap)}>${nl}${table.replace(/^<table class="[^"]*">/, `<table class="${cls}">`)}${nl}</div>`;
  },

  files: (b) => `<div${attrs(b, 'table-downloads')}>${nl}${(b.items || []).filter(it => it.href || it.label).map(it => link(it.href, esc(it.label), { cls: 'btn-file' })).join(nl)}${nl}</div>`,

  cta: (b) => [
    `<div${attrs(b, b.variant || 'related-cta')}>`,
    b.heading ? `<h3>${esc(b.heading)}</h3>` : '',
    b.html ? `<p>${inline(b.html)}</p>` : '',
    ...(b.buttons || []).filter(x => x.href || x.label).map(x => link(x.href, (CTA_ICONS[x.icon] ? CTA_ICONS[x.icon] + ' ' : '') + esc(x.label), { cls: (CTA_VARIANTS.find(v => v.value === b.variant) || CTA_VARIANTS[0]).button })),
    `</div>`,
  ].filter(Boolean).join(nl),

  sources: (b) => {
    if (b.variant === 'grid') {
      const items = (b.items || []).map(it => `<div class="source-item">${it.href ? link(it.href, `<strong>${esc(it.label)}</strong>`) : `<strong>${esc(it.label)}</strong>`}${it.html ? `<p>${inline(it.html)}</p>` : ''}</div>`);
      return `<div${attrs(b, 'sources-grid')}>${nl}${items.join(nl)}${nl}</div>`;
    }
    return `<div${attrs(b, 'sources-list')}>${nl}${paragraphs(b.html)}${nl}</div>`;
  },

  accordion: (b) => `<div${attrs(b, 'doc-accordion')}>${nl}${(b.items || []).map(it =>
    `<details${it.open ? ' open' : ''}>${nl}<summary>${esc(it.summary)}</summary>${nl}<div class="section-body">${nl}${paragraphs(it.html)}${nl}</div>${nl}</details>`).join(nl)}${nl}</div>`,

  partsnav: (b) => `<div${attrs(b, 'parts-nav')}>${nl}${(b.items || []).map(it => `<a class="part-card" href="${esc(it.href)}"><div class="part-card-num">${esc(it.num)}</div><div class="part-card-title">${esc(it.title)}</div><div class="part-card-desc">${inline(it.desc)}</div></a>`).join(nl)}${nl}</div>`,

  asks: (b) => `<div${attrs(b, 'ask-list')}>${nl}${(b.items || []).map(it => `<div class="ask-item"><h3>${esc(it.heading)}</h3><p>${inline(it.html)}</p></div>`).join(nl)}${nl}</div>`,

  cards: (b) => `<div${attrs(b, 'join-grid')}>${nl}${(b.items || []).map(it => `<div class="join-card"><strong>${esc(it.heading)}</strong><p>${inline(it.html)}</p></div>`).join(nl)}${nl}</div>`,

  video: (b) => `<p${attrs(b)}>{{video:${String(b.id || '').replace(/[^A-Za-z0-9_-]/g, '')}}}</p>`,
  coverage: (b) => `<p${attrs(b)}>{{coverage:${String(b.key || '').replace(/[^A-Za-z0-9_-]/g, '')}}}</p>`,
  raw: (b) => `<div${attrs(b)}>${nl}${String(b.html || '')}${nl}</div>`,
  byline: (b, ctx) => renderMeta(ctx.body, ctx.doc, ctx.opts, b),
};

// ctx = { body, doc, opts } for blocks that read header fields (byline).
function renderBlock(block, ctx = {}) {
  const r = renderers[block.type];
  if (!r) throw new Error(`Unknown block type "${block.type}"`);
  return r(block, ctx);
}

// sectionAnchor(section) → the id the h2 carries and the contents list links to.
function sectionAnchor(section) {
  return section.anchor ? String(section.anchor).trim() : slugify(section.heading);
}

// renderSection(section, ctx, band) — band: { open(classes), close() }
// manages the white column; a full-width block closes it and the next
// in-column content reopens it.
function renderSection(section, ctx = {}, band = null) {
  const out = [];
  // classes → a wrapper div inside the column (a legacy per-section wrapper
  // such as report-section, or styling the editor added to the section).
  const wrap = Array.isArray(section.classes) && section.classes.length > 0;
  const ensure = () => { if (band) { const o = band.open(); if (o) out.push(o); } };
  if (wrap) { ensure(); out.push(`<div class="${esc(section.classes.join(' '))}" data-section="${esc(section.id)}">`); }
  if (section.heading) ensure();
  if (section.heading) {
    const id = esc(sectionAnchor(section));
    if (section.eyebrow || section.dek) {
      out.push(`<div class="part-header" data-section="${esc(section.id)}">`);
      if (section.eyebrow) out.push(`<div class="part-header-eyebrow">${esc(section.eyebrow)}</div>`);
      out.push(`<h2 id="${id}">${esc(section.heading)}</h2>`);
      if (section.dek) out.push(`<p>${inline(section.dek)}</p>`);
      out.push(`</div>`);
    } else {
      out.push(`<h2 id="${id}" data-section="${esc(section.id)}">${esc(section.heading)}</h2>`);
    }
  }
  for (const b of section.blocks || []) {
    if (band && fullWidth(b) && !wrap) { const c = band.close(); if (c) out.push(c); }
    else ensure();
    out.push(renderBlock(b, ctx));
  }
  if (wrap) out.push('</div>');
  return out.join(nl);
}

// renderHeader(body, doc, opts) → the hero + meta strip + contents list.
// doc: { title, author }; opts.authorHref: /team/<slug> when the author is a
// team member (resolved by the caller), else the name prints without a link.
function renderHeader(body, doc, { authorHref } = {}) {
  const h = body.header || {};
  if (h.layout === 'none') return '';
  const out = [`<div class="subpage-hero">`];
  const eyebrowTag = h.eyebrowTag === 'p' ? 'p' : 'div'; // a legacy page may have written the label as <p>
  if (h.eyebrow) out.push(`<${eyebrowTag} class="section-label">${esc(h.eyebrow)}</${eyebrowTag}>`);
  out.push(`<h1>${esc(h.headline || doc.title)}</h1>`);
  if (h.summary) out.push(paragraphs(h.summary));
  const ctas = (h.ctas || []).filter(c => c.href || c.label);
  if (ctas.length) {
    if (!h.ctasBare) out.push(`<div class="hero-ctas">`);
    for (const c of ctas) out.push(link(c.href, (CTA_ICONS[c.icon] ? CTA_ICONS[c.icon] + ' ' : '') + esc(c.label), { cls: c.kind === 'secondary' ? 'hero-secondary' : 'hero-download' }));
    if (!h.ctasBare) out.push(`</div>`);
  }
  if (h.provenance) out.push(`<p class="hero-provenance">${inline(h.provenance)}</p>`);
  out.push(`</div>`);
  return out.join(nl);
}

function renderMeta(body, doc, { authorHref } = {}, block = null) {
  const h = body.header || {};
  const author = String(doc.author || '').trim();
  const parts = [];
  if (h.badge) parts.push(`<span class="release-badge">${esc(h.badge)}</span>`);
  if (h.status) parts.push(`<span class="release-badge-status">${esc(h.status)}</span>`);
  if (h.date) parts.push(`<span class="release-date">${esc(h.date)}</span>`);
  if (author) parts.push(`<span class="release-author">By ${authorHref ? `<a href="${esc(authorHref)}">${esc(author)}</a>` : esc(author)}${h.authorTitle ? `, ${esc(h.authorTitle)}` : ''}</span>`);
  if (h.metaLinkHref || h.metaLinkLabel) parts.push(`<a href="${esc(h.metaLinkHref)}" download class="download-inline">${CTA_ICONS.downloadSmall} ${esc(h.metaLinkLabel || 'Download')}</a>`);
  if (!parts.length) return block ? `<div${attrs(block, 'release-meta')}></div>` : '';
  return `<div${block ? attrs(block, 'release-meta') : ' class="release-meta"'}>${nl}${parts.join(nl)}${nl}</div>`;
}

const hasBylineBlock = (body) => (body.sections || []).some(s => (s.blocks || []).some(b => b.type === 'byline'));

function renderToc(body) {
  if ((body.header || {}).toc === 'none') return '';
  const items = (body.sections || []).filter(s => s.heading);
  if (items.length < 2) return '';
  // div, not nav: the ingest allowlist (html-ingest ALLOWED_TAGS) has no nav.
  return [
    `<div class="paper-toc" role="navigation" aria-label="Contents">`,
    `<div class="paper-toc-label">Contents</div>`,
    `<ol>`,
    ...items.map(s => `<li><a href="#${esc(sectionAnchor(s))}">${esc(s.tocLabel || s.heading)}</a></li>`),
    `</ol>`,
    `</div>`,
  ].join(nl);
}

// serialize(body, doc, opts) → body_html_raw. doc: { title, author }.
// The body is one or more white "bands" (div.doc-body > div.doc-inner, the
// reading column); a section with `band` starts a new one, carrying the
// section's classes on the band; a full-width block sits between bands.
function serialize(body, doc = {}, opts = {}) {
  const h = body.header || {};
  const ctx = { body, doc, opts };
  const out = [];
  const hero = renderHeader(body, doc, opts);
  if (hero) out.push(hero);
  // The frame: nested wrapper divs around the column. Default doc-body >
  // doc-inner; a converted legacy document keeps its own (header.frame,
  // e.g. ['paper-body', 'paper-inner']) so its page CSS keeps applying.
  const frame = Array.isArray(h.frame) && h.frame.length ? h.frame.map(String) : ['doc-body', 'doc-inner'];
  let open = false;
  let nextClasses = [];
  const band = {
    open: () => {
      if (open) return '';
      open = true;
      const levels = frame.map((cls, i) => (i === 0 ? [cls, ...nextClasses].filter(Boolean).join(' ') : cls));
      nextClasses = [];
      return levels.map(cls => `<div class="${esc(cls)}">`).join(nl);
    },
    close: () => { if (!open) return ''; open = false; return frame.map(() => '</div>').join(nl); },
  };
  if (h.layout !== 'none') {
    const meta = hasBylineBlock(body) ? '' : renderMeta(body, doc, opts);
    const toc = renderToc(body);
    if (meta || h.note || toc) out.push(band.open());
    if (meta) out.push(meta);
    if (h.note) out.push(`<p class="paper-provenance">${inline(h.note)}</p>`);
    if (toc) out.push(toc);
  }
  for (const s of body.sections || []) {
    if (s.band) { const c = band.close(); if (c) out.push(c); nextClasses = Array.isArray(s.bandClasses) ? s.bandClasses : []; }
    const html = renderSection(s, ctx, band);
    if (html) out.push(html);
  }
  const c = band.close(); if (c) out.push(c);
  if (!out.length) return `${band.open()}${nl}${band.close()}${nl}`;
  return out.join(nl) + nl;
}

// sampleHtml(type) → the picker preview fragment for one block type, or ''.
function sampleHtml(type) {
  const def = BLOCK_TYPES[type];
  if (!def || !def.sample) return '';
  return renderBlock({ id: `sample-${type}`, type, ...def.sample });
}

export { serialize, renderBlock, renderSection, renderHeader, renderMeta, renderToc, sectionAnchor, sampleHtml, inline, paragraphs };
