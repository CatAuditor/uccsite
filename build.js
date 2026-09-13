#!/usr/bin/env node
// Build script: merges content JSON into HTML templates → dist/
// The template engine and site assembly live in packages/render (pure,
// golden-file tested — see build-spec-aws.md §4); WHICH files make up the
// site lives in aws/publish/inputs.js, shared with scripts/publish.mjs so a
// local build and an AWS publish can never disagree about the file list.
// This file is the local/CI shell: read inputs, write dist/, copy statics.
const fs = require('fs');
const path = require('path');
const { buildSite } = require('./packages/render');
const { COPY_FROM_ROOT, loadRenderInputs, mtimeLastmodProvider } = require('./aws/publish/inputs');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const STATIC = path.join(ROOT, 'static');

const errors = [];
function fail(msg) { errors.push(msg); console.error('ERROR: ' + msg); }

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ── Load, render (pure), abort on any error before touching dist/ ───────────

const inputs = loadRenderInputs(ROOT, fail);
const result = errors.length ? { files: {}, errors: [] } : buildSite({ ...inputs, lastmod: mtimeLastmodProvider(ROOT) });
for (const msg of result.errors) fail(msg);

if (errors.length) {
  console.error(`\nBuild aborted: ${errors.length} error(s). dist/ left untouched.`);
  process.exit(1);
}

// ── Write dist/ ──────────────────────────────────────────────────────────────

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);

for (const item of COPY_FROM_ROOT) {
  copyRecursive(path.join(ROOT, item), path.join(DIST, item));
}
if (fs.existsSync(STATIC)) {
  for (const entry of fs.readdirSync(STATIC)) {
    copyRecursive(path.join(STATIC, entry), path.join(DIST, entry));
  }
}

for (const [name, text] of Object.entries(result.files)) {
  fs.writeFileSync(path.join(DIST, name), text, 'utf8');
  if (name !== 'sitemap.xml') console.log(`Built: ${name}`);
}

console.log('Build complete → dist/');
