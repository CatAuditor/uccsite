'use strict';
// Newsletter archive pages for the site (docs/systems/newsletters.md "Web
// archive"): /newsletters (index) + /newsletters/<slug> for every sent
// newsletter whose row carries archived_at. The body HTML was rendered by
// @uccsite/newsletter/web at request time and frozen on the row (web_html),
// so this only wraps it in the Documents shell (header/footer partials,
// SEO block) and styles it with css/newsletters.css — no inline styles, the
// site's CSP is style-src 'self'. The index is always emitted (the footer
// links to it); issue pages only for archived rows.
const { render } = require('./engine');
const { seoBlock } = require('./documents');

const CSS_LINK = '<link rel="stylesheet" href="/css/newsletters.css" />';
const attr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

function dateLabel(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'America/Denver', year: 'numeric', month: 'long', day: 'numeric' });
}

// buildNewsletterArchive({ newsletters, shell, partials, settings, siteUrl })
//   → { files: { 'newsletters.html', 'newsletters/<slug>.html' }, pages: [sitemap entries], errors }
function buildNewsletterArchive({ newsletters = [], shell, partials = {}, settings = {}, siteUrl }) {
  const files = {};
  const pages = [];
  const errors = [];
  const fail = (msg) => errors.push(`newsletters: ${msg}`);
  if (!shell) { fail('missing shell templates/documents/report.html'); return { files, pages, errors }; }
  const data = (seo, body) => ({
    page: 'newsletters', current: { newsletters: true }, is_home: false, ...settings,
    seo_block: seo.html, jsonld_block: '', page_css_link: CSS_LINK, body,
  });
  const seen = new Set();
  const items = [];
  for (const n of newsletters) {
    if (!SLUG_RE.test(n.slug || '') || seen.has(n.slug)) { fail(`bad or duplicate slug "${n.slug}"`); continue; }
    if (!n.webHtml) { fail(`${n.slug}: no web copy`); continue; }
    seen.add(n.slug);
    const slug = `newsletters/${n.slug}`;
    const seo = seoBlock({ slug, title: n.subject || 'Newsletter', metaDescription: n.preheader || `${n.subject} — Utah Civic Compact newsletter, ${dateLabel(n.sentAt)}.` }, settings, siteUrl);
    errors.push(...seo.errors);
    const body = `<main class="nl-page"><article class="nl-article">
<p class="nl-meta"><a href="/newsletters">Newsletters</a> · Sent ${attr(dateLabel(n.sentAt))}</p>
${n.webHtml}
<p class="nl-join"><a class="btn" href="/#join">Get the next one by email</a></p>
</article></main>`;
    files[`${slug}.html`] = render(shell, data(seo, body), partials, fail);
    pages.push({ template: `${slug}.html`, priority: '0.5', sitemap: true, lastmodAt: n.sentAt });
    items.push(`<li><a href="/${slug}">${attr(n.subject || 'Newsletter')}</a><span class="nl-date">${attr(dateLabel(n.sentAt))}</span>${n.preheader ? `<p>${attr(n.preheader)}</p>` : ''}</li>`);
  }
  const seo = seoBlock({ slug: 'newsletters', title: 'Newsletters', metaDescription: 'Every newsletter Utah Civic Compact has sent — investigations, filings and what comes next.' }, settings, siteUrl);
  errors.push(...seo.errors);
  const list = items.length
    ? `<ul class="nl-list">${items.join('\n')}</ul>`
    : '<p class="nl-intro">Nothing in the archive yet — the first issue lands here when it goes out.</p>';
  files['newsletters.html'] = render(shell, data(seo, `<main class="nl-page"><h1>Newsletters</h1>
<p class="nl-intro">What we send to the Compact, newest first. <a href="/#join">Join</a> to get the next one.</p>
${list}</main>`), partials, fail);
  pages.push({ template: 'newsletters.html', priority: '0.6', sitemap: true, lastmodAt: newsletters[0]?.sentAt });
  return { files, pages, errors };
}

module.exports = { buildNewsletterArchive };
