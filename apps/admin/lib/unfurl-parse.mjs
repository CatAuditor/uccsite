// Link-preview parsing for the News & Media "Add from link" box
// (docs/systems/admin.md "Link previews"). PURE: html string + url in,
// fields out — no network, so it is unit-tested (test/unfurl-parse.test.mjs).
// The fetch, auth and SSRF guard live in lib/unfurl.js.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

// Every <meta> tag as { key (property|name|itemprop, lowercased), content }.
function metaTags(html) {
  const out = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = (n) => {
      const m = tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
    };
    const key = attr('property') || attr('name') || attr('itemprop');
    const content = attr('content');
    if (key && content != null) out.push({ key: key.toLowerCase(), content });
  }
  return out;
}

function firstMeta(metas, ...keys) {
  for (const k of keys) {
    const hit = metas.find((m) => m.key === k && m.content.trim());
    if (hit) return clean(hit.content);
  }
  return '';
}

function absolute(href, base) {
  if (!href) return '';
  try {
    const u = new URL(decodeEntities(href), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}

// "KSL.com" / "www.sltrib.com" → a readable fallback outlet name.
export function outletFromHost(host) {
  const bare = host.replace(/^www\./, '').replace(/^(m|amp|mobile)\./, '');
  const name = bare.split('.').slice(0, -1).join('.') || bare;
  return name.length <= 4 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
}

// Drop a trailing " | Site Name" / " - Site" / " — Site" when it repeats the site.
export function stripTitleSuffix(title, siteName, host) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const site = norm(siteName || '');
  const hostCore = norm(host.replace(/^www\./, '').split('.')[0]);
  const m = title.match(/^(.*\S)\s+[|\-–—:·]\s+([^|\-–—]+)$/);
  if (!m) return title;
  const tail = norm(m[2]);
  if (tail && (tail === site || tail.includes(hostCore) || (site && site.includes(tail)))) return m[1];
  return title;
}

export function truncateWords(s, max = 320) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:.–—-]+$/, '') + '…';
}

// House date style ("August 20, 2026"), read in Utah time so a late-evening
// UTC timestamp does not land on tomorrow.
export function formatDate(raw) {
  if (!raw) return '';
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric', year: 'numeric' }).format(t);
}

function jsonLdDate(html) {
  const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  return m ? m[1] : '';
}

// Tracking parameters removed from the stored link.
const TRACKING = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|smid|sr_share)$/i;
export function cleanUrl(href) {
  try {
    const u = new URL(href);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.href;
  } catch { return href; }
}

// parsePreview(html, pageUrl) → the preview card + the fields it fills.
export function parsePreview(html, pageUrl) {
  const head = html.slice(0, 600_000);
  const url = new URL(pageUrl);
  const metas = metaTags(head);

  const siteName = firstMeta(metas, 'og:site_name', 'application-name', 'twitter:site').replace(/^@/, '');
  const titleTag = clean((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const rawTitle = firstMeta(metas, 'og:title', 'twitter:title') || titleTag;
  const description = firstMeta(metas, 'og:description', 'twitter:description', 'description');
  const image = absolute(firstMeta(metas, 'og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), url);
  const published = firstMeta(metas, 'article:published_time', 'og:article:published_time', 'published_time',
    'date', 'dc.date', 'parsely-pub-date', 'sailthru.date', 'datepublished') || jsonLdDate(head);

  const iconTag = (head.match(/<link\b[^>]*rel\s*=\s*["'][^"']*\bicon\b[^"']*["'][^>]*>/i) || [])[0] || '';
  const iconHref = (iconTag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
  const icon = absolute(iconHref, url) || `${url.origin}/favicon.ico`;

  const lang = ((head.match(/<html\b[^>]*\blang\s*=\s*["']?([a-z]{2,3})/i) || [])[1] || firstMeta(metas, 'og:locale').slice(0, 2) || 'en').toLowerCase();

  const outlet = siteName || outletFromHost(url.hostname);
  const headline = stripTitleSuffix(rawTitle, siteName, url.hostname);
  const canonical = absolute(firstMeta(metas, 'og:url'), url);
  const finalUrl = cleanUrl(canonical && new URL(canonical).hostname === url.hostname ? canonical : url.href);

  return {
    card: { image, icon, site: outlet, host: url.hostname.replace(/^www\./, ''), title: headline, description },
    fields: {
      outlet,
      headline,
      excerpt: truncateWords(description),
      date: formatDate(published),
      url: finalUrl,
      read_more: lang === 'es' ? `Leer en ${outlet} →` : `Read on ${outlet} →`,
      lang_attr: lang && lang !== 'en' ? `lang="${lang}"` : '',
    },
  };
}

// A bot challenge ("Just a moment…") or a block page is not the article.
export function looksBlocked(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  return /just a moment|attention required|access denied|are you a robot|verify you are human/i.test(title)
    || /cf-challenge|challenge-platform|_cf_chl_opt/i.test(html.slice(0, 20000));
}

// previewFromUrl(url) → the same shape as parsePreview, built from the link
// alone, for outlets that block previews (Utah News Dispatch, Forbes). Most
// news URLs carry a date path and a readable slug; the headline is a DRAFT.
export function previewFromUrl(pageUrl) {
  const url = new URL(pageUrl);
  const outlet = outletFromHost(url.hostname);
  const segs = url.pathname.split('/').filter(Boolean);
  const d = url.pathname.match(/\/(20\d\d)\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
  const date = d
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
      .format(Date.UTC(+d[1], +d[2] - 1, +d[3]))
    : '';
  const slug = [...segs].reverse().find((s) => /[a-z].*-.*[a-z]/i.test(s) && !/^\d+$/.test(s)) || '';
  const words = decodeURIComponent(slug).replace(/\.[a-z]{2,5}$/i, '').replace(/[-_]+/g, ' ')
    .replace(/\b[a-z0-9]{8,}$/i, (w) => (/\d/.test(w) ? '' : w)).trim();
  const headline = words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
  return {
    partial: true,
    card: { image: '', icon: `${url.origin}/favicon.ico`, site: outlet, host: url.hostname.replace(/^www\./, ''), title: headline, description: '' },
    fields: { outlet, headline, excerpt: '', date, url: cleanUrl(url.href), read_more: `Read on ${outlet} →`, lang_attr: '' },
  };
}

// ── SSRF guard (pure part) ────────────────────────────────────────────────
// The fetch runs inside the admin's AWS compute role. A pasted link must never
// reach the instance metadata service, loopback, or any private network.
export function isPrivateAddress(ip) {
  const v = ip.toLowerCase();
  if (v.includes(':')) {
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe[89ab])/.test(v.replace(/^0+/, ''));
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}
