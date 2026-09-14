'use strict';
// Document composition (build-spec-aws.md §4.2, §5, §6, §12). Pure.
//
//   body_html_raw ──ingest──▶ normalized ──applyStyles──▶ styled ──stripNids──▶
//   tokens replaced ({{coverage:key}}, {{video:ID}}) ──▶ shell template with a
//   GENERATED head (structured SEO fields, JSON-LD) ──▶ <slug>.html
//   page_css ──▶ css/pages/<slug>.<hash8>.css (fingerprinted, linked from head)
//
// The sanitizer runs here on every publish — never only on save. Author HTML
// never reaches the <head>; the shell is developer-owned (templates/documents/).
const { createHash } = require('crypto');
const { ingest, stripNids, replaceTextTokens } = require('@uccsite/html-ingest');
const { applyStyles } = require('@uccsite/style-apply');
const { parseStyleKit, classNames } = require('@uccsite/style-kit');
const { render } = require('./engine');

const TEMPLATE_KEYS = ['report'];
const DEFAULT_OG_IMAGE = '/UCC.png';

const sha = (s) => createHash('sha256').update(s).digest('hex');

// pageCssKey(slug, css) → 'css/pages/<slug>.<hash8>.css'
function pageCssKey(slug, css) {
  return `css/pages/${slug}.${sha(css).slice(0, 8)}.css`;
}

// Attribute values: escape only what can break out of a double-quoted
// attribute. Apostrophes stay literal (the parity gate compares raw meta
// content against the production crawl, and `'` is what the templates emit).
const attr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// seoBlock(doc, settings, siteUrl) → { html, errors }. Fallback chain:
// document → template default → settings (§12). Never an empty title or
// description — that's an error, not a silent blank.
function seoBlock(doc, settings, siteUrl) {
  const errors = [];
  const orgName = settings.orgName || 'Utah Civic Compact';
  const title = doc.metaTitle || (doc.title ? `${doc.title} | ${orgName}` : '');
  const description = doc.metaDescription || '';
  if (!title) errors.push(`document ${doc.slug}: empty title`);
  if (!description) errors.push(`document ${doc.slug}: empty meta description (required, §12)`);
  const canonical = doc.canonicalUrl || `${siteUrl}/${doc.slug}`;
  const ogTitle = doc.ogTitle || title;
  const ogDescription = doc.ogDescription || description;
  const ogImage = doc.ogImage || `${siteUrl}${DEFAULT_OG_IMAGE}`;
  const robots = [doc.noindex ? 'noindex' : '', doc.nofollow ? 'nofollow' : ''].filter(Boolean).join(', ');
  const lines = [
    `  <title>${attr(title)}</title>`,
    `  <meta name="description" content="${attr(description)}" />`,
    doc.metaKeywords ? `  <meta name="keywords" content="${attr(doc.metaKeywords)}" />` : '',
    robots ? `  <meta name="robots" content="${robots}" />` : '',
    `  <link rel="canonical" href="${attr(canonical)}" />`,
    `  <meta property="og:type" content="${attr(doc.ogType || 'article')}" />`,
    `  <meta property="og:url" content="${attr(canonical)}" />`,
    `  <meta property="og:title" content="${attr(ogTitle)}" />`,
    `  <meta property="og:description" content="${attr(ogDescription)}" />`,
    `  <meta property="og:site_name" content="${attr(orgName)}" />`,
    `  <meta property="og:image" content="${attr(ogImage)}" />`,
    `  <meta name="twitter:card" content="${attr(doc.twitterCard || 'summary')}" />`,
    `  <meta name="twitter:title" content="${attr(ogTitle)}" />`,
    `  <meta name="twitter:description" content="${attr(ogDescription)}" />`,
    `  <meta name="twitter:image" content="${attr(ogImage)}" />`,
  ].filter(Boolean);
  return { html: lines.join('\n'), errors, title, description, canonical };
}

// jsonldBlock(doc, seo, settings, siteUrl) → '' | '<script type="application/ld+json">…'
function jsonldBlock(doc, seo, settings, siteUrl) {
  if (!doc.jsonldType) return '';
  const base = {
    '@context': 'https://schema.org',
    '@type': doc.jsonldType,
    headline: doc.ogTitle || doc.title,
    description: seo.description,
    url: seo.canonical,
    publisher: { '@type': 'Organization', name: settings.orgName || 'Utah Civic Compact', url: siteUrl },
  };
  const merged = { ...base, ...(doc.jsonldOverrides && typeof doc.jsonldOverrides === 'object' ? doc.jsonldOverrides : {}) };
  // JSON inside <script>: '<' must not be able to close the element.
  const json = JSON.stringify(merged, null, 2).replace(/</g, '\\u003c');
  return `  <script type="application/ld+json">\n${json}\n  </script>`;
}

