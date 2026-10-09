// Newsletter renderer (docs/systems/newsletters.md). A newsletter is a
// subject + a list of BLOCKS + a THEME; this turns them into the table-based,
// inline-styled HTML that email clients render consistently, plus a plain-text
// twin. Pure and dependency-free: the admin's live preview (browser), the
// admin server (freeze at request time, test send) and the send Lambda all
// import THIS file, so what the reviewer approves is byte-for-byte what goes
// out.
//
// Every string an author types is escaped first; links and image sources are
// allowed only with http(s): (mailto: for links). The per-recipient
// unsubscribe link is the literal token {{unsubscribe_url}} — the sender
// substitutes it; a preview gets '#'.
//
// Dark mode: the HTML carries `color-scheme: light dark` and a
// `@media (prefers-color-scheme: dark)` block (plus Outlook's [data-ogsc]
// twins). mode 'auto' = what is sent; 'dark' / 'light' are preview emulations
// (dark rules applied unconditionally / omitted).

export const ORG_NAME = 'Utah Civic Compact';
export const FROM_EMAIL = 'hello@utahciviccompact.org';
export const UNSUBSCRIBE_TOKEN = '{{unsubscribe_url}}';
// The letterhead: the site's logo mark (the one the site shows on navy — the
// header over the hero, the footer) beside the org name, linking home. The
// asset is served by the live site, which is what every email client loads
// it from; the admin preview shows the same file.
export const SITE_URL = 'https://utahciviccompact.org';
export const LOGO_URL = `${SITE_URL}/assets/logo-icon-dark.png`;

