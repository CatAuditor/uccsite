// Block registry for the document builder (docs/systems/document-builder.md).
// One entry per block type: what the editor shows (label, fields, variants),
// what the picker previews (sample) and what an empty block looks like.
// serialize.js reads the same registry so markup and editor never drift.
//
// Field kinds the builder UI knows how to edit:
//   text    one line of plain text (escaped on output)
//   inline  one paragraph of rich text (inline HTML: strong/em/a/br)
//   html    several paragraphs of rich text (block HTML: p/h3/h4/ul/ol/...)
//   url     a link or image path
//   bool    checkbox
//   select  one of `options`
//   list    repeated group of fields (`of`), with add/remove/move
//
// ES module (the package is "type": "module"): the admin's client components
// import this file into the browser bundle, which a CommonJS file cannot be.

const VERSION = 1;

// Variants are the curated styling choices per type. Each maps to the
// canonical class the site stylesheet's "Document blocks" group defines
// (css/styles.css). The first variant is the default.
const CALLOUT_VARIANTS = [
  { value: 'callout', label: 'Callout (white, red bar)', root: 'callout', labelClass: 'callout-label' },
  { value: 'callout-dark', label: 'Callout, dark (navy)', root: 'callout-dark', labelClass: 'callout-label' },
  { value: 'scope-box', label: 'Scope box (cream, navy border)', root: 'scope-box', labelClass: 'scope-box-label' },
  { value: 'finding-box', label: 'Finding (navy, large text)', root: 'finding-box', labelTag: 'h3' },
  { value: 'violation-box', label: 'Violation (grey, red bar, red heading)', root: 'violation-box', labelTag: 'h3' },
  { value: 'update-note', label: 'Update note (grey, navy bar)', root: 'update-note', labelClass: 'update-note-label' },
  { value: 'draft-def', label: 'Draft definition (cream, navy bar)', root: 'draft-def', labelClass: 'def-term', labelInline: true },
];
// Legacy box classes a converted page may carry instead of a variant root
// (block.legacyClass): read as the nearest variant, written back unchanged.
const CALLOUT_LEGACY = { acknowledgment: 'scope-box', 'report-callout': 'callout', 'report-callout-dark': 'callout-dark', 'theory-stat': 'finding-box' };

const TABLE_VARIANTS = [
  { value: 'doc-table', label: 'Data table (navy header)' },
  { value: 'own-table', label: 'Plain table (grey header row)' },
  { value: 'rank-table', label: 'Ranked table (sticky header, scrolls)' },
  { value: 'timeline-table', label: 'Timeline table' },
];

const STATS_VARIANTS = [
  { value: 'cards', label: 'Stat cards (grey, two columns)' },
  { value: 'band', label: 'Impact band (navy, full width)' },
];

const SOURCES_VARIANTS = [
  { value: 'list', label: 'Source paragraphs' },
  { value: 'grid', label: 'Source cards' },
];

const CTA_VARIANTS = [
  { value: 'related-cta', label: 'Related reading (cream box, navy buttons)', button: 'btn-file' },
  { value: 'download-cta', label: 'Download box', button: 'btn-download' },
  { value: 'contact-cta', label: 'Contact (navy box, red button)', button: 'btn-contact' },
];

// Hero button icons: the inline SVG the site uses, by name.
const DOWNLOAD_PATHS = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
const CTA_ICONS = {
  download: `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${DOWNLOAD_PATHS}</svg>`,
  downloadSmall: `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${DOWNLOAD_PATHS}</svg>`,
};

const F = (key, label, kind, extra = {}) => ({ key, label, kind, ...extra });