// Tokens are the only way dynamic markup enters a Document (§5 YouTube note,
// coverage strips). They're plain text in the body so they survive ingest,
// and they are expanded on the TREE — text nodes only, never attribute
// values, never inside <pre>/<code> (html-ingest replaceTextTokens), so an
// author cannot smuggle markup through a token in an attribute.
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
const TOKEN_RE = /\{\{(coverage|video):([A-Za-z0-9_-]+)\}\}/g;
function replaceTokens(body, { partials, coverage = {}, fail }) {
  return replaceTextTokens(body, TOKEN_RE, (_, kind, arg) => {
    if (kind === 'coverage') {
      const entries = coverage[`${arg}_coverage`];
      if (!Array.isArray(entries)) { fail(`unknown coverage key "${arg}"`); return ''; }
      return render(partials['coverage-strip'] || '', { entries }, partials, fail);
    }
    if (!YT_ID.test(arg)) { fail(`invalid video id "${arg}"`); return ''; }
    // www.youtube.com — the only video host the site CSP's frame-src allows.
    return `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${arg}" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  });
}

// knownClassesFor(siteCss, pageCss) → Set — the Style Kit vocabulary plus the
// page's own stylesheet; anything else is "foreign" at ingest.
function knownClassesFor(siteCss, pageCss) {
  const known = new Set(classNames(parseStyleKit(siteCss || '')));
  for (const c of classNames(parseStyleKit(pageCss || ''))) known.add(c);
  return known;
}

// rulesFor(doc, rules) / overridesFor(doc, overrides)
function rulesFor(doc, rules) {
  return (rules || []).filter(r => (r.scope === 'template' && r.templateKey === doc.templateKey)
    || (r.scope === 'page' && r.documentId === doc.id));
}
function overridesFor(doc, overrides) {
  return (overrides || []).filter(o => o.documentId === doc.id);
}

// composeDocument({ doc, shell, partials, settings, siteUrl, siteCss, rules,
//   overrides, foreignClassMap, coverage }) → { html, cssKey, css, ingestResult, errors }
function composeDocument({ doc, shell, partials, settings = {}, siteUrl, siteCss = '', rules = [], overrides = [], foreignClassMap = {}, coverage = {} }) {
  const errors = [];
  const fail = (m) => errors.push(`document ${doc.slug}: ${m}`);

  const ingestResult = ingest(doc.bodyHtmlRaw || '', {
    knownClasses: knownClassesFor(siteCss, doc.pageCss),
    foreignClassMap,
    previousNormalized: doc.bodyHtmlNormalized || null,
    allowScripts: Boolean(doc.allowScripts), // owner-only flag; src-only, allowlisted hosts (html-ingest)
  });
  for (const a of ingestResult.report.a11y) fail(`accessibility gate: ${a.message || a.rule || JSON.stringify(a)}`);

  const styled = applyStyles(ingestResult.bodyHtmlNormalized, rulesFor(doc, rules), overridesFor(doc, overrides));
  const body = replaceTokens(stripNids(styled), { partials, coverage, fail });

  const seo = seoBlock(doc, settings, siteUrl);
  errors.push(...seo.errors);
  const css = doc.pageCss || '';
  const cssKey = css ? pageCssKey(doc.slug, css) : null;
  const data = {
    ...settings,
    page: doc.slug,
    current: { [doc.slug]: true },
    seo_block: seo.html,
    jsonld_block: jsonldBlock(doc, seo, settings, siteUrl),
    page_css_link: cssKey ? `  <link rel="stylesheet" href="/${cssKey}" />` : '',
    body,
  };
  const html = render(shell, data, partials, fail);
  return { html, cssKey, css, ingestResult, errors };
}

// buildDocuments({ documents, shells, partials, settings, siteUrl, siteCss,
//   rules, overrides, foreignClassMaps, coverage }) →
//   { files: { '<slug>.html', 'css/pages/…' }, errors: [], pages: [{template, priority, lastmodAt}] , hashes: {slug: contentHash} }
// pages entries feed the sitemap through the same makeSitemap as fixed pages.
function buildDocuments({ documents = [], shells, partials, settings, siteUrl, siteCss, rules, overrides, foreignClassMaps = {}, coverage }) {
  const files = {};
  const errors = [];
  const pages = [];
  const hashes = {};
  const slugs = new Set();
  for (const doc of documents) {
    if (!TEMPLATE_KEYS.includes(doc.templateKey) || !shells[doc.templateKey]) {
      errors.push(`document ${doc.slug}: unknown template_key "${doc.templateKey}"`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(doc.slug || '')) { errors.push(`document ${doc.slug}: invalid slug`); continue; }
    if (slugs.has(doc.slug)) { errors.push(`document ${doc.slug}: duplicate slug`); continue; }
    slugs.add(doc.slug);
    const out = composeDocument({
      doc, shell: shells[doc.templateKey], partials, settings, siteUrl, siteCss, rules, overrides,
      foreignClassMap: foreignClassMaps[doc.templateKey] || {}, coverage,
    });
    errors.push(...out.errors);
    if (out.errors.length) continue;
    files[`${doc.slug}.html`] = out.html;
    if (out.cssKey) files[out.cssKey] = out.css;
    hashes[doc.slug] = sha(out.html + (out.css || ''));
    const priority = /^(0(\.\d)?|1(\.0)?)$/.test(doc.sitemapPriority || '') ? doc.sitemapPriority : undefined;
    pages.push({ template: `${doc.slug}.html`, priority, sitemap: !doc.noindex, lastmodAt: doc.updatedAt });
  }
  return { files, errors, pages, hashes };
}

module.exports = {
  TEMPLATE_KEYS, pageCssKey, seoBlock, jsonldBlock, replaceTokens, knownClassesFor, rulesFor, overridesFor,
  composeDocument, buildDocuments,
};
