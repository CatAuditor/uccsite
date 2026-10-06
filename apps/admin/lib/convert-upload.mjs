// Upload conversion for the Documents editor (docs/systems/documents.md
// "Upload a file"): a .docx (Word, Google Docs, Claude Docs export) or a
// Markdown file becomes the semantic HTML fragment the ingest expects. Both
// converters are deterministic libraries, no AI. The result is NOT trusted:
// it lands in the Body HTML box and goes through the normal ingest on save.
import { marked } from 'marked';
import mammoth from 'mammoth';

// Word/Google Docs paragraph styles mammoth does not map by default.
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
];

const IMAGE_PLACEHOLDER = (n) => `<p><strong>[Image ${n} omitted: upload it on the Media page and insert it here with alt text]</strong></p>`;

// finishHtml(html) → { html, imagesOmitted }. Embedded images arrive as data:
// URLs, which the ingest rejects, so each becomes a visible placeholder the
// editor replaces. Block closers get a newline so the textarea is readable.
export function finishHtml(html) {
  let imagesOmitted = 0;
  const out = String(html || '')
    .replace(/<img\b[^>]*>/gi, () => IMAGE_PLACEHOLDER(++imagesOmitted))
    .replace(/<\/(p|h[1-6]|li|ul|ol|table|thead|tbody|tr|blockquote|figure|pre)>(?!\n)/g, '</$1>\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { html: out, imagesOmitted };
}

// markdownToHtml(text) → { html, imagesOmitted }. GFM (tables, strikethrough).
// Raw HTML in the markdown passes through; the ingest sanitizes it on save.
export function markdownToHtml(text) {
  return finishHtml(marked.parse(String(text || ''), { gfm: true, breaks: false, async: false }));
}

// docxToHtml(buffer) → { html, imagesOmitted, warnings[] }.
export async function docxToHtml(buffer) {
  const res = await mammoth.convertToHtml({ buffer }, { styleMap: STYLE_MAP });
  const warnings = [...new Set(res.messages.filter(m => m.type === 'warning').map(m => m.message))];
  return { ...finishHtml(res.value), warnings };
}

export const UPLOAD_KINDS = {
  html: /\.html?$/i,
  docx: /\.docx$/i,
  markdown: /\.(md|markdown|txt)$/i,
};

export function uploadKind(name) {
  for (const [kind, re] of Object.entries(UPLOAD_KINDS)) if (re.test(String(name || ''))) return kind;
  return null;
}