// 'rich' = a document's own HTML (an imported .docx/.md/.html, or pasted):
// nested and numbered lists, tables, code, underline, footnotes and blank
// paragraphs survive, and renderEmail styles every tag inline in the house
// look (styleRich). The admin sanitizes the HTML server-side on import and
// on save (lib/newsletter-import.mjs sanitizeRich); this file only styles.
export const BLOCK_TYPES = ['heading', 'text', 'rich', 'button', 'image', 'quote', 'divider'];
// The site's own stacks (css/styles.css --font-sans / --font-serif). Inter
// is not embedded — email clients fall through to their system sans, which
// is what the site does too where Inter is missing.
export const FONTS = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  serif: "'Playfair Display', Georgia, 'Times New Roman', serif",
};
// Defaults copy the live site (css/styles.css :root): navy bands, red
// accent, cream page, sans type. `eyebrow` is an optional small label above
// the headline — the org name itself is always in the letterhead, so an
// eyebrow that only repeats it is not drawn.
export const DEFAULT_THEME = {
  accent: '#1b2f4e',     // --navy: header/footer bands, headings, buttons
  highlight: '#e74c3c',  // --red-light: eyebrow, quote rule, headings + links on dark
  font: 'sans',
  eyebrow: '',
  footer: 'Utah Civic Compact · Salt Lake City, UT\nUtah Civic Compact is a 501(c)(4) social welfare organization. Contributions are not tax-deductible as charitable donations.\nYou are getting this because you signed up at utahciviccompact.org.',
};
export const MAX_BLOCKS = 60;
// 'raw' is not in BLOCK_TYPES (no "Add" button): the composer's "Ignore all
// style — raw HTML" box stores the author's whole email as one raw block, and
// renderEmail then sends that HTML as typed plus an unsubscribe link only.
const LIMITS = { heading: 300, text: 20000, label: 120, url: 2000, alt: 300, cite: 200, quote: 2000, caption: 300, raw: 200000, rich: 200000 };

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// safeUrl(url, { mailto }) → the url when its scheme is allowed, else ''.
export function safeUrl(url, { mailto = true } = {}) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/^https?:\/\/[^\s<>"']+$/i.test(s)) return s;
  if (mailto && /^mailto:[^\s<>"']+$/i.test(s)) return s;
  return '';
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const clip = (s, n) => String(s ?? '').slice(0, n);

// normalizeTheme(raw) → a complete theme with every value validated.
export function normalizeTheme(raw = {}) {
  const t = raw && typeof raw === 'object' ? raw : {};
  return {
    accent: HEX_RE.test(t.accent || '') ? t.accent.toLowerCase() : DEFAULT_THEME.accent,
    highlight: HEX_RE.test(t.highlight || '') ? t.highlight.toLowerCase() : DEFAULT_THEME.highlight,
    font: t.font in FONTS ? t.font : DEFAULT_THEME.font,
    eyebrow: clip(t.eyebrow ?? DEFAULT_THEME.eyebrow, 80),
    footer: clip(t.footer ?? DEFAULT_THEME.footer, 600),
  };
}

// normalizeBlocks(raw) → clean blocks (unknown types and empty blocks are
// dropped, strings clipped, URLs filtered). Throws on more than MAX_BLOCKS.
export function normalizeBlocks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_BLOCKS) throw new Error(`At most ${MAX_BLOCKS} blocks per email`);
  const out = [];
  for (const b of list) {
    if (!b || typeof b !== 'object' || !(BLOCK_TYPES.includes(b.type) || b.type === 'raw')) continue;
    switch (b.type) {
      case 'raw': { const html = clip(b.html, LIMITS.raw).trim(); if (html) out.push({ type: 'raw', html }); break; }
      case 'rich': { const html = clip(b.html, LIMITS.rich).trim(); if (html) out.push({ type: 'rich', html }); break; }
      case 'heading': { const text = clip(b.text, LIMITS.heading).trim(); if (text) out.push({ type: 'heading', text }); break; }
      case 'text': { const markdown = clip(b.markdown, LIMITS.text).replace(/\r\n?/g, '\n').trim(); if (markdown) out.push({ type: 'text', markdown }); break; }
      case 'button': {
        const label = clip(b.label, LIMITS.label).trim(); const url = safeUrl(clip(b.url, LIMITS.url));
        if (label && url) out.push({ type: 'button', label, url, align: b.align === 'left' ? 'left' : 'center' });
        break;
      }
      case 'image': {
        const url = safeUrl(clip(b.url, LIMITS.url), { mailto: false }); const alt = clip(b.alt, LIMITS.alt).trim();
        const link = safeUrl(clip(b.link, LIMITS.url), { mailto: false }); const caption = clip(b.caption, LIMITS.caption).trim();
        if (url) out.push({ type: 'image', url, alt, ...(link ? { link } : {}), ...(caption ? { caption } : {}) });
        break;
      }
      case 'quote': { const text = clip(b.text, LIMITS.quote).trim(); const cite = clip(b.cite, LIMITS.cite).trim(); if (text) out.push({ type: 'quote', text, ...(cite ? { cite } : {}) }); break; }
      case 'divider': out.push({ type: 'divider' }); break;
      default: break;
    }
  }
  return out;
}

// ── inline markdown (escape FIRST; nothing typed survives as markup) ──────
// **bold**, *italic*, [text](https://…) / [text](mailto:…). Used by text,
// quote and caption content. `styles.link` is the inline style for <a>.
function inline(src, linkStyle) {
  return escapeHtml(src)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (m, text, href) => {
      // href was escaped above; un-escape &amp; for the scheme check only.
      const url = safeUrl(href.replace(/&amp;/g, '&'));
      return url ? `<a href="${escapeHtml(url)}" class="em-link" style="${linkStyle}">${text}</a>` : text;
    });
}

function inlineText(src) {
  return String(src)
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (m, text, href) => (safeUrl(href) ? `${text} (${href})` : text));
}

