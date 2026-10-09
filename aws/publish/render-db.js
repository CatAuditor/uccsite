'use strict';
// THE database-sourced site render, shared by the publish Lambda
// (handler.mjs) and scripts/publish.mjs --source db so the two can never
// disagree about what the site contains.
//
// Fixed pages (PAGES) render from the collections as before. Documents
// (spec §3.2) render through packages/render/documents.js and REPLACE any
// fixed-page template with the same address — the eight long-form templates
// stay in the repo for the git/build.js path until cutover, but once a
// Document has claimed that address (as its slug, its short path or the
// path it last published at) the database wins.
const { buildSite, PAGES, withColorClasses, authorIndex, documents: docs, documentUrl, projectUrl } = require('@uccsite/render');
const { loadContent, contentMeta, makeDbLastmod } = require('@uccsite/db/content');
const { loadPublishBundle, markDocumentLive, markDocumentPublishError, archivedPaths } = require('@uccsite/db/documents');
const { listRedirects, kvsEntries } = require('@uccsite/db/redirects');
const { listPublishedFiles } = require('@uccsite/db/project-files');
const { listArchive } = require('@uccsite/db/newsletters');
const { buildNewsletterArchive } = require('@uccsite/render/newsletters');
const { syncRedirects } = require('./redirects-sync');

// loadSiteFromDb(client) → everything renderSiteFromDb needs, in one connection.
async function loadSiteFromDb(client) {
  return {
    content: await loadContent(client),
    meta: await contentMeta(client),
    bundle: await loadPublishBundle(client),
    projectFiles: await listPublishedFiles(client),
    newsletters: await listArchive(client),
  };
}

// documentRedirects(documents, projects, livePaths) → [{ from, to }]: for
// every published document, its short path and, when its URL has changed
// since the last publish, its previous live path — both 301 to the current
// URL (docs/decisions/project-tree-nested-urls.md). A `from` that is a page
// this render writes is dropped: a redirect must never shadow a live page.
function documentRedirects(documents, projects, livePaths) {
  const out = [];
  for (const d of documents) {
    const to = documentUrl(d, projects);
    for (const from of [d.shortPath, d.livePath]) {
      if (!from || from === to || livePaths.has(from)) continue;
      out.push({ from, to });
    }
  }
  return out;
}