const BLOCK_TYPES = {
  prose: {
    label: 'Text',
    description: 'Paragraphs, sub-headings (h3/h4), lists and inline links. Most of a piece.',
    fields: [F('html', 'Text', 'html')],
    empty: () => ({ html: '<p></p>' }),
    sample: { html: '<p>Weber County operates ten license-plate reader cameras. Records released under GRAMA show <strong>5,171,087 searches</strong> against the networks it administers.</p><h3>What one row contains</h3><ul><li>Agency, reason given, timestamp</li><li>Which network answered</li></ul>' },
  },
  quote: {
    label: 'Quotation',
    description: 'A quoted passage with a small red source label above and a citation below. Statutes, contracts, emails.',
    fields: [F('source', 'Source label', 'text', { hint: 'e.g. Utah Code, Contract § 1.3' }), F('html', 'Quoted text', 'html'), F('cite', 'Citation', 'inline', { hint: 'shown after a dash; may contain a link' })],
    empty: () => ({ source: '', html: '<p></p>', cite: '' }),
    sample: { source: 'Utah Code', html: '<p>"cameras used in combination with computer algorithms to convert an image of a license plate into computer-readable data."</p>', cite: '<a href="https://le.utah.gov/xcode/Title41/Chapter6A/41-6a-S2002.html">§ 41-6a-2002(2)</a>' },
  },
  pullquote: {
    label: 'Pull quote',
    description: 'One sentence set large and white on navy, centred. Use once or twice in a long piece.',
    fields: [F('html', 'Quote', 'inline'), F('cite', 'Attribution', 'inline')],
    empty: () => ({ html: '', cite: '' }),
    sample: { html: 'We did not know other states could see our data.', cite: 'Weber County commissioner, public meeting, 7 April 2026' },
  },
  callout: {
    label: 'Callout box',
    description: 'A boxed note: scope of the analysis, a finding, an update, a definition. Pick the look from the variants.',
    variants: CALLOUT_VARIANTS,
    fields: [F('label', 'Label', 'text', { hint: 'small heading line; blank for none' }), F('html', 'Text', 'html')],
    empty: () => ({ variant: 'callout', label: '', html: '<p></p>' }),
    sample: { variant: 'scope-box', label: 'The boundaries of this analysis', html: '<p>Utah Civic Compact does not claim that any search of these ten cameras was unlawful, or that any Utahn has been identifiably harmed.</p>' },
  },
  stats: {
    label: 'Key figures',
    description: 'Large numbers with a short description each: a grid of grey cards, or the navy impact band.',
    variants: STATS_VARIANTS,
    fields: [F('items', 'Figures', 'list', { of: [F('num', 'Number', 'text'), F('desc', 'Description', 'inline'), F('wide', 'Full width', 'bool')] })],
    empty: () => ({ variant: 'cards', items: [{ num: '', desc: '', wide: false }, { num: '', desc: '', wide: false }] }),
    sample: { variant: 'cards', items: [{ num: '5,171,087', desc: 'Searches, February 2022 to July 2026' }, { num: '3,343', desc: 'Agencies that ran at least one search' }] },
  },
  figure: {
    label: 'Image',
    description: 'A picture from the Media library with a caption. Alt text is required before it can be placed.',
    fields: [F('src', 'Image', 'image'), F('alt', 'Alt text', 'text'), F('caption', 'Caption', 'inline')],
    empty: () => ({ src: '', alt: '', caption: '' }),
    sample: { src: '/assets/share-default.png', alt: 'Utah Civic Compact', caption: 'Figure 1. A sample image with its caption.' },
  },
  table: {
    label: 'Table',
    description: 'Rows and columns with a header row. Cells may hold inline formatting.',
    variants: TABLE_VARIANTS,
    fields: [F('caption', 'Caption', 'inline'), F('head', 'Header cells', 'cells'), F('rows', 'Rows', 'rows')],
    empty: () => ({ variant: 'doc-table', caption: '', head: ['', ''], rows: [['', '']] }),
    sample: { variant: 'doc-table', caption: '', head: ['Layer', 'What it is', 'Who holds it'], rows: [['Customer Data', 'What appears in the web interface', 'The county'], ['Footage', 'Raw still images and video', 'Excluded from Customer Data']] },
  },
  files: {
    label: 'File downloads',
    description: 'A row of red download buttons. Pick files from the Files library or paste links.',
    fields: [F('items', 'Files', 'list', { of: [F('label', 'Button text', 'text'), F('href', 'Link', 'file')] })],
    empty: () => ({ items: [{ label: '', href: '' }] }),
    sample: { items: [{ label: 'Download the records (CSV)', href: '#' }, { label: 'Methodology (PDF)', href: '#' }] },
  },
  cta: {
    label: 'Call to action',
    description: 'A centred cream box with a heading, a sentence and buttons. Related reading, the full archive, a petition.',
    variants: CTA_VARIANTS,
    fields: [F('heading', 'Heading', 'text'), F('html', 'Text', 'inline'), F('buttons', 'Buttons', 'list', { of: [F('label', 'Button text', 'text'), F('href', 'Link', 'url'), F('icon', 'Icon', 'select', { options: [{ value: '', label: 'None' }, { value: 'download', label: 'Download arrow' }] })] })],
    empty: () => ({ variant: 'related-cta', heading: '', html: '', buttons: [{ label: '', href: '' }] }),
    sample: { variant: 'related-cta', heading: 'The records behind this paper', html: 'Every figure comes from records Weber County released.', buttons: [{ label: 'Read the full investigation →', href: '/alpr.html' }] },
  },
  sources: {
    label: 'Sources',
    description: 'The sources an appendix lists: paragraphs, or a grid of cards with links.',
    variants: SOURCES_VARIANTS,
    fields: [F('html', 'Sources (paragraphs)', 'html', { variant: 'list' }), F('items', 'Sources (cards)', 'list', { variant: 'grid', of: [F('label', 'Title', 'text'), F('html', 'Detail', 'inline'), F('href', 'Link', 'url')] })],
    empty: () => ({ variant: 'list', html: '<p></p>', items: [] }),
    sample: { variant: 'grid', items: [{ label: 'Weber County order form', html: 'December 19, 2025', href: '#' }, { label: 'Utah Code § 41-6a-2004', html: 'Automatic License Plate Reader System Act', href: '#' }] },
  },
  accordion: {
    label: 'Collapsible sections',
    description: 'Headings that open to show their text. For long updates and FAQs.',
    fields: [F('items', 'Sections', 'list', { of: [F('summary', 'Heading', 'text'), F('html', 'Text', 'html'), F('open', 'Open by default', 'bool')] })],
    empty: () => ({ items: [{ summary: '', html: '<p></p>', open: true }] }),
    sample: { items: [{ summary: 'What this is about', html: '<p>Three candidates jointly filed a petition the day before ballots were mailed.</p>', open: true }, { summary: 'What happened next', html: '<p>The court dismissed it.</p>', open: false }] },
  },
  video: {
    label: 'YouTube video',
    description: 'An embedded YouTube video (the only video host the site allows).',
    fields: [F('id', 'YouTube video ID', 'text', { hint: 'the part after v= in the URL' })],
    empty: () => ({ id: '' }),
    sample: null, // needs a token expansion; the picker shows a label
  },
  coverage: {
    label: 'Press coverage strip',
    description: 'The site\'s coverage cards for one of the tracked reports.',
    fields: [F('key', 'Coverage key', 'coverage')],
    empty: () => ({ key: '' }),
    sample: null,
  },
  partsnav: {
    label: 'Part navigation',
    description: 'A navy row of linked cards, one per part of a long piece, each with a number, a title and a line of description.',
    fields: [F('items', 'Parts', 'list', { of: [F('num', 'Label', 'text', { hint: 'e.g. Part 1 · May 26, 2026' }), F('title', 'Title', 'text'), F('desc', 'Description', 'inline'), F('href', 'Link', 'url', { hint: '#anchor of the part' })] })],
    empty: () => ({ items: [{ num: '', title: '', desc: '', href: '' }] }),
    sample: { items: [{ num: 'Part 1', title: 'MIDA violated state law', desc: 'Three statutory violations in the approval.', href: '#part1' }, { num: 'Part 2', title: 'The money', desc: 'Who paid whom.', href: '#part2' }, { num: 'Part 3', title: 'What comes next', desc: 'The open questions.', href: '#part3' }] },
  },
  asks: {
    label: 'Asks',
    description: 'A stacked list of short headed items: what we are asking for, recommendations, next steps.',
    fields: [F('items', 'Items', 'list', { of: [F('heading', 'Heading', 'text'), F('html', 'Text', 'inline')] })],
    empty: () => ({ items: [{ heading: '', html: '' }] }),
    sample: { items: [{ heading: 'A legislative audit', html: 'The Legislative Auditor General can audit any political subdivision.' }, { heading: 'Disclosure', html: 'Every agency should publish its network sharing configuration.' }] },
  },
  cards: {
    label: 'Card grid',
    description: 'Two columns of grey cards, each with a red heading and a short paragraph. Who should do what.',
    fields: [F('items', 'Cards', 'list', { of: [F('heading', 'Heading', 'text'), F('html', 'Text', 'inline')] })],
    empty: () => ({ items: [{ heading: '', html: '' }, { heading: '', html: '' }] }),
    sample: { items: [{ heading: 'Residents', html: 'Ask your legislator to request an audit.' }, { heading: 'Reporters', html: 'The complete dataset is yours.' }] },
  },
  byline: {
    label: 'Byline strip',
    description: 'The badge, date and author line, placed here instead of under the hero. Edit its text in the header fields.',
    fields: [],
    empty: () => ({}),
    sample: null,
  },
  raw: {
    label: 'Custom HTML',
    description: 'HTML kept exactly as written. Used for legacy pieces the builder has no block for yet; prefer a real block.',
    fields: [F('html', 'HTML', 'code')],
    empty: () => ({ html: '' }),
    sample: null,
  },
};

