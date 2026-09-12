// Site assembly ported from build.js: the PAGES manifest, markdown field map,
// derived content, page rendering, and sitemap generation. Pure — callers
// supply templates/partials/content as objects and a lastmod provider.
// Golden-file tests lock output byte-for-byte against the pre-port baseline.
'use strict';

const { render, mdToHtml } = require('./engine');

const SITE_URL = 'https://utahciviccompact.org';

// Templates → content file mapping. `sitemap: false` excludes a page (noindex pages).
const PAGES = [
  { template: 'index.html',    content: ['settings', 'homepage', 'projects'], priority: '1.0' },
  { template: 'team.html',     content: ['settings', 'team'] },
  { template: 'blog.html',     content: ['settings', 'blog'] },
  { template: 'statements.html', content: ['settings', 'statements'] },
  { template: 'issues.html',   content: ['settings', 'issues'] },
  { template: 'privacy-report.html', content: ['settings'] },
  { template: 'projects.html', content: ['settings', 'projects'] },
  { template: 'stratos.html',      content: ['settings', 'coverage'] },
  { template: 'weber-county.html', content: ['settings'] },
  { template: 'alpr.html',         content: ['settings', 'coverage'], priority: '0.9' },
  { template: 'how-did-this-happen.html', content: ['settings'] },
  { template: 'dignity-index-statement.html', content: ['settings'] },
  { template: 'theory.html',       content: ['settings'] },
  { template: 'tip.html',          content: ['settings'], sitemap: false },
  { template: 'privacy.html',      content: ['settings'], priority: '0.3' },
  { template: 'success.html',  content: ['settings'], sitemap: false },
  { template: '404.html',      content: ['settings'], sitemap: false },
];

// Array → field containing markdown that must be converted to HTML before render
const MARKDOWN_FIELDS = { members: 'bio', statements: 'body', issues: 'body' };

// The homepage's featured statement is always the newest in statements.json
// (not stored twice). Returns a NEW homepage object — inputs are not mutated.
// `url`/`more` feed the card's link and read-more line (templates/index.html);
// optional per-statement overrides let a card point at a standalone page
// (e.g. the Dignity Index statement) — see docs/decisions/homepage-statement-links.md.
function deriveHomepage(content) {
  if (!content.homepage) return content;
  const statements = (content.statements?.statements || []).slice(0, 1)
    .map(({ slug, date, title, snippet, url, more }) => ({
      slug, date, title, snippet,
      url: url || `/statements.html#${slug}`,
      more: more || 'Read the full statement →',
    }));
  return { ...content, homepage: { ...content.homepage, statements } };
}

// buildSite({ templates, partials, content, lastmod, pages?, siteUrl? })
//   templates: { 'index.html' → template string } — must cover every PAGES entry
//   partials:  { 'header' → string, ... }
//   content:   { 'settings' → object, ... } — parsed JSON per collection
//   lastmod:   (page) => 'YYYY-MM-DD' — injected so CI/Lambda don't depend on fs mtimes
// Returns { files: { 'index.html' → html, 'sitemap.xml' → xml }, errors: [] }.
// Fail-fast contract matches build.js: on any error, callers must write nothing.
function buildSite({ templates, partials, content, lastmod, pages = PAGES, siteUrl = SITE_URL }) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  for (const { template, content: names } of pages) {
    if (!(template in templates)) fail(`Template not found: ${template}`);
    for (const name of names) {
      if (!(name in content)) fail(`${template} needs content/${name}.json, which is missing`);
    }
  }
  if (errors.length) return { files: {}, errors };

  const derived = deriveHomepage(content);

  const files = {};
  for (const { template, content: names } of pages) {
    const page = template.replace(/\.html$/, '');
    const data = Object.assign(
      { page, is_home: page === 'index', current: { [page]: true } }, // used by partials for nav state
      ...names.map(n => derived[n])
    );

    for (const [arrayKey, field] of Object.entries(MARKDOWN_FIELDS)) {
      if (Array.isArray(data[arrayKey])) {
        data[arrayKey] = data[arrayKey].map(item => ({ ...item, [field]: mdToHtml(item[field]) }));
      }
    }

    files[template] = render(templates[template], data, partials, fail);
  }
  if (errors.length) return { files: {}, errors };

  files['sitemap.xml'] = makeSitemap(pages, lastmod, siteUrl);
  return { files, errors };
}

function makeSitemap(pages, lastmod, siteUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schema/sitemap/0.9">
${pages.filter(p => p.sitemap !== false).map(p => {
  // Clean URLs: the live site serves pages extensionless (Cloudflare Pages
  // 308s *.html → clean; CloudFront reproduces that). Sitemap lists the
  // canonical clean form (spec addenda 10/12).
  const loc = p.template === 'index.html' ? `${siteUrl}/` : `${siteUrl}/${p.template.replace(/\.html$/, '')}`;
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod(p)}</lastmod>\n    <priority>${p.priority || '0.7'}</priority>\n  </url>`;
}).join('\n')}
</urlset>
`;
}

module.exports = { PAGES, MARKDOWN_FIELDS, SITE_URL, deriveHomepage, buildSite, makeSitemap };
