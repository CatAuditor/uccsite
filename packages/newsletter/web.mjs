// Web version of a newsletter for the site's archive (/newsletters/<slug>).
// Same blocks, same markdown rules as render.mjs, but semantic HTML with
// CLASSES and no inline styles — the site's CSP is style-src 'self', so the
// email's inline-styled tables cannot be served as a page. Styled by
// css/newsletters.css. Pure; the admin renders this at request time and
// freezes it on the row (web_html) beside the email html.
import { escapeHtml, normalizeBlocks, safeUrl } from './render.mjs';

function inline(src) {
  return escapeHtml(src)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (m, text, href) => {
      const url = safeUrl(href.replace(/&amp;/g, '&'));
      return url ? `<a href="${escapeHtml(url)}">${text}</a>` : text;
    });
}

function textBlock(markdown) {
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = []; } };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h3>${inline(h[1])}</h3>`); continue; }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) { flushPara(); list.push(li[1]); continue; }
    if (!line) { flushPara(); flushList(); continue; }
    if (list.length) flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}

// renderWebBody({ headline, blocks }) → HTML fragment for the archive page body.
export function renderWebBody({ headline = '', blocks = [] } = {}) {
  const parts = [];
  for (const b of normalizeBlocks(blocks)) {
    switch (b.type) {
      case 'heading': parts.push(`<h2>${escapeHtml(b.text)}</h2>`); break;
      case 'text': parts.push(textBlock(b.markdown)); break;
      // Sanitized on save (lib/newsletter-import.mjs sanitizeRich): no
      // style/class/script survives, so it can sit under the site's CSP.
      case 'rich': parts.push(`<div class="nl-rich">${b.html}</div>`); break;
      case 'button': parts.push(`<p class="nl-button${b.align === 'left' ? ' nl-left' : ''}"><a class="btn" href="${escapeHtml(b.url)}">${escapeHtml(b.label)}</a></p>`); break;
      case 'image': {
        const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt)}" loading="lazy">`;
        parts.push(`<figure class="nl-figure">${b.link ? `<a href="${escapeHtml(b.link)}">${img}</a>` : img}${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`);
        break;
      }
      case 'quote': parts.push(`<blockquote class="nl-quote">${inline(b.text)}${b.cite ? `<cite>${escapeHtml(b.cite)}</cite>` : ''}</blockquote>`); break;
      case 'divider': parts.push('<hr>'); break;
      default: break;
    }
  }
  return `${headline ? `<h1 class="nl-headline">${escapeHtml(headline)}</h1>` : ''}\n${parts.join('\n')}`;
}

// archiveSlug(subject, date) → 'yyyy-mm-dd-subject-words' (≤ 80 chars).
export function archiveSlug(subject, date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const day = Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
  const words = String(subject || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${day}${words ? `-${words}` : ''}`;
}