// Blocks that span the full page width, outside the reading column (the
// serializer closes the white band around them and reopens it after).
const FULL_WIDTH = new Set(['partsnav']);
const fullWidth = (block) => FULL_WIDTH.has(block.type) || (block.type === 'stats' && block.variant === 'band');

// Section-level fields (one section = one h2 and its blocks).
const SECTION_FIELDS = [
  F('heading', 'Heading', 'text'),
  F('anchor', 'Anchor', 'text', { hint: 'the #id the contents list links to; blank = made from the heading' }),
  F('tocLabel', 'Contents label', 'text', { hint: 'shorter wording for the contents list; blank = the heading' }),
  F('eyebrow', 'Eyebrow', 'text', { hint: 'small label above the heading (part headers)' }),
  F('dek', 'Standfirst', 'inline', { hint: 'one sentence under the heading' }),
  F('band', 'Starts a new page band', 'bool', { hint: 'closes the white column and opens a fresh one (multi-part pieces)' }),
  F('bandClasses', 'Extra classes on the band', 'classes', { hint: 'space-separated; migrated per-part styles' }),
  F('classes', 'Wrapper classes around this section', 'classes', { hint: 'space-separated; a migrated page\'s own section wrapper' }),
];

// Header fields: the fixed top of every document.
const HEADER_FIELDS = [
  F('eyebrow', 'Eyebrow', 'text', { hint: 'e.g. Policy Paper, Surveillance investigation' }),
  F('headline', 'Headline', 'text', { hint: 'the h1 on the page; blank = the document title' }),
  F('summary', 'Summary', 'inline', { hint: 'the lead paragraph under the title' }),
  F('ctas', 'Hero buttons', 'list', { of: [F('label', 'Button text', 'text'), F('href', 'Link', 'url'), F('kind', 'Style', 'select', { options: [{ value: 'primary', label: 'Red' }, { value: 'secondary', label: 'Outline' }] }), F('icon', 'Icon', 'select', { options: [{ value: '', label: 'None' }, { value: 'download', label: 'Download arrow' }] })] }),
  F('provenance', 'Hero note', 'inline', { hint: 'small italic line under the buttons' }),
  F('badge', 'Badge', 'text', { hint: 'default Utah Civic Compact' }),
  F('status', 'Status badge', 'text', { hint: 'e.g. Active; blank for none' }),
  F('date', 'Date line', 'text', { hint: 'as it should read, e.g. September 9, 2026' }),
  F('authorTitle', 'Author title', 'text', { hint: 'e.g. Director of Policy' }),
  F('metaLinkLabel', 'Byline link text', 'text', { hint: 'e.g. Download PDF; blank for no link' }),
  F('metaLinkHref', 'Byline link', 'file'),
  F('note', 'Note under the byline', 'inline', { hint: 'italic provenance paragraph' }),
  F('toc', 'Contents list', 'select', { options: [{ value: 'auto', label: 'From the section headings' }, { value: 'none', label: 'None' }] }),
  F('frame', 'Page frame', 'frame', { hint: 'wrapper classes around the column, outer to inner; blank = the standard doc-body > doc-inner. A converted page keeps its own so its page CSS still applies.' }),
];