// Text block markdown: paragraphs (blank-line separated), "- " bullets,
// "## " sub-headings. Lines inside a paragraph join with a space.
function textBlockHtml(markdown, s) {
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) { out.push(`<p class="em-text" style="${s.p}">${inline(para.join(' '), s.link)}</p>`); para = []; } };
  const flushList = () => {
    if (list.length) {
      out.push(`<ul style="${s.ul}">${list.map((li) => `<li class="em-text" style="${s.li}">${inline(li, s.link)}</li>`).join('')}</ul>`);
      list = [];
    }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<p class="em-h" style="${s.sub}">${inline(h[1], s.link)}</p>`); continue; }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) { flushPara(); list.push(li[1]); continue; }
    if (!line) { flushPara(); flushList(); continue; }
    if (list.length) flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}

function textBlockText(markdown) {
  const out = [];
  let para = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) { if (para.length) { out.push(inlineText(para.join(' '))); para = []; } out.push('', inlineText(h[1]).toUpperCase()); continue; }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) { if (para.length) { out.push(inlineText(para.join(' '))); para = []; } out.push(`  - ${inlineText(li[1])}`); continue; }
    if (!line) { if (para.length) { out.push(inlineText(para.join(' ')), ''); para = []; } continue; }
    para.push(line);
  }
  if (para.length) out.push(inlineText(para.join(' ')));
  return out.join('\n');
}

// styleRich(html, s, light) → the document HTML with the house look applied
// INLINE on every opening tag (email clients need inline styles). The HTML
// is the sanitizer's output (tags from RICH_TAGS, attributes href/src/alt/
// colspan/rowspan/start only), so a regex over opening tags is enough; any
// class/style an unsanitized preview carries is simply shadowed. An empty
// paragraph (a blank line in the document) gets &nbsp; so its height
// survives margin collapsing.
export const RICH_TAGS = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sup', 'sub', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'img'];
function styleRich(html, s, light) {
  const mono = "SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
  const cell = `padding:8px 10px;border-bottom:1px solid ${light.rule};vertical-align:top;font-size:15px;line-height:1.5;color:${light.text};`;
  const rules = {
    p: ['em-text', s.p],
    h1: ['em-h', s.h2], h2: ['em-h', s.h2],
    h3: ['em-h', s.sub], h4: ['em-h', s.sub], h5: ['em-h', s.sub], h6: ['em-h', s.sub],
    ul: ['', s.ul], ol: ['', s.ul],
    li: ['em-text', s.li],
    blockquote: ['em-quote', s.quote],
    pre: ['em-quote', `margin:0 0 20px;padding:14px 16px;background:${light.bg};color:${light.text};font-family:${mono};font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;border-radius:4px;`],
    code: ['', `font-family:${mono};font-size:0.95em;`],
    a: ['em-link', s.link],
    hr: ['em-rule', `border:0;border-top:1px solid ${light.rule};margin:8px 0 28px;`],
    table: ['', 'border-collapse:collapse;width:100%;margin:0 0 24px;'],
    th: ['em-text', `${cell}font-weight:700;text-align:left;`],
    td: ['em-text', cell],
    caption: ['em-muted', s.caption],
    img: ['', 'max-width:100%;height:auto;display:block;margin:0 auto 20px;'],
  };
  let liDepth = 0; // a list opened inside an item is nested: tighter margins
  return String(html)
    .replace(/<(\/?)([a-z][a-z0-9]*)(\s[^>]*)?>/gi, (m, close, name, attrs = '') => {
      const t = name.toLowerCase();
      if (t === 'li') { liDepth += close ? -1 : 1; if (liDepth < 0) liDepth = 0; }
      if (close || !rules[t]) return m;
      let [cls, style] = rules[t];
      if ((t === 'ul' || t === 'ol') && liDepth > 0) style = 'margin:6px 0 0;padding-left:24px;';
      return `<${t}${attrs}${cls ? ` class="${cls}"` : ''} style="${style}">`;
    })
    .replace(/<p([^>]*)>\s*<\/p>/gi, '<p$1>&nbsp;</p>');
}

// htmlToText(html) → a plain-text reading of an HTML fragment (rich and raw
// blocks): block closers become blank lines, tags go, entities resolve.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
export function htmlToText(src) {
  return String(src || '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote|pre)>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ENT[e])
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/ \|\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// fromHeader(name) → the From header: '"Jarom Gillins from Utah Civic Compact" <hello@…>'.
// The address never changes (IAM pins ses:FromAddress); only the display
// name carries the author. Characters outside letters/space/.'- are dropped.
export function fromHeader(name) {
  const clean = String(name || '').replace(/[^\p{L}\p{M} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const display = clean && clean.toLowerCase() !== ORG_NAME.toLowerCase() ? `${clean} from ${ORG_NAME}` : ORG_NAME;
  return `"${display}" <${FROM_EMAIL}>`;
}

// renderEmail({ subject, preheader, headline, blocks, theme }, { mode }) → { html, text }
// mode: 'auto' (sent) | 'dark' | 'light' (preview emulations).
// tagLinks(html, siteUrl, campaign) → html with utm_source/medium/campaign
// appended to every link INTO the site (never the unsubscribe token, never
// /api/ links, never a link that already carries utm_). Attribution without
// per-recipient tracking: the parameters are the same for every copy.
export function tagLinks(html, siteUrl, campaign) {
  if (!siteUrl || !campaign) return html;
  const base = siteUrl.replace(/\/$/, '');
  const utm = `utm_source=newsletter&utm_medium=email&utm_campaign=${encodeURIComponent(campaign)}`;
  return html.replace(/href="([^"]+)"/g, (m, href) => {
    if (!(href === base || href.startsWith(`${base}/`)) || href.includes('/api/') || /[?&]utm_/.test(href)) return m;
    const [path, hash = ''] = href.split('#');
    return `href="${path}${path.includes('?') ? '&amp;' : '?'}${utm}${hash ? `#${hash}` : ''}"`;
  });
}

// renderEmail(doc, { mode, viewUrl, siteUrl, campaign })
//   viewUrl: the web copy (/newsletters/<slug>) → "View in browser" line
//   siteUrl + campaign: UTM-tag links into the site (tagLinks)
//   pixelUrl: campaign-level open pixel (sent copies only — never previews or tests)
export function renderEmail({ subject = '', preheader = '', headline = '', blocks = [], theme: rawTheme } = {}, { mode = 'auto', viewUrl = '', siteUrl = '', campaign = '', pixelUrl = '' } = {}) {
  const raw = rawBlock(blocks);
  if (raw) return renderRaw(raw.html);
  const theme = normalizeTheme(rawTheme);
  const font = FONTS[theme.font];
  // Light values are the site's tokens (css/styles.css :root): cream page,
  // white card, gray-900 text, gray-600 muted, gray-200 rules. Dark values
  // are the site's navy-dark palette.
  const light = { bg: '#f5f1ea', text: '#111827', muted: '#4b5563', rule: '#e5e7eb' };
  const dark = { bg: '#0f1e33', card: '#16263f', band: '#0f1e33', text: '#f3f4f6', muted: '#9ca3af', rule: '#2a3c58', quoteBg: '#1f3250' };
  const s = {
    body: `margin:0;padding:0;background:${light.bg};font-family:${font};`,
    p: `margin:0 0 20px;color:${light.text};font-size:17px;line-height:1.7;font-family:${font};`,
    li: `margin:0 0 8px;color:${light.text};font-size:17px;line-height:1.6;font-family:${font};`,
    ul: 'margin:0 0 20px;padding-left:24px;',
    sub: `margin:0 0 8px;color:${theme.accent};font-size:17px;font-weight:700;line-height:1.7;font-family:${font};`,
    h2: `margin:28px 0 12px;color:${theme.accent};font-size:24px;font-weight:800;line-height:1.2;letter-spacing:-0.02em;font-family:${font};`,
    link: `color:${theme.accent};text-decoration:underline;`,
    button: `display:inline-block;background:${theme.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;line-height:1;letter-spacing:0.02em;padding:14px 28px;border-radius:4px;font-family:${font};`,
    quote: `margin:0 0 20px;padding:16px 20px;border-left:4px solid ${theme.highlight};background:${light.bg};color:${light.text};font-size:17px;line-height:1.6;font-style:italic;font-family:${font};`,
    cite: `margin:8px 0 0;color:${light.muted};font-size:14px;font-style:normal;font-family:${font};`,
    caption: `margin:8px 0 0;color:${light.muted};font-size:13px;line-height:1.5;text-align:center;font-family:${font};`,
    footer: `margin:0;color:#aeb6c4;font-size:13px;line-height:1.6;font-family:${font};`,
    footerLink: 'color:#ffffff;text-decoration:underline;',
  };
  const darkRules = (prefix) => [
    `${prefix}.em-bg{background:${dark.bg}!important;}`,
    `${prefix}.em-card{background:${dark.card}!important;}`,
    `${prefix}.em-band{background:${dark.band}!important;}`,
    `${prefix}.em-text{color:${dark.text}!important;}`,
    `${prefix}.em-h{color:${theme.highlight}!important;}`,
    `${prefix}.em-link{color:${theme.highlight}!important;}`,
    `${prefix}.em-muted{color:${dark.muted}!important;}`,
    `${prefix}.em-rule{border-color:${dark.rule}!important;}`,
    `${prefix}.em-quote{background:${dark.quoteBg}!important;color:${dark.text}!important;}`,
    `${prefix}.em-btn{background:${theme.highlight}!important;}`, // navy on navy-dark would vanish; the site's buttons on navy are red too
  ].join('');
  let css = `body{${s.body}} img{max-width:100%;height:auto;} a{word-break:break-word;}`;
  if (mode === 'dark') css += darkRules('');
  else if (mode === 'auto') css += `@media (prefers-color-scheme: dark){${darkRules('')}}${darkRules('[data-ogsc] ')}`;

  const parts = [];
  for (const b of normalizeBlocks(blocks)) {
    switch (b.type) {
      case 'heading': parts.push(`<h2 class="em-h" style="${s.h2}">${escapeHtml(b.text)}</h2>`); break;
      case 'text': parts.push(textBlockHtml(b.markdown, s)); break;
      case 'rich': parts.push(styleRich(b.html, s, light)); break;
      case 'button':
        parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${b.align}" style="margin:8px ${b.align === 'center' ? 'auto' : '0'} 28px;"><tr><td class="em-btn" bgcolor="${theme.accent}" style="border-radius:4px;"><a href="${escapeHtml(b.url)}" class="em-btn" style="${s.button}">${escapeHtml(b.label)}</a></td></tr></table>`);
        break;
      case 'image': {
        const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;margin:0 auto;">`;
        parts.push(`<div style="margin:0 0 24px;text-align:center;">${b.link ? `<a href="${escapeHtml(b.link)}">${img}</a>` : img}${b.caption ? `<p class="em-muted" style="${s.caption}">${inline(b.caption, s.link)}</p>` : ''}</div>`);
        break;
      }
      case 'quote':
        parts.push(`<blockquote class="em-quote" style="${s.quote}">${inline(b.text, s.link)}${b.cite ? `<p class="em-muted" style="${s.cite}">— ${escapeHtml(b.cite)}</p>` : ''}</blockquote>`);
        break;
      case 'divider': parts.push(`<hr class="em-rule" style="border:0;border-top:1px solid ${light.rule};margin:8px 0 28px;">`); break;
      default: break;
    }
  }

  const title = escapeHtml(subject || headline || ORG_NAME);
  const footerLines = theme.footer.split('\n').map((l) => inline(l, s.footerLink)).filter(Boolean).join('<br>');
  // The letterhead says the org name; an eyebrow that only repeats it (the
  // old default, still stored on older drafts) adds nothing.
  const eyebrow = theme.eyebrow.trim().toLowerCase() === ORG_NAME.toLowerCase() ? '' : theme.eyebrow.trim();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>${css}</style>
</head>
<body class="em-bg" style="${s.body}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" style="background:${light.bg};padding:32px 0;">
<tr><td align="center" style="padding:0 12px;">
${viewUrl ? `<p class="em-muted" style="margin:0 0 10px;font-size:12px;font-family:${font};color:${light.muted};"><a href="${escapeHtml(viewUrl)}" class="em-link" style="color:${light.muted};text-decoration:underline;">View in browser</a></p>` : ''}
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="em-card" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
<tr><td class="em-band" bgcolor="${theme.accent}" style="background:${theme.accent};padding:28px 36px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${headline || eyebrow ? '24px' : '0'};"><tr>
<td style="padding:0 12px 0 0;vertical-align:middle;"><a href="${SITE_URL}" style="text-decoration:none;"><img src="${LOGO_URL}" alt="" width="38" height="44" style="display:block;width:38px;height:44px;border:0;"></a></td>
<td style="vertical-align:middle;"><a href="${SITE_URL}" style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-0.01em;text-decoration:none;font-family:${font};">${ORG_NAME}</a></td>
</tr></table>
${eyebrow ? `<p style="margin:0 0 8px;color:${theme.highlight};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;font-family:${font};">${escapeHtml(eyebrow)}</p>` : ''}
${headline ? `<h1 style="margin:0;color:#ffffff;font-size:30px;font-weight:800;line-height:1.15;letter-spacing:-0.02em;font-family:${font};">${escapeHtml(headline)}</h1>` : ''}
</td></tr>
<tr><td style="padding:36px 36px 16px;">
${parts.join('\n')}
</td></tr>
<tr><td class="em-band" bgcolor="${theme.accent}" style="background:${theme.accent};padding:24px 36px 28px;">
<p style="${s.footer}">${footerLines}${footerLines ? '<br>' : ''}<a href="${UNSUBSCRIBE_TOKEN}" class="em-link" style="${s.footerLink}">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
${pixelUrl ? `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">` : ''}
</body>
</html>`;

  const textParts = [];
  if (headline) textParts.push(headline.toUpperCase(), '');
  for (const b of normalizeBlocks(blocks)) {
    switch (b.type) {
      case 'heading': textParts.push('', b.text.toUpperCase(), ''); break;
      case 'text': textParts.push(textBlockText(b.markdown), ''); break;
      case 'rich': textParts.push(htmlToText(b.html), ''); break;
      case 'button': textParts.push(`${b.label}: ${b.url}`, ''); break;
      case 'image': textParts.push(`[${b.alt || 'image'}] ${b.link || b.url}`, ...(b.caption ? [inlineText(b.caption)] : []), ''); break;
      case 'quote': textParts.push(`"${inlineText(b.text)}"${b.cite ? ` — ${b.cite}` : ''}`, ''); break;
      case 'divider': textParts.push('----------', ''); break;
      default: break;
    }
  }
  textParts.push('--', ...theme.footer.split('\n').map(inlineText), `Unsubscribe: ${UNSUBSCRIBE_TOKEN}`);
  if (viewUrl) textParts.unshift(`View in browser: ${viewUrl}`, '');
  const text = textParts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return { html: tagLinks(html, siteUrl, campaign), text };
}

// rawBlock(blocks) → the raw block when the email is in raw-HTML mode, else null.
export function rawBlock(blocks) {
  return normalizeBlocks(blocks).find((b) => b.type === 'raw') || null;
}

// Raw mode: the author's HTML untouched (no theme, header, footer, UTM, pixel
// or View-in-browser). The one addition is the unsubscribe link (CAN-SPAM and
// the List-Unsubscribe body twin), skipped when the author placed the token.
function renderRaw(src) {
  const link = `<p style="margin:24px 0;font-size:12px;text-align:center;"><a href="${UNSUBSCRIBE_TOKEN}" style="color:#6b6b66;">Unsubscribe</a></p>\n`;
  let html = src;
  if (!html.includes(UNSUBSCRIBE_TOKEN)) {
    const at = html.search(/<\/body>/i);
    html = at === -1 ? `${html}\n${link}` : `${html.slice(0, at)}${link}${html.slice(at)}`;
  }
  return { html, text: `${htmlToText(src)}\n\n--\nUnsubscribe: ${UNSUBSCRIBE_TOKEN}\n` };
}

// previewHtml(doc, mode) → html with the unsubscribe token neutralised.
export function previewHtml(doc, mode) {
  return renderEmail(doc, { mode }).html.replaceAll(UNSUBSCRIBE_TOKEN, '#');
}