// renderSiteFromDb({ inputs, siteCss, content, meta, bundle, siteUrl, projectFiles, newsletters })
//   → { files: { key → string }, errors: [],
//       documents: [{ id, label }], documentHashes: { id → hash }, documentPaths: { id → '/path' },
//       documentRedirects: [{ from, to }] }
function renderSiteFromDb({ inputs, siteCss, content, meta, bundle, siteUrl, projectFiles = {}, newsletters = [] }) {
  const foreignClassMaps = {};
  for (const row of bundle.foreignClassMapRows) {
    const key = row.templateKey || '*';
    (foreignClassMaps[key] ??= {})[row.fromClass] = row.toClass || '';
  }
  // Template-specific maps inherit the global ('*') entries.
  for (const key of docs.TEMPLATE_KEYS) {
    foreignClassMaps[key] = { ...(foreignClassMaps['*'] || {}), ...(foreignClassMaps[key] || {}) };
  }
  const projects = content.projects?.projects || [];

  const built = docs.buildDocuments({
    documents: bundle.documents,
    shells: inputs.shells,
    partials: inputs.partials,
    settings: content.settings,
    siteUrl,
    siteCss,
    rules: bundle.rules,
    overrides: bundle.overrides,
    foreignClassMaps,
    coverage: withColorClasses(content).content.coverage, // badge_class for the strips
    authors: authorIndex(content.team?.members, siteUrl), // Person @id per team member (author pages)
    projects, // URLs, the "part of <project>" bar, isPartOf (packages/render/projects.js)
  });

  // Author pages list every published Document whose `author` is the member
  // (packages/render/site.js deriveTeam reads content.documents_index); each
  // project's hub page nests its documents (packages/render/projects.js
  // deriveProjectTree); /writing lists them. Date is the JSON-LD override's
  // datePublished when set, else the publish date.
  const documentsIndex = bundle.documents.map(d => ({
    slug: d.slug, title: d.title, author: d.author || '', category: d.category || '', summary: d.metaDescription || '',
    projectSlug: d.projectSlug || '',
    url: documentUrl(d, projects),
    date: (d.jsonldOverrides && d.jsonldOverrides.datePublished) || (d.publishedAt ? String(d.publishedAt).slice(0, 10) : ''),
  }));

  // A fixed template is dropped when any document row (draft included) has
  // claimed its address: unpublishing a migrated report must not resurrect
  // templates/<slug>.html (which still carries inline styles the CSP blocks)
  // — it 404s instead; and after the tree migration /alpr is a 301 to the
  // nested report, so alpr.html must not render underneath it.
  const claimed = new Set(bundle.allAddresses || []);
  const pages = PAGES.filter(p => p.each || !claimed.has(p.template.replace(/\.html$/, '')));
  const dbLastmod = makeDbLastmod(meta);
  const lastmod = (page) => (page.lastmodAt ? new Date(page.lastmodAt).toISOString().slice(0, 10) : dbLastmod(page));

  // Published project files ride along as content.project_files (not part of
  // loadContent — the content export must not carry derived data).
  // Sent newsletters with a web copy → /newsletters + /newsletters/<slug>
  // (docs/systems/newsletters.md "Web archive"), wrapped in the report shell.
  const archive = buildNewsletterArchive({ newsletters, shell: inputs.shells?.report, partials: inputs.partials, settings: content.settings, siteUrl });

  const site = buildSite({ ...inputs, content: { ...content, project_files: projectFiles, documents_index: documentsIndex }, lastmod, pages, siteUrl, sitemapExtra: [...built.pages, ...archive.pages] });
  const errors = [...site.errors, ...built.errors, ...archive.errors];
  const files = errors.length ? {} : { ...site.files, ...built.files, ...archive.files };
  const livePaths = new Set(Object.keys(files).filter(k => k.endsWith('.html')).map(k => `/${k.replace(/\.html$/, '')}`));
  return {
    files, errors,
    documents: bundle.documents.map(d => ({ id: d.id, label: documentUrl(d, projects).replace(/^\//, '') })),
    // A run that failed anywhere writes nothing — no document went live.
    documentHashes: errors.length ? {} : built.hashes,
    documentPaths: errors.length ? {} : built.paths,
    documentRedirects: errors.length ? [] : documentRedirects(bundle.documents, projects, livePaths),
    projectUrls: Object.fromEntries(projects.map(p => [p.slug, projectUrl(p, projects)])),
  };
}

// recordDocumentPublish(client, { documents, documentHashes, documentPaths, errors }) —
// per-document live bookkeeping after a run (§9 live_hash / live_at /
// live_path / last_publish_error). Errors are labelled "document <path>: …"
// by the renderer.
async function recordDocumentPublish(client, { documents = [], documentHashes = {}, documentPaths = {}, errors = [] }) {
  for (const { id, label } of documents) {
    const errs = errors.filter(e => e.startsWith(`document ${label}:`));
    if (errs.length) await markDocumentPublishError(client, { id, error: errs.join('; ') });
    else if (documentHashes[id]) await markDocumentLive(client, { id, contentHash: documentHashes[id], path: documentPaths[id] });
  }
}

// publishRedirects({ client, kvsArn, region, documentRedirects, log }) — DB
// rows + document redirects → KeyValueStore. Called after the site files are
// live; a failure here is reported but does not un-publish the pages (the
// previous redirect set stays in force). documentRedirects come from the
// render that just went live (renderSiteFromDb) — they are computed BEFORE
// recordDocumentPublish overwrites live_path. Archived documents ride along
// as 410 Gone entries at their last live address (docs/systems/documents.md
// "Archiving"): their pages were deleted from S3 by this same run.
async function publishRedirects({ client, kvsArn, region, documentRedirects = [], log }) {
  if (!kvsArn) { log('redirects: no KeyValueStore configured — skipped'); return null; }
  const rows = await listRedirects(client);
  const gonePaths = await archivedPaths(client);
  if (!rows.length) {
    // An empty table on an environment whose store was seeded from
    // infra/cdk/kvs/redirects.json means migrate-redirects.mjs never ran —
    // deleting the seeded keys would silently drop live redirects.
    log(`redirects: table is empty — store left untouched (run scripts/migrate-redirects.mjs first)${gonePaths.length ? `; ${gonePaths.length} archived document(s) not written as 410` : ''}${documentRedirects.length ? `; ${documentRedirects.length} document redirect(s) not written` : ''}`);
    return { put: 0, deleted: 0, skipped: 'empty table' };
  }
  if (documentRedirects.length) log(`redirects: ${documentRedirects.length} document redirect(s) → 301: ${documentRedirects.map(r => `${r.from} → ${r.to}`).join(', ')}`);
  if (gonePaths.length) log(`redirects: ${gonePaths.length} archived path(s) → 410 Gone: ${gonePaths.join(', ')}`);
  return syncRedirects({ kvsArn, entries: kvsEntries(rows.filter(r => r.active), { documentRedirects, gonePaths }), region, log });
}

module.exports = { loadSiteFromDb, renderSiteFromDb, recordDocumentPublish, publishRedirects, documentRedirects };
