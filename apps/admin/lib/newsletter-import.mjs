// Upload → newsletter blocks (docs/systems/newsletters.md "Import a file").
// A .docx or Markdown file first becomes HTML through the Documents editor's
// converter (lib/convert-upload.mjs: mammoth / marked, deterministic), then
// this turns that HTML into the composer's block list: heading, text
// (the renderer's own markdown subset), button, image, quote, divider.
// Nothing here is trusted — the blocks land in the composer, and every
// string is escaped by the renderer; normalizeBlocks drops what it cannot
// use (an image with no address, an empty heading) on save.
//
// Mapping (top-level flow of the fragment):
//   h1                  → headline when the composer has none, else heading
//   h2                  → heading block
//   h3–h6               → "## text" line inside the running text block
//   p, ul/ol            → running text block (paragraphs blank-line separated,
//                         list items "- item"; **bold**, *italic*, [text](url))
//   p that is ONLY a link → button block
//   img (anywhere)      → image block (data: URLs → empty address, awaiting an
//                         upload in the composer)
//   blockquote          → quote block (a last line starting "—"/"--" is the cite)
//   hr                  → divider
//   table               → text block, one "- cell | cell" line per row
//   anything else       → its text, as a paragraph
import { textContent } from 'domutils';
import htmlIngest from '@uccsite/html-ingest';
import { safeUrl } from '@uccsite/newsletter/render';

const { parseFragmentTree } = htmlIngest;

const isEl = (n) => n && n.type === 'tag';
const tag = (n) => (isEl(n) ? n.name.toLowerCase() : '');
const elKids = (n) => (n.children || []).filter(isEl);
const squash = (s) => String(s).replace(/[ \t\r\n ]+/g, ' ');
const plain = (n) => squash(textContent(n)).trim();

// Inline HTML → the renderer's markdown: **bold**, *italic*, [text](url).
// Images inside running text are lifted out (`images`) as their own blocks.
function inlineMd(node, images) {
  let out = '';
  for (const c of node.children || []) {
    if (c.type === 'text') { out += squash(c.data); continue; }
    if (!isEl(c)) continue;
    const t = tag(c);
    if (t === 'img') { images.push(imageBlock(c)); continue; }
    if (t === 'br') { out += '\n'; continue; }
    const inner = inlineMd(c, images);
    if (!inner.trim()) continue;
    if (t === 'strong' || t === 'b') out += `**${inner.trim()}**`;
    else if (t === 'em' || t === 'i') out += `*${inner.trim()}*`;
    else if (t === 'a') {
      const href = safeUrl(c.attribs?.href || '');
      out += href ? `[${inner.trim()}](${href})` : inner;
    } else out += inner;
  }
  return out;
}

function imageBlock(el) {
  const a = el.attribs || {};
  return { type: 'image', url: safeUrl(a.src || '', { mailto: false }), alt: squash(a.alt || '').trim(), link: '', caption: '' };
}

// A paragraph that is nothing but one link → a button.
function soleLink(el) {
  const kids = (el.children || []).filter((c) => !(c.type === 'text' && !c.data.trim()));
  if (kids.length !== 1 || tag(kids[0]) !== 'a') return null;
  const url = safeUrl(kids[0].attribs?.href || '');
  const label = plain(kids[0]);
  return url && label ? { type: 'button', label, url, align: 'center' } : null;
}

function listLines(el) {
  const lines = [];
  for (const li of elKids(el).filter((c) => tag(c) === 'li')) {
    const images = [];
    const nested = elKids(li).filter((c) => tag(c) === 'ul' || tag(c) === 'ol');
    const shallow = { children: (li.children || []).filter((c) => !nested.includes(c)) };
    const t = inlineMd(shallow, images).replace(/\s*\n\s*/g, ' ').trim();
    if (t) lines.push(`- ${t}`);
    for (const n of nested) lines.push(...listLines(n)); // flattened: the renderer has one bullet level
  }
  return lines;
}

