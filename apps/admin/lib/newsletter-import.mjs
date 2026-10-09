// Upload → newsletter blocks (docs/systems/newsletters.md "Import a file").
// A .docx, Markdown or .html file first becomes HTML through the Documents
// editor's converter (lib/convert-upload.mjs: mammoth / marked,
// deterministic). This keeps that HTML as RICH blocks — the document's own
// structure (nested and numbered lists, tables, code, underline, strike,
// footnotes, blank paragraphs) all survive and the renderer styles every
// tag inline in the house look — with two exceptions:
//   • images lift out as Image blocks (a .docx embeds them as data: URLs,
//     which an email cannot carry — the editor uploads each in its block);
//     a paragraph/figure that is only an image becomes the block in place,
//     an image inside running text comes right after its paragraph;
//   • the first h1 fills an EMPTY headline (the letterhead band).
// Everything else is sanitizeRich'd: an allowlist of tags, href/src/alt/
// colspan/rowspan/start only, http(s)/mailto links. The same sanitizer runs
// again on every save (lib/newsletters.js), so a rich block that reaches the
// database never carries a script, a style or an event handler.
import sanitizeHtml from 'sanitize-html';
import domSerializer from 'dom-serializer';
import { textContent, removeElement } from 'domutils';
import htmlIngest from '@uccsite/html-ingest';
import { safeUrl, RICH_TAGS } from '@uccsite/newsletter/render';

const { parseFragmentTree } = htmlIngest;
const serialize = domSerializer.default || domSerializer;

const isEl = (n) => n && n.type === 'tag';
const tag = (n) => (isEl(n) ? n.name.toLowerCase() : '');
const elKids = (n) => (n.children || []).filter(isEl);
const squash = (s) => String(s).replace(/[ \t\r\n ]+/g, ' ');
const plain = (n) => squash(textContent(n)).trim();
const findAll = (n, pred, out = []) => { for (const c of elKids(n)) { if (pred(c)) out.push(c); findAll(c, pred, out); } return out; };

// sanitizeRich(html) → the HTML a rich block may hold.
export function sanitizeRich(html) {
  const src = String(html || '')
    // GFM task lists: marked emits a disabled checkbox; keep it as a glyph.
    .replace(/<input\b[^>]*type="checkbox"[^>]*>/gi, (m) => (/\bchecked\b/i.test(m) ? '☑' : '☐'));
  return sanitizeHtml(src, {
    allowedTags: RICH_TAGS.filter((t) => t !== 'img'),
    allowedAttributes: { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    // a disallowed tag (span, div, figure, input…) drops but its text stays
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'nav', 'aside', 'head', 'title'],
  }).replace(/\n{3,}/g, '\n\n').trim();
}

function imageBlock(el) {
  const a = el.attribs || {};
  return { type: 'image', url: safeUrl(a.src || '', { mailto: false }), alt: squash(a.alt || '').trim(), link: '', caption: '' };
}

// A top-level node that is nothing but one image (p/figure around an img,
// optionally a figcaption) → that image block, else null.
function soleImage(el) {
  const t = tag(el);
  if (t === 'img') return imageBlock(el);
  if (t !== 'p' && t !== 'figure') return null;
  const kids = (el.children || []).filter((c) => !(c.type === 'text' && !c.data.trim()));
  const imgs = kids.filter((c) => tag(c) === 'img');
  const cap = kids.find((c) => tag(c) === 'figcaption');
  if (imgs.length !== 1 || kids.length !== imgs.length + (cap ? 1 : 0)) return null;
  const b = imageBlock(imgs[0]);
  if (cap) b.caption = plain(cap);
  return b;
}

// htmlToBlocks(html, { headline }) → { blocks, headline, notes[] }.
// `headline` in: what the composer already has (an h1 fills it only when empty).
export function htmlToBlocks(html, { headline = '' } = {}) {
  const root = parseFragmentTree(String(html || ''));
  // Unwrap page-level wrappers (an .html upload, a Google Docs export body).
  let top = root.children || [];
  while (top.filter(isEl).length === 1 && ['html', 'body', 'div', 'main', 'article', 'section'].includes(tag(top.find(isEl))) && !top.some((c) => c.type === 'text' && c.data.trim())) {
    const w = top.find(isEl);
    if (tag(w) === 'html') { const body = elKids(w).find((c) => tag(c) === 'body'); top = body ? body.children || [] : w.children || []; }
    else top = w.children || [];
  }

  const blocks = [];
  const notes = [];
  let images = 0;
  let chunk = [];
  const flush = () => {
    if (!chunk.length) return;
    const h = sanitizeRich(serialize(chunk, { encodeEntities: 'utf8' }));
    if (h) blocks.push({ type: 'rich', html: h });
    chunk = [];
  };
  const pushImage = (b) => { flush(); blocks.push(b); images += 1; };

  for (const node of top) {
    if (node.type === 'text') { if (node.data.trim()) chunk.push(node); continue; }
    if (!isEl(node)) continue;
    const t = tag(node);
    if (t === 'script' || t === 'style' || t === 'nav' || t === 'aside') continue;
    if (t === 'h1' && !headline) { const s = plain(node); if (s) { headline = s; continue; } }
    const sole = soleImage(node);
    if (sole) { pushImage(sole); continue; }
    // Images inside running text: lifted out, placed right after the node.
    const inner = findAll(node, (c) => tag(c) === 'img');
    const lifted = inner.map(imageBlock);
    for (const img of inner) removeElement(img);
    chunk.push(node);
    if (lifted.length) { flush(); for (const b of lifted) pushImage(b); }
  }
  flush();

  if (images) notes.push(`${images} image${images === 1 ? '' : 's'} — each needs an upload (or an address) in its block${blocks.some((b) => b.type === 'image' && !b.url) ? '; the ones from the file arrive without one' : ''}`);
  return { blocks, headline, notes };
}
