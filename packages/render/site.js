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

// The homepage's featured statements are the newest HOMEPAGE_FEATURED entries
// of statements.json (not stored twice). Returns a NEW homepage object — inputs
// are not mutated. `url`/`more` feed each card's link and read-more line
// (templates/index.html); optional per-statement overrides let a card point at a
// standalone page (e.g. the Dignity Index statement) — see
// docs/decisions/homepage-statement-links.md.
const HOMEPAGE_FEATURED = 3;

function deriveHomepage(content) {
  if (!content.homepage) return content;
  const statements = (content.statements?.statements || []).slice(0, HOMEPAGE_FEATURED)
    .map(({ slug, date, title, snippet, url, more }) => ({
      slug, date, title, snippet,
      url: url || `/statements.html#${slug}`,
      more: more || 'Read the full statement →',
    }));
  return { ...content, homepage: { ...content.homepage, statements } };
}

// withColorClasses(content) → { content, colorsCss }
// Content carries badge_color / status_color hex values; templates used to
// paint them with inline style attributes, which CSP style-src 'self'
// forbids. Every such value gets a sibling badge_class / status_class
// ('c-<hex>') and one generated stylesheet (css/colors.css) declares them.
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function withColorClasses(content) {
  const colors = new Set();
  const visit = (v) => {
    if (Array.isArray(v)) return v.map(visit);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = visit(val);
    for (const key of ['badge_color', 'status_color']) {
      const hex = typeof out[key] === 'string' && HEX.test(out[key].trim()) ? out[key].trim().toLowerCase() : null;
      if (hex) { colors.add(hex); out[key.replace('_color', '_class')] = `c-${hex.slice(1)}`; }
      else if (out[key]) out[key.replace('_color', '_class')] = '';
    }
    // lang_attr was rendered RAW ({{{lang_attr}}}) — a free-text attribute
    // sink. It is now parsed into a validated BCP-47-ish code (`lang`) and
    // the templates render lang="{{lang}}"; anything else renders nothing.
    if ('lang_attr' in out) {
      const m = typeof out.lang_attr === 'string' && out.lang_attr.trim().match(/^lang="([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)"$/);
      out.lang = m ? m[1] : '';
    }
    return out;
  };
  const derived = visit(content);
  const colorsCss = '/* Generated from content badge_color / status_color values (packages/render/site.js). */\n'
    + [...colors].sort().map(c => `.c-${c.slice(1)} { background: ${c}; }`).join('\n') + '\n';
  return { content: derived, colorsCss };
}

const { parseFreeDate } = require('./dates');

// deriveProjectFilters(content) → content with project_statuses /
// project_regions (distinct, in first-seen order) and per-project date_ts
// (Date.parse of the free-text date, '' when unparseable) for the projects
// page's client-side filter/sort controls (js/projects.js).
function deriveProjectFilters(content) {
  const projects = content.projects?.projects;
  if (!Array.isArray(projects)) return content;
  const uniq = (key) => [...new Set(projects.map(p => (p[key] || '').trim()).filter(Boolean))].map(value => ({ value }));
  return {
    ...content,
    projects: {
      ...content.projects,
      projects: projects.map(p => {
        const ts = parseFreeDate(p.date);
        // *_key: trimmed values the data attributes carry, so they match the
        // option lists exactly even for content loaded verbatim from JSON.
        return { ...p, date_ts: Number.isNaN(ts) ? '' : String(ts), status_key: (p.status || '').trim(), region_key: (p.region || '').trim() };
      }),
      project_statuses: uniq('status'),
      project_regions: uniq('region'),
    },
  };
}

// deriveProjectFiles(content) → every project gets `files`: the published
// project files for its slug from content.project_files ({ slug → [file] },
// supplied by the DB render path — aws/publish/render-db.js; the git/local
// build has none, so files is [] and the template emits nothing).
function deriveProjectFiles(content) {
  const projects = content.projects?.projects;
  if (!Array.isArray(projects)) return content;
  const bySlug = content.project_files || {};
  return {
    ...content,
    projects: {
      ...content.projects,
      projects: projects.map(p => ({ ...p, files: bySlug[(p.slug || '').trim()] || [] })),
    },
  };
}

// buildSite({ templates, partials, content, lastmod, pages?, siteUrl? })
//   templates: { 'index.html' → template string } — must cover every PAGES entry
//   partials:  { 'header' → string, ... }
//   content:   { 'settings' → object, ... } — parsed JSON per collection
//   lastmod:   (page) => 'YYYY-MM-DD' — injected so CI/Lambda don't depend on fs mtimes
// Returns { files: { 'index.html' → html, 'sitemap.xml' → xml }, errors: [] }.
// Fail-fast contract matches build.js: on any error, callers must write nothing.
// sitemapExtra: additional { template, priority, sitemap } entries (Documents
// rendered by packages/render/documents.js) that belong in the same sitemap.
function buildSite({ templates, partials, content, lastmod, pages = PAGES, siteUrl = SITE_URL, sitemapExtra = [] }) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  for (const { template, content: names } of pages) {
    if (!(template in templates)) fail(`Template not found: ${template}`);
    for (const name of names) {
      if (!(name in content)) fail(`${template} needs content/${name}.json, which is missing`);
    }
  }
  if (errors.length) return { files: {}, errors };

  const colored = withColorClasses(content);
  const derived = deriveProjectFiles(deriveProjectFilters(deriveHomepage(colored.content)));

  const files = { 'css/colors.css': colored.colorsCss };
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

  files['sitemap.xml'] = makeSitemap([...pages, ...sitemapExtra], lastmod, siteUrl);
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

module.exports = { PAGES, MARKDOWN_FIELDS, SITE_URL, deriveHomepage, deriveProjectFilters, deriveProjectFiles, withColorClasses, buildSite, makeSitemap };
