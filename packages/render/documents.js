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
const { navFields } = require('./navigation');
const { projectOf, projectUrl, documentUrl } = require('./projects');

const TEMPLATE_KEYS = ['report'];
const DEFAULT_OG_IMAGE = '/assets/share-default.png'; // logo on navy (transparent UCC.png let apps paint their own background)

const sha = (s) => createHash('sha256').update(s).digest('hex');

// pageCssKey(name, css) → 'css/pages/<name>.<hash8>.css'. name: the page's
// path with slashes as dashes ('theory', 'projects-alpr-report') so two
// projects' `report` documents never share a stylesheet key.
function pageCssKey(name, css) {
  return `css/pages/${String(name).replace(/^\/+/, '').replace(/\//g, '-')}.${sha(css).slice(0, 8)}.css`;
}

// Attribute values: escape only what can break out of a double-quoted
// attribute. Apostrophes stay literal (the parity gate compares raw meta
// content against the production crawl, and `'` is what the templates emit).
const attr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// seoBlock(doc, settings, siteUrl, path?) → { html, errors }. Fallback chain:
// document → template default → settings (§12). Never an empty title or
// description — that's an error, not a silent blank. path: the page's site
// path ('/projects/alpr/report'; default '/<slug>') for the canonical URL
// and the error label.
function seoBlock(doc, settings, siteUrl, path = `/${doc.slug}`) {
  const errors = [];
  const orgName = settings.orgName || 'Utah Civic Compact';
  const label = path.replace(/^\//, '');
  const title = doc.metaTitle || (doc.title ? `${doc.title} | ${orgName}` : '');
  const description = doc.metaDescription || '';
  if (!title) errors.push(`document ${label}: empty title`);
  if (!description) errors.push(`document ${label}: empty meta description (required, §12)`);
  const canonical = doc.canonicalUrl || `${siteUrl}${path}`;
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

// jsonldBlock(doc, seo, settings, siteUrl, authors?, { project, crumbs }?) → '' | '<script type="application/ld+json">…'
// authors: { name → { url, id } } (packages/render/site.js authorIndex). A
// document's `author` becomes a Person; when the name is a team member the
// Person carries the author page's @id/url so every page by that person
// resolves to ONE entity (docs/systems/author-pages.md). Overrides still win.
// project ({ name, url }): isPartOf the project's hub page; crumbs
// ([{ name, url }]): a second script with the BreadcrumbList — it is what
// drives the search-result breadcrumb, not the URL shape
// (docs/decisions/project-tree-nested-urls.md). Both only when the document
// is under a project.
function jsonldBlock(doc, seo, settings, siteUrl, authors = {}, { project = null, crumbs = [] } = {}) {
  const scripts = [];
  if (project && crumbs.length) {
    const list = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${siteUrl}${c.url}` })) };
    scripts.push(`  <script type="application/ld+json">\n${JSON.stringify(list, null, 2).replace(/</g, '\\u003c')}\n  </script>`);
  }
  if (!doc.jsonldType) return scripts.join('\n');
  const authorName = String(doc.author || '').trim();
  const known = authors[authorName];
  const base = {
    '@context': 'https://schema.org',
    '@type': doc.jsonldType,
    headline: doc.ogTitle || doc.title,
    description: seo.description,
    url: seo.canonical,
    ...(project ? { isPartOf: { '@type': 'CollectionPage', name: project.name, url: `${siteUrl}${project.url}` } } : {}),
    ...(doc.publishedAt ? { datePublished: String(doc.publishedAt).slice(0, 10) } : {}),
    ...(authorName ? {
      author: {
        '@type': 'Person',
        ...(known ? { '@id': known.id, url: `${siteUrl}${known.url}` } : {}),
        name: authorName,
        affiliation: { '@type': 'Organization', name: settings.orgName || 'Utah Civic Compact', url: siteUrl },
      },
    } : {}),
    publisher: { '@type': 'Organization', name: settings.orgName || 'Utah Civic Compact', url: siteUrl },
  };
  const merged = { ...base, ...(doc.jsonldOverrides && typeof doc.jsonldOverrides === 'object' ? doc.jsonldOverrides : {}) };
  // JSON inside <script>: '<' must not be able to close the element.
  const json = JSON.stringify(merged, null, 2).replace(/</g, '\\u003c');
  scripts.unshift(`  <script type="application/ld+json">\n${json}\n  </script>`);
  return scripts.join('\n');
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
//   overrides, foreignClassMap, coverage, authors, projects, siblings })
//   → { html, cssKey, css, ingestResult, errors, path }
// projects: content.projects.projects — the document's project (projects.js
// projectOf) sets its URL (/projects/<path>/<slug>, projects.js documentUrl),
// the "part of" bar under the body (templates/documents/report.html) with the
// project's other documents (siblings: [{ title, url }]), the canonical URL
// and the JSON-LD isPartOf + BreadcrumbList. Without a project the page is
// /<slug>, as before.
function composeDocument({ doc, shell, partials, settings = {}, siteUrl, siteCss = '', rules = [], overrides = [], foreignClassMap = {}, coverage = {}, authors = {}, projects = [], siblings = [] }) {
  const errors = [];
  const project = projectOf(doc, projects);
  const path = documentUrl(doc, projects);
  const label = path.replace(/^\//, '');
  const fail = (m) => errors.push(`document ${label}: ${m}`);

  const ingestResult = ingest(doc.bodyHtmlRaw || '', {
    knownClasses: knownClassesFor(siteCss, doc.pageCss),
    foreignClassMap,
    previousNormalized: doc.bodyHtmlNormalized || null,
    allowScripts: Boolean(doc.allowScripts), // owner-only flag; src-only, allowlisted hosts (html-ingest)
  });
  for (const a of ingestResult.report.a11y) fail(`accessibility gate: ${a.message || a.rule || JSON.stringify(a)}`);

  const styled = applyStyles(ingestResult.bodyHtmlNormalized, rulesFor(doc, rules), overridesFor(doc, overrides));
  const body = replaceTokens(stripNids(styled), { partials, coverage, fail });

  const seo = seoBlock(doc, settings, siteUrl, path);
  errors.push(...seo.errors);
  const css = doc.pageCss || '';
  const cssKey = css ? pageCssKey(label, css) : null;
  const hub = project ? { name: project.name, url: projectUrl(project, projects) } : null;
  const parentSlug = project ? String(project.parent_slug || '').trim() : '';
  const parent = parentSlug ? projects.find(p => String(p.slug || '').trim() === parentSlug) : null;
  const crumbs = hub ? [{ name: 'Projects', url: '/projects' }, ...(parent ? [{ name: parent.name, url: projectUrl(parent, projects) }] : []), hub, { name: doc.title, url: path }] : [];
  // Nav state: a nested document lights the Projects menu item; a root
  // document its own page key (a menu link to /<slug> gets aria-current).
  const pageKey = project ? 'projects' : doc.slug;
  const others = siblings.filter(s => s && s.url && s.url !== path);
  const data = {
    ...settings,
    page: pageKey,
    current: { [pageKey]: true },
    ...navFields(settings, pageKey, { projects: projects.filter(p => !String(p.parent_slug || '').trim()).map(p => ({ name: p.name, url: projectUrl(p, projects) })) }),
    seo_block: seo.html,
    jsonld_block: jsonldBlock(doc, seo, settings, siteUrl, authors, { project: hub, crumbs }),
    page_css_link: cssKey ? `  <link rel="stylesheet" href="/${cssKey}" />` : '',
    body,
    project_name: hub ? hub.name : '',
    project_href: hub ? hub.url : '',
    project_parent_name: parent ? parent.name : '',
    project_parent_href: parent ? projectUrl(parent, projects) : '',
    siblings: others,
    has_siblings: others.length > 0,
  };
  const html = render(shell, data, partials, fail);
  return { html, cssKey, css, ingestResult, errors, path };
}

// buildDocuments({ documents, shells, partials, settings, siteUrl, siteCss,
//   rules, overrides, foreignClassMaps, coverage, authors, projects }) →
//   { files: { '<path>.html', 'css/pages/…' }, errors: [],
//     pages: [{ template, priority, sitemap, lastmodAt }],
//     hashes: { id → contentHash }, paths: { id → '/path' } }
// A document's file is its URL path ('/projects/alpr/report' →
// projects/alpr/report.html; '/theory' → theory.html). Two documents may not
// share a path, and a path may not be a project hub's. pages entries feed the
// sitemap through the same makeSitemap as fixed pages. Errors are labelled
// by path so the admin can show them per document.
function buildDocuments({ documents = [], shells, partials, settings, siteUrl, siteCss, rules, overrides, foreignClassMaps = {}, coverage, authors = {}, projects = [] }) {
  const files = {};
  const errors = [];
  const pages = [];
  const hashes = {};
  const paths = {};
  const taken = new Map(projects.map(p => [projectUrl(p, projects), `project "${p.name || p.slug}"`]));
  const labelOf = (doc) => documentUrl(doc, projects).replace(/^\//, '');
  const siblingsOf = (doc) => {
    const slug = String(doc.projectSlug || '').trim();
    if (!slug) return [];
    return documents.filter(d => d !== doc && String(d.projectSlug || '').trim() === slug).map(d => ({ title: d.title, url: documentUrl(d, projects) }));
  };
  for (const doc of documents) {
    if (!TEMPLATE_KEYS.includes(doc.templateKey) || !shells[doc.templateKey]) {
      errors.push(`document ${labelOf(doc)}: unknown template_key "${doc.templateKey}"`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(doc.slug || '')) { errors.push(`document ${labelOf(doc)}: invalid slug`); continue; }
    const path = documentUrl(doc, projects);
    if (taken.has(path)) { errors.push(`document ${labelOf(doc)}: its address ${path} is already used by ${taken.get(path)}`); continue; }
    taken.set(path, `document "${doc.title || doc.slug}"`);
    const out = composeDocument({
      doc, shell: shells[doc.templateKey], partials, settings, siteUrl, siteCss, rules, overrides,
      foreignClassMap: foreignClassMaps[doc.templateKey] || {}, coverage, authors, projects, siblings: siblingsOf(doc),
    });
    errors.push(...out.errors);
    if (out.errors.length) continue;
    files[`${path.replace(/^\//, '')}.html`] = out.html;
    if (out.cssKey) files[out.cssKey] = out.css;
    hashes[doc.id] = sha(out.html + (out.css || ''));
    paths[doc.id] = path;
    const priority = /^(0(\.\d)?|1(\.0)?)$/.test(doc.sitemapPriority || '') ? doc.sitemapPriority : undefined;
    pages.push({ template: `${path.replace(/^\//, '')}.html`, priority, sitemap: !doc.noindex, lastmodAt: doc.updatedAt });
  }
  return { files, errors, pages, hashes, paths };
}

module.exports = {
  TEMPLATE_KEYS, pageCssKey, seoBlock, jsonldBlock, replaceTokens, knownClassesFor, rulesFor, overridesFor,
  composeDocument, buildDocuments,
};
