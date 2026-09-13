'use strict';
// THE database-sourced site render, shared by the publish Lambda
// (handler.mjs) and scripts/publish.mjs --source db so the two can never
// disagree about what the site contains.
//
// Fixed pages (PAGES) render from the collections as before. Documents
// (spec §3.2) render through packages/render/documents.js and REPLACE any
// fixed-page template with the same slug — the eight long-form templates
// stay in the repo for the git/build.js path until cutover, but once a
// Document with that slug is published the database wins.
const { buildSite, PAGES, withColorClasses, documents: docs } = require('@uccsite/render');
const { loadContent, contentMeta, makeDbLastmod } = require('@uccsite/db/content');
const { loadPublishBundle, markDocumentLive, markDocumentPublishError } = require('@uccsite/db/documents');

// loadSiteFromDb(client) → everything renderSiteFromDb needs, in one connection.
async function loadSiteFromDb(client) {
  return {
    content: await loadContent(client),
    meta: await contentMeta(client),
    bundle: await loadPublishBundle(client),
  };
}

// renderSiteFromDb({ inputs, siteCss, content, meta, bundle, siteUrl })
//   → { files: { key → string }, errors: [], documentHashes: { slug → hash },
//       documentIds: { slug → id } }
function renderSiteFromDb({ inputs, siteCss, content, meta, bundle, siteUrl }) {
  const foreignClassMaps = {};
  for (const row of bundle.foreignClassMapRows) {
    const key = row.templateKey || '*';
    (foreignClassMaps[key] ??= {})[row.fromClass] = row.toClass || '';
  }
  // Template-specific maps inherit the global ('*') entries.
  for (const key of docs.TEMPLATE_KEYS) {
    foreignClassMaps[key] = { ...(foreignClassMaps['*'] || {}), ...(foreignClassMaps[key] || {}) };
  }

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
  });

  // Any document row (draft included) supersedes the same-slug fixed template:
  // unpublishing a migrated report must not resurrect templates/<slug>.html
  // (which still carries inline styles the CSP blocks) — it 404s instead.
  const docSlugs = new Set([...(bundle.allSlugs || []), ...bundle.documents.map(d => d.slug)]);
  const pages = PAGES.filter(p => !docSlugs.has(p.template.replace(/\.html$/, '')));
  const dbLastmod = makeDbLastmod(meta);
  const lastmod = (page) => (page.lastmodAt ? new Date(page.lastmodAt).toISOString().slice(0, 10) : dbLastmod(page));

  const site = buildSite({ ...inputs, content, lastmod, pages, siteUrl, sitemapExtra: built.pages });
  const errors = [...site.errors, ...built.errors];
  const files = errors.length ? {} : { ...site.files, ...built.files };
  return {
    files, errors,
    // A run that failed anywhere writes nothing — no document went live.
    documentHashes: errors.length ? {} : built.hashes,
    documentIds: Object.fromEntries(bundle.documents.map(d => [d.slug, d.id])),
  };
}

// recordDocumentPublish(client, { documentIds, documentHashes, errors }) —
// per-document live bookkeeping after a run (§9 live_hash / last_publish_error).
async function recordDocumentPublish(client, { documentIds, documentHashes, errors = [] }) {
  for (const [slug, id] of Object.entries(documentIds)) {
    const errs = errors.filter(e => e.startsWith(`document ${slug}:`));
    if (errs.length) await markDocumentPublishError(client, { id, error: errs.join('; ') });
    else if (documentHashes[slug]) await markDocumentLive(client, { id, contentHash: documentHashes[slug] });
  }
}

module.exports = { loadSiteFromDb, renderSiteFromDb, recordDocumentPublish };
