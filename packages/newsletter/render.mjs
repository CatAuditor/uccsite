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

export const BLOCK_TYPES = ['heading', 'text', 'button', 'image', 'quote', 'divider'];
export const FONTS = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
};
export const DEFAULT_THEME = {
  accent: '#1a3a2a',     // header band + headings
  highlight: '#c8a84b',  // eyebrow + links on dark
  font: 'serif',
  eyebrow: ORG_NAME,
  footer: 'Utah Civic Compact · Salt Lake City, UT\nYou are getting this because you signed up at utahciviccompact.org.',
};
export const MAX_BLOCKS = 60;
const LIMITS = { heading: 300, text: 20000, label: 120, url: 2000, alt: 300, cite: 200, quote: 2000, caption: 300 };

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
    if (!b || typeof b !== 'object' || !BLOCK_TYPES.includes(b.type)) continue;
    switch (b.type) {
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
export function renderEmail({ subject = '', preheader = '', headline = '', blocks = [], theme: rawTheme } = {}, { mode = 'auto', viewUrl = '', siteUrl = '', campaign = '' } = {}) {
  const theme = normalizeTheme(rawTheme);
  const font = FONTS[theme.font];
  const dark = { bg: '#111412', card: '#1b1f1b', text: '#e9e9e3', muted: '#a9afa6', rule: '#343a34', quoteBg: '#232823' };
  const s = {
    body: `margin:0;padding:0;background:#f5f5f0;font-family:${font};`,
    p: `margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;font-family:${font};`,
    li: `margin:0 0 8px;color:#2c2c2c;font-size:17px;line-height:1.6;font-family:${font};`,
    ul: 'margin:0 0 20px;padding-left:24px;',
    sub: `margin:0 0 8px;color:${theme.accent};font-size:17px;font-weight:700;line-height:1.7;font-family:${font};`,
    h2: `margin:28px 0 12px;color:${theme.accent};font-size:22px;font-weight:700;line-height:1.3;font-family:${font};`,
    link: `color:${theme.accent};text-decoration:underline;`,
    button: `display:inline-block;background:${theme.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;line-height:1;padding:14px 26px;border-radius:4px;font-family:${font};`,
    quote: `margin:0 0 20px;padding:16px 20px;border-left:4px solid ${theme.highlight};background:#f7f6f1;color:#2c2c2c;font-size:17px;line-height:1.6;font-style:italic;font-family:${font};`,
    cite: `margin:8px 0 0;color:#5c5c58;font-size:14px;font-style:normal;font-family:${font};`,
    caption: `margin:8px 0 0;color:#5c5c58;font-size:13px;line-height:1.5;text-align:center;font-family:${font};`,
    footer: `margin:0;color:#6b6b66;font-size:13px;line-height:1.6;font-family:${font};`,
  };
  const darkRules = (prefix) => [
    `${prefix}.em-bg{background:${dark.bg}!important;}`,
    `${prefix}.em-card{background:${dark.card}!important;}`,
    `${prefix}.em-text{color:${dark.text}!important;}`,
    `${prefix}.em-h{color:${theme.highlight}!important;}`,
    `${prefix}.em-link{color:${theme.highlight}!important;}`,
    `${prefix}.em-muted{color:${dark.muted}!important;}`,
    `${prefix}.em-rule{border-color:${dark.rule}!important;}`,
    `${prefix}.em-quote{background:${dark.quoteBg}!important;color:${dark.text}!important;}`,
  ].join('');
  let css = `body{${s.body}} img{max-width:100%;height:auto;} a{word-break:break-word;}`;
  if (mode === 'dark') css += darkRules('');
  else if (mode === 'auto') css += `@media (prefers-color-scheme: dark){${darkRules('')}}${darkRules('[data-ogsc] ')}`;

  const parts = [];
  for (const b of normalizeBlocks(blocks)) {
    switch (b.type) {
      case 'heading': parts.push(`<h2 class="em-h" style="${s.h2}">${escapeHtml(b.text)}</h2>`); break;
      case 'text': parts.push(textBlockHtml(b.markdown, s)); break;
      case 'button':
        parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${b.align}" style="margin:8px ${b.align === 'center' ? 'auto' : '0'} 28px;"><tr><td bgcolor="${theme.accent}" style="border-radius:4px;"><a href="${escapeHtml(b.url)}" style="${s.button}">${escapeHtml(b.label)}</a></td></tr></table>`);
        break;
      case 'image': {
        const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;margin:0 auto;">`;
        parts.push(`<div style="margin:0 0 24px;text-align:center;">${b.link ? `<a href="${escapeHtml(b.link)}">${img}</a>` : img}${b.caption ? `<p class="em-muted" style="${s.caption}">${inline(b.caption, s.link)}</p>` : ''}</div>`);
        break;
      }
      case 'quote':
        parts.push(`<blockquote class="em-quote" style="${s.quote}">${inline(b.text, s.link)}${b.cite ? `<p class="em-muted" style="${s.cite}">— ${escapeHtml(b.cite)}</p>` : ''}</blockquote>`);
        break;
      case 'divider': parts.push(`<hr class="em-rule" style="border:0;border-top:1px solid #e4e6e2;margin:8px 0 28px;">`); break;
      default: break;
    }
  }

  const title = escapeHtml(subject || headline || ORG_NAME);
  const footerLines = theme.footer.split('\n').map((l) => inline(l, s.link)).filter(Boolean).join('<br>');
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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" style="background:#f5f5f0;padding:32px 0;">
<tr><td align="center" style="padding:0 12px;">
${viewUrl ? `<p class="em-muted" style="margin:0 0 10px;font-size:12px;font-family:${font};color:#6b6b66;"><a href="${escapeHtml(viewUrl)}" class="em-link" style="color:#6b6b66;text-decoration:underline;">View in browser</a></p>` : ''}
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="em-card" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
<tr><td bgcolor="${theme.accent}" style="background:${theme.accent};padding:32px 36px;">
<p style="margin:0;color:${theme.highlight};font-size:12px;letter-spacing:3px;text-transform:uppercase;font-family:${font};">${escapeHtml(theme.eyebrow)}</p>
${headline ? `<h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;font-weight:400;line-height:1.3;font-family:${font};">${escapeHtml(headline)}</h1>` : ''}
</td></tr>
<tr><td style="padding:36px 36px 16px;">
${parts.join('\n')}
</td></tr>
<tr><td style="padding:8px 36px 32px;">
<hr class="em-rule" style="border:0;border-top:1px solid #e4e6e2;margin:0 0 20px;">
<p class="em-muted" style="${s.footer}">${footerLines}${footerLines ? '<br>' : ''}<a href="${UNSUBSCRIBE_TOKEN}" class="em-link" style="color:#6b6b66;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textParts = [];
  if (headline) textParts.push(headline.toUpperCase(), '');
  for (const b of normalizeBlocks(blocks)) {
    switch (b.type) {
      case 'heading': textParts.push('', b.text.toUpperCase(), ''); break;
      case 'text': textParts.push(textBlockText(b.markdown), ''); break;
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

// previewHtml(doc, mode) → html with the unsubscribe token neutralised.
export function previewHtml(doc, mode) {
  return renderEmail(doc, { mode }).html.replaceAll(UNSUBSCRIBE_TOKEN, '#');
}
