#!/usr/bin/env node
// Build script: merges content JSON into HTML templates → dist/
// The template engine and site assembly live in packages/render (pure,
// golden-file tested — see build-spec-aws.md §4). This file is the local/CI
// shell around it: read inputs from disk, write dist/, copy static files.
const fs = require('fs');
const path = require('path');
const { buildSite, PAGES } = require('./packages/render');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const TEMPLATES = path.join(ROOT, 'templates');
const PARTIALS = path.join(TEMPLATES, 'partials');
const CONTENT = path.join(ROOT, 'content');
const STATIC = path.join(ROOT, 'static');

// Static files and directories to copy from root into dist/
const COPY_FROM_ROOT = ['css', 'js', 'assets', 'robots.txt', 'llms.txt', 'favicon.svg', 'UCC.png'];

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

// ── Load everything before touching dist/ ────────────────────────────────────

const content = {};
for (const file of fs.readdirSync(CONTENT)) {
  if (!file.endsWith('.json')) continue;
  try {
    content[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(CONTENT, file), 'utf8'));
  } catch (err) {
    fail(`Invalid JSON in content/${file}: ${err.message}`);
  }
}

const templates = {};
for (const { template } of PAGES) {
  const p = path.join(TEMPLATES, template);
  if (fs.existsSync(p)) templates[template] = fs.readFileSync(p, 'utf8');
  // missing templates are reported by buildSite
}

const partials = {};
if (fs.existsSync(PARTIALS)) {
  for (const file of fs.readdirSync(PARTIALS)) {
    if (file.endsWith('.html')) partials[path.basename(file, '.html')] = fs.readFileSync(path.join(PARTIALS, file), 'utf8');
  }
}

// Local builds date sitemap entries from file mtimes (original behavior).
// CI/publish environments inject a deterministic provider instead.
function lastmod(page) {
  const files = [path.join(TEMPLATES, page.template), ...page.content.map(n => path.join(CONTENT, `${n}.json`))];
  const newest = Math.max(...files.filter(fs.existsSync).map(f => fs.statSync(f).mtimeMs));
  return new Date(newest).toISOString().slice(0, 10);
}

// ── Render (pure) ────────────────────────────────────────────────────────────

const result = errors.length ? { files: {}, errors: [] } : buildSite({ templates, partials, content, lastmod });
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