function emptyHeader() {
  return { layout: 'hero', eyebrow: '', headline: '', summary: '', ctas: [], provenance: '', badge: 'Utah Civic Compact', status: '', date: '', authorTitle: '', metaLinkLabel: '', metaLinkHref: '', note: '', toc: 'auto', frame: [] };
}

let counter = 0;
function newId(prefix = 'b') {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

function newBlock(type) {
  const def = BLOCK_TYPES[type];
  if (!def) throw new Error(`Unknown block type "${type}"`);
  return { id: newId(), type, ...def.empty() };
}

function newSection(heading = '') {
  return { id: newId('s'), heading, anchor: '', tocLabel: '', eyebrow: '', dek: '', band: false, bandClasses: [], classes: [], blocks: [] };
}

function emptyBody() {
  return { v: VERSION, header: emptyHeader(), sections: [] };
}

// slugify(text) → anchor id; matches the hand-written anchors' style.
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/^[ivxlc]+\.\s+/, '') // "III. Summary" → "summary"
    .replace(/^appendix\s+([a-z])\.\s*/, 'appendix-$1-')
    .replace(/&amp;|&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

// validateBody(body) → { ok, errors[] , body } with unknown types/fields
// reported and defaults filled in. Never throws; the save action decides.
function validateBody(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Body must be an object'], body: emptyBody() };
  const body = { v: VERSION, header: { ...emptyHeader(), ...(input.header || {}) }, sections: [] };
  if (!['hero', 'none'].includes(body.header.layout)) body.header.layout = 'hero';
  if (!['auto', 'none'].includes(body.header.toc)) body.header.toc = 'auto';
  if (!Array.isArray(body.header.ctas)) body.header.ctas = [];
  body.header.frame = Array.isArray(body.header.frame) ? body.header.frame.map(String).filter(Boolean) : [];
  for (const [i, s] of (Array.isArray(input.sections) ? input.sections : []).entries()) {
    if (!s || typeof s !== 'object') { errors.push(`Section ${i + 1} is not an object`); continue; }
    const section = { id: String(s.id || newId('s')), heading: String(s.heading || ''), anchor: String(s.anchor || ''), tocLabel: String(s.tocLabel || ''), eyebrow: String(s.eyebrow || ''), dek: String(s.dek || ''), band: Boolean(s.band), bandClasses: Array.isArray(s.bandClasses) ? s.bandClasses.map(String) : [], classes: Array.isArray(s.classes) ? s.classes.map(String) : [], blocks: [] };
    for (const [j, b] of (Array.isArray(s.blocks) ? s.blocks : []).entries()) {
      if (!b || typeof b !== 'object' || !BLOCK_TYPES[b.type]) { errors.push(`Section ${i + 1}, block ${j + 1}: unknown type "${b && b.type}"`); continue; }
      const def = BLOCK_TYPES[b.type];
      const block = { ...def.empty(), ...b, id: String(b.id || newId()), type: b.type };
      if (def.variants && !def.variants.some(v => v.value === block.variant)) block.variant = def.variants[0].value;
      if (block.classes && !Array.isArray(block.classes)) delete block.classes;
      section.blocks.push(block);
    }
    body.sections.push(section);
  }
  return { ok: errors.length === 0, errors, body };
}

export {
  VERSION, BLOCK_TYPES, SECTION_FIELDS, HEADER_FIELDS, CALLOUT_VARIANTS, CALLOUT_LEGACY, TABLE_VARIANTS, STATS_VARIANTS, SOURCES_VARIANTS, CTA_VARIANTS, CTA_ICONS,
  emptyBody, emptyHeader, newBlock, newSection, newId, slugify, validateBody, fullWidth,
};
