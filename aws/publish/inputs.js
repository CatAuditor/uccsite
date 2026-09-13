'use strict';
// THE repo-input loader: which files make up the site, read from disk. Shared
// by build.js (local/Pages builds) and scripts/publish.mjs (AWS publishes) so
// the two can never disagree about what the site contains — a file list edit
// in one place reaches both (a divergence here once meant publish would
// DELETE live assets that build.js still shipped).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PAGES } = require('@uccsite/render');

// Static files and directories copied from repo root into the published site.
const COPY_FROM_ROOT = ['css', 'js', 'assets', 'robots.txt', 'llms.txt', 'favicon.svg', 'UCC.png'];

// The disk files a page's render depends on (template + content JSONs) —
// feeds both lastmod strategies.
function pageInputFiles(page) {
  return [
    path.join('templates', page.template),
    ...page.content.map(n => path.join('content', `${n}.json`)),
  ];
}

// loadRenderInputs(root, fail) → { templates, partials, content }
// fail(msg) collects errors (invalid JSON, missing files) without throwing,
// preserving build.js's report-then-abort behavior.
function loadRenderInputs(root, fail = (msg) => { throw new Error(msg); }) {
  const content = {};
  const contentDir = path.join(root, 'content');
  for (const file of fs.readdirSync(contentDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      content[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(contentDir, file), 'utf8'));
    } catch (err) {
      fail(`Invalid JSON in content/${file}: ${err.message}`);
    }
  }
  const templates = {};
  for (const { template } of PAGES) {
    const p = path.join(root, 'templates', template);
    if (fs.existsSync(p)) templates[template] = fs.readFileSync(p, 'utf8');
    // missing templates are reported by buildSite
  }
  const partials = {};
  const partialsDir = path.join(root, 'templates', 'partials');
  if (fs.existsSync(partialsDir)) {
    for (const file of fs.readdirSync(partialsDir)) {
      if (file.endsWith('.html')) partials[path.basename(file, '.html')] = fs.readFileSync(path.join(partialsDir, file), 'utf8');
    }
  }
  return { templates, partials, content };
}

// collectStaticFiles(root) → Map<key, Buffer>. THROWS on unreadable inputs —
// a swallowed fs error here once meant "delete those keys from the live
// bucket". Only genuinely-absent COPY_FROM_ROOT entries are skipped (same as
// build.js's copyRecursive no-op).
function collectStaticFiles(root) {
  const files = new Map();
  const addFile = (abs, key) => files.set(key.replace(/\\/g, '/'), fs.readFileSync(abs));
  const walk = (dir, baseKey) => {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const key = baseKey ? `${baseKey}/${entry}` : entry;
      if (fs.statSync(abs).isDirectory()) walk(abs, key);
      else addFile(abs, key);
    }
  };
  for (const item of COPY_FROM_ROOT) {
    const abs = path.join(root, item);
    if (!fs.existsSync(abs)) continue; // matches build.js copyRecursive
    if (fs.statSync(abs).isDirectory()) walk(abs, item);
    else addFile(abs, item);
  }
  const staticDir = path.join(root, 'static');
  if (fs.existsSync(staticDir)) walk(staticDir, '');
  return files;
}

// gitLastmodProvider(root) → (page) => 'YYYY-MM-DD'
// One `git log --name-only` pass builds a path→newest-commit-date map (fs
// mtimes are checkout times in CI; per-file git spawns cost seconds). Files
// with uncommitted edits or no history fall back to today.
function gitLastmodProvider(root) {
  const newest = new Map();
  try {
    const out = execFileSync('git', ['log', '--format=%cI', '--name-only', '--', 'templates', 'content'],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let currentDate = '';
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) currentDate = trimmed;
      else if (!newest.has(trimmed)) newest.set(trimmed, currentDate); // log is newest-first
    }
  } catch { /* not a git checkout — everything falls back to today */ }
  const today = new Date().toISOString().slice(0, 10);
  return (page) => {
    let best = '';
    for (const f of pageInputFiles(page)) {
      const iso = newest.get(f.replace(/\\/g, '/'));
      if (iso && iso > best) best = iso;
    }
    return best ? best.slice(0, 10) : today;
  };
}

// mtimeLastmodProvider(root) → (page) => 'YYYY-MM-DD' — build.js's original
// local-dev behavior.
function mtimeLastmodProvider(root) {
  return (page) => {
    const files = pageInputFiles(page).map(f => path.join(root, f)).filter(fs.existsSync);
    const newestMs = Math.max(...files.map(f => fs.statSync(f).mtimeMs));
    return new Date(newestMs).toISOString().slice(0, 10);
  };
}

module.exports = {
  COPY_FROM_ROOT, pageInputFiles, loadRenderInputs, collectStaticFiles,
  gitLastmodProvider, mtimeLastmodProvider,
};
