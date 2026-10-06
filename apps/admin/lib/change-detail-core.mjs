// "What changed" on Publish & Status (docs/systems/admin.md "What changed").
// PURE: two states of one thing in, plain-English lines out. lib/change-detail.js
// supplies the states (the revision snapshot from just before the first
// unpublished save, and the current database row) and the field labels.
// Tested in test/change-detail-core.test.mjs.

const MAX = 90;

// show(value) → a short, readable rendering of any stored value.
export function show(v) {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return 'structured value';
  const s = String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '(blank)';
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s;
}

const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const words = (html) => String(html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

// diffFields(before, after, labels, { only, skip }) → [{ label, before, after }]
// Scalar fields only; arrays are summarised by count.
export function diffFields(before = {}, after = {}, labels = {}, { only, skip = [] } = {}) {
  const keys = only || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const out = [];
  for (const k of keys) {
    if (skip.includes(k)) continue;
    const a = before?.[k], b = after?.[k];
    if (same(a, b)) continue;
    if (Array.isArray(a) || Array.isArray(b)) {
      out.push({ label: labels[k] || k, before: show(a || []), after: show(b || []) });
      continue;
    }
    out.push({ label: labels[k] || k, before: show(a), after: show(b) });
  }
  return out;
}

const ID_KEYS = ['slug', 'youtube_id', 'url', 'name', 'headline', 'title', 'outlet'];
export function keyOf(item) {
  for (const k of ID_KEYS) if (item && item[k]) return `${k}:${String(item[k]).trim().toLowerCase()}`;
  return `json:${JSON.stringify(item)}`;
}
export function labelOf(item) {
  for (const k of ['name', 'title', 'headline', 'heading', 'label', 'outlet', 'slug', 'url']) if (item && item[k]) return show(item[k]);
  return '(untitled)';
}

// diffList(before[], after[], labels) → lines describing a list editor's change:
// added / removed / edited (with field detail) / reordered. Items are matched
// by their natural key (slug, YouTube id, url, name…), so editing a field of an
// item reads as "edited", not "removed + added" — unless that key itself was
// edited, which honestly IS a different item to the site.
export function diffList(before = [], after = [], labels = {}) {
  const lines = [];
  const b = new Map(before.map((it) => [keyOf(it), it]));
  const a = new Map(after.map((it) => [keyOf(it), it]));
  for (const [k, it] of a) if (!b.has(k)) lines.push({ kind: 'added', text: `Added: ${labelOf(it)}` });
  for (const [k, it] of b) if (!a.has(k)) lines.push({ kind: 'removed', text: `Removed: ${labelOf(it)}` });
  for (const [k, it] of a) {
    if (!b.has(k)) continue;
    const fields = diffFields(b.get(k), it, labels);
    if (fields.length) lines.push({ kind: 'changed', text: `Edited: ${labelOf(it)}`, fields });
  }
  // Reordered = the items present in both lists are in a different order.
  const kept = (arr, other) => arr.map(keyOf).filter((k) => other.has(k)).join('\n');
  if (kept(before, a) !== kept(after, b)) {
    lines.push({ kind: 'moved', text: `Order changed — now: ${after.map(labelOf).join(' · ')}` });
  }
  return lines;
}

// Menus: flatten to "Header › About Us › Team & Bios" → href and compare.
function flattenNav(nav) {
  const out = new Map();
  if (!nav || typeof nav !== 'object') return out;
  (nav.header || []).forEach((it) => {
    if (it.children) it.children.forEach((c) => out.set(`Header › ${it.label} › ${c.label}`, c.href));
    else out.set(`Header › ${it.label}`, it.href + (it.style ? ` (${it.style} button)` : ''));
  });
  ((nav.footer || {}).columns || []).forEach((col) => (col.links || []).forEach((l) => out.set(`Footer › ${col.heading} › ${l.label}`, l.href)));
  ((nav.footer || {}).bottom || []).forEach((l) => out.set(`Footer bottom › ${l.label}`, l.href));
  return out;
}
export function diffNavigation(before, after, defaults) {
  const b = flattenNav(before || defaults), a = flattenNav(after || defaults);
  const lines = [];
  for (const [k, href] of a) if (!b.has(k)) lines.push({ kind: 'added', text: `Added: ${k} → ${href}` });
  for (const [k] of b) if (!a.has(k)) lines.push({ kind: 'removed', text: `Removed: ${k}` });
  for (const [k, href] of a) if (b.has(k) && b.get(k) !== href) lines.push({ kind: 'changed', text: `Edited: ${k}`, fields: [{ label: 'Links to', before: b.get(k), after: href }] });
  if (!lines.length && JSON.stringify([...b.keys()]) !== JSON.stringify([...a.keys()])) lines.push({ kind: 'moved', text: 'Order changed' });
  return lines;
}

// diffDocument(before, after) → lines for one Document (null before = new).
const DOC_LABELS = {
  title: 'Title', slug: 'Web address', category: 'Category', author: 'Author', status: 'Status',
  metaTitle: 'Search title', metaDescription: 'Search description', ogTitle: 'Share title',
  ogDescription: 'Share description', ogImage: 'Share image', canonicalUrl: 'Canonical URL',
  noindex: 'Hidden from search', sitemapPriority: 'Sitemap priority', sortOrder: 'Sort order', templateKey: 'Template',
};
export function diffDocument(before, after) {
  if (!before && after) return [{ kind: 'added', text: `New document: ${show(after.title)} (${after.status || 'draft'})` }];
  if (before && !after) return [{ kind: 'removed', text: `Deleted document: ${show(before.title)}` }];
  const lines = [];
  const fields = diffFields(before, after, DOC_LABELS, { only: Object.keys(DOC_LABELS) });
  if (fields.length) lines.push({ kind: 'changed', text: 'Details', fields });
  if (!same(before.bodyHtmlRaw, after.bodyHtmlRaw)) {
    const d = words(after.bodyHtmlRaw) - words(before.bodyHtmlRaw);
    lines.push({ kind: 'changed', text: `Text edited (${d === 0 ? 'same length' : `${d > 0 ? '+' : ''}${d} words`}, now ${words(after.bodyHtmlRaw)})` });
  }
  if (!same(before.pageCss, after.pageCss)) lines.push({ kind: 'changed', text: 'Page styling (CSS) edited' });
  if (!same(before.overrides, after.overrides)) lines.push({ kind: 'changed', text: `Style overrides edited (${(after.overrides || []).length} now)` });
  return lines;
}
