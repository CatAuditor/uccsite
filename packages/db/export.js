'use strict';
// Content export builder (build-spec-aws.md §14.2). Turns the loadContent()
// result into the files the nightly export commits to git — the SAME shapes
// as content/*.json today, so the export is a drop-in content backup and an
// exit path. Pure: used by the export Lambda and scripts/export-content.mjs.
//
// Layout (§14.2; documents/, styles/, redirects.json arrive with Phase 8):
//   content/<collection>.json   2-space JSON, LF, trailing newline
//   manifest.json               schema_version, exported_at, row counts
//
// Stable formatting: key order comes from FIELD_MAPS (packages/db/content.js)
// and never from the database, so a diff shows a content change and nothing
// else. manifest.json changes every run (exported_at) and is therefore
// EXCLUDED from the "did anything change" decision (isContentChanged).
const { createHash } = require('crypto');

const SCHEMA_VERSION = 2; // 2: documents/ + styles/rules.json (Phase 8)
const COLLECTIONS = ['settings', 'homepage', 'team', 'statements', 'issues', 'blog', 'projects', 'coverage'];

function stableJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// rowCounts(content) → { team: 3, statements: 12, ... } (top-level list lengths)
function rowCounts(content) {
  const counts = {};
  for (const name of COLLECTIONS) {
    const value = content[name];
    counts[name] = Object.values(value || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  }
  return counts;
}

// Document export (§14.2): documents/<slug>.html = body_html_raw exactly
// (the author's paste — what they would re-paste), documents/<slug>.json =
// metadata + SEO + page CSS + overrides. Derived state (normalized, ingest
// report, hashes, live_at) is excluded — it regenerates. styles/rules.json =
// every rule + the foreign class map.
const DOC_JSON_KEYS = ['slug', 'title', 'category', 'templateKey', 'status', 'sortOrder', 'pageCss',
  'metaTitle', 'metaDescription', 'metaKeywords', 'canonicalUrl', 'ogType', 'ogTitle', 'ogDescription',
  'ogImage', 'twitterCard', 'noindex', 'nofollow', 'jsonldType', 'jsonldOverrides', 'allowScripts', 'sitemapPriority'];

const DOC_JSON_NULLABLE = new Set(['jsonldOverrides']);
function documentJson(doc, overrides) {
  const out = {};
  for (const k of DOC_JSON_KEYS) out[k] = DOC_JSON_NULLABLE.has(k) ? (doc[k] ?? null) : (doc[k] ?? '');
  out.publishedAt = doc.publishedAt || null;
  out.overrides = (overrides || []).map(({ nid, classes, mode }) => ({ nid, classes, mode }));
  return out;
}

// buildContentExport(content, { exportedAt, documents, overrides, rules, foreignClassMap, redirects })
//   → Map<path, string>
function buildContentExport(content, { exportedAt = new Date().toISOString(), documents = [], overrides = [], rules = [], foreignClassMap = [], redirects = [] } = {}) {
  const files = new Map();
  for (const name of COLLECTIONS) {
    if (!(name in content)) throw new Error(`export: content is missing "${name}"`);
    files.set(`content/${name}.json`, stableJson(content[name]));
  }
  for (const doc of [...documents].sort((a, b) => a.slug.localeCompare(b.slug))) {
    files.set(`documents/${doc.slug}.html`, doc.bodyHtmlRaw || '');
    files.set(`documents/${doc.slug}.json`, stableJson(documentJson(doc, overrides.filter(o => o.documentId === doc.id))));
    // Derived, but load-bearing: override nids are carried forward from the
    // PREVIOUS normalized tree on re-paste, so a restore into an empty
    // database needs this to re-attach overrides (§5.4 tree matching).
    if (doc.bodyHtmlNormalized) files.set(`documents/${doc.slug}.normalized.html`, doc.bodyHtmlNormalized);
  }
  files.set('styles/rules.json', stableJson({
    rules: [...rules].sort((a, b) => `${a.scope}|${a.templateKey}|${a.priority}|${a.selector}`.localeCompare(`${b.scope}|${b.templateKey}|${b.priority}|${b.selector}`))
      .map(r => ({ scope: r.scope, templateKey: r.templateKey || null, documentSlug: r.documentId ? (documents.find(d => d.id === r.documentId)?.slug || null) : null, selector: r.selector, classes: r.classes, priority: r.priority, note: r.note || '' })),
    foreignClassMap: [...foreignClassMap].sort((a, b) => a.fromClass.localeCompare(b.fromClass))
      .map(m => ({ templateKey: m.templateKey || null, fromClass: m.fromClass, toClass: m.toClass || '' })),
  }));
  files.set('redirects.json', stableJson([...redirects].sort((a, b) => a.fromPath.localeCompare(b.fromPath))
    .map(r => ({ from: r.fromPath, to: r.toUrl, status: r.statusCode, active: Boolean(r.active), note: r.note || '' }))));
  files.set('manifest.json', stableJson({
    schema_version: SCHEMA_VERSION,
    exported_at: exportedAt,
    counts: { ...rowCounts(content), documents: documents.length, style_rules: rules.length, redirects: redirects.length },
  }));
  return files;
}

// gitBlobSha(text) → the sha1 git assigns a blob with these bytes. Lets the
// exporter compare against the remote tree without downloading anything.
function gitBlobSha(text) {
  const buf = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

// changedPaths(files, remoteShaByPath) → [path] whose blob differs from the
// remote (or is absent there). manifest.json is ignored here (see above).
function changedPaths(files, remoteShaByPath) {
  const out = [];
  for (const [path, text] of files) {
    if (path === 'manifest.json') continue;
    if (remoteShaByPath.get(path) !== gitBlobSha(text)) out.push(path);
  }
  return out;
}

// removedPaths(files, remotePaths) → export-owned paths on the branch that the
// export no longer produces (a deleted document, a dropped file) — committed
// as deletions so a restore cannot resurrect them.
const EXPORT_PREFIXES = ['content/', 'documents/', 'styles/', 'redirects.json'];
function removedPaths(files, remotePaths) {
  return [...remotePaths].filter(p => EXPORT_PREFIXES.some(pre => p.startsWith(pre)) && !files.has(p)).sort();
}

module.exports = { SCHEMA_VERSION, COLLECTIONS, DOC_JSON_KEYS, EXPORT_PREFIXES, stableJson, rowCounts, documentJson, buildContentExport, gitBlobSha, changedPaths, removedPaths };