function quoteBlock(el) {
  const paras = elKids(el).length ? elKids(el) : [el];
  const lines = paras.map((p) => inlineMd(p, []).replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  let cite = '';
  if (lines.length > 1 && /^(—|–|--)\s*/.test(lines.at(-1))) cite = lines.pop().replace(/^(—|–|--)\s*/, '');
  const text = lines.join(' ').trim();
  return text ? { type: 'quote', text, cite } : null;
}

function tableLines(el) {
  const rows = [];
  const walk = (n) => { for (const c of elKids(n)) { if (tag(c) === 'tr') rows.push(c); else walk(c); } };
  walk(el);
  return rows.map((tr) => `- ${elKids(tr).map(plain).filter(Boolean).join(' | ')}`).filter((l) => l !== '- ');
}

// htmlToBlocks(html, { headline }) → { blocks, headline, notes[] }.
// `headline` in: what the composer already has (an h1 fills it only when empty).
export function htmlToBlocks(html, { headline = '' } = {}) {
  const root = parseFragmentTree(String(html || ''));
  const blocks = [];
  const notes = [];
  let text = []; // pending running-text paragraphs
  let images = 0;
  const flush = () => { if (text.length) { blocks.push({ type: 'text', markdown: text.join('\n\n') }); text = []; } };
  const lift = (imgs) => { for (const img of imgs) { flush(); blocks.push(img); images += 1; } };
  const para = (md) => { const t = md.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ').trim(); if (t) text.push(t); };

  const visit = (el) => {
    const t = tag(el);
    switch (t) {
      case 'h1': {
        const s = plain(el);
        if (!s) break;
        if (!headline) headline = s; else { flush(); blocks.push({ type: 'heading', text: s }); }
        break;
      }
      case 'h2': { const s = plain(el); if (s) { flush(); blocks.push({ type: 'heading', text: s }); } break; }
      case 'h3': case 'h4': case 'h5': case 'h6': { const s = plain(el); if (s) para(`## ${s}`); break; }
      case 'p': {
        const btn = soleLink(el);
        if (btn) { flush(); blocks.push(btn); break; }
        const imgs = [];
        const md = inlineMd(el, imgs);
        para(md);
        lift(imgs);
        break;
      }
      case 'ul': case 'ol': { const lines = listLines(el); if (lines.length) para(lines.join('\n')); break; }
      case 'blockquote': { const q = quoteBlock(el); if (q) { flush(); blocks.push(q); } break; }
      case 'hr': flush(); blocks.push({ type: 'divider' }); break;
      case 'img': lift([imageBlock(el)]); break;
      case 'figure': {
        const img = elKids(el).find((c) => tag(c) === 'img') || null;
        const cap = elKids(el).find((c) => tag(c) === 'figcaption');
        if (img) { const b = imageBlock(img); if (cap) b.caption = plain(cap); lift([b]); }
        else for (const c of elKids(el)) visit(c);
        break;
      }
      case 'table': { const lines = tableLines(el); if (lines.length) para(lines.join('\n')); notes.push('a table became a bulleted list (emails have no tables)'); break; }
      case 'pre': { const s = String(textContent(el)).trim(); if (s) para(s); break; }
      case 'div': case 'section': case 'article': case 'main': case 'header': case 'footer': case 'body':
        for (const c of elKids(el)) visit(c);
        break;
      case 'script': case 'style': case 'nav': case 'aside': break;
      default: { const s = plain(el); if (s) para(s); }
    }
  };
  for (const c of root.children || []) {
    if (isEl(c)) visit(c);
    else if (c.type === 'text' && c.data.trim()) para(squash(c.data));
  }
  flush();
  if (images) notes.push(`${images} image${images === 1 ? '' : 's'} — each needs an upload (or an address) in its block${blocks.some((b) => b.type === 'image' && !b.url) ? '; the ones from the file arrive without one' : ''}`);
  return { blocks, headline, notes: [...new Set(notes)] };
}
