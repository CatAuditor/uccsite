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

const SCHEMA_VERSION = 1;
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

// buildContentExport(content, { exportedAt }) → Map<path, string>
function buildContentExport(content, { exportedAt = new Date().toISOString() } = {}) {
  const files = new Map();
  for (const name of COLLECTIONS) {
    if (!(name in content)) throw new Error(`export: content is missing "${name}"`);
    files.set(`content/${name}.json`, stableJson(content[name]));
  }
  files.set('manifest.json', stableJson({
    schema_version: SCHEMA_VERSION,
    exported_at: exportedAt,
    counts: rowCounts(content),
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

module.exports = { SCHEMA_VERSION, COLLECTIONS, stableJson, rowCounts, buildContentExport, gitBlobSha, changedPaths };
