#!/usr/bin/env node
// Build script: merges content JSON into HTML templates → dist/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const TEMPLATES = path.join(ROOT, 'templates');
const PARTIALS = path.join(TEMPLATES, 'partials');
const CONTENT = path.join(ROOT, 'content');
const STATIC = path.join(ROOT, 'static');
const SITE_URL = 'https://utahciviccompact.org';

// Static files and directories to copy from root into dist/
const COPY_FROM_ROOT = ['css', 'js', 'assets', 'robots.txt', 'llms.txt', 'favicon.svg', 'UCC.png'];

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
];

// Array → field containing markdown that must be converted to HTML before render
const MARKDOWN_FIELDS = { members: 'bio', statements: 'body', issues: 'body' };

const errors = [];
function fail(msg) { errors.push(msg); console.error('ERROR: ' + msg); }

// ── Utilities ────────────────────────────────────────────────────────────────

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

// Escape HTML special chars for {{var}} interpolation
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal markdown → HTML: paragraphs, **bold**, *italic*, [text](url).
// Source is HTML-escaped first so CMS content cannot inject markup.
function mdToHtml(md) {
  if (!md) return '';
  return escapeHtml(md).trim().split(/\n{2,}/).map(p => {
    const html = p.trim()
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => `<a href="${safeUrl(url)}">${text}</a>`)
      .replace(/\n/g, '<br />');
    return `<p>${html}</p>`;
  }).join('\n');
}

// Only allow http(s), relative, mailto links in hrefs sourced from content
function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^(https?:|mailto:|\/|#)/i.test(u) && !/[\s"'<>]/.test(u)) return u;
  return '#';
}

// Resolve a dot-path like "hero.title" against a data object
function resolvePath(obj, dotPath) {
  if (dotPath === '.') return obj;
  return dotPath.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

// Template engine: {{var}} (escaped), {{{var}}} (raw), {{#list}}…{{/list}},
// {{^list}}…{{/list}} (inverted: renders when empty/falsy), {{> partial}}.
// Single pass: inserted values are never re-scanned for tags.
const TAG_RE_SRC = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*(#|\^|>)?\s*([\w./-]+)\s*\}\}/g;

function render(template, data) {
  const TAG_RE = new RegExp(TAG_RE_SRC.source, 'g'); // fresh per call: render() recurses
  let out = '';
  let pos = 0;
  let m;
  while ((m = TAG_RE.exec(template))) {
    out += template.slice(pos, m.index);
    pos = TAG_RE.lastIndex;

    const [, rawPath, sigil, name] = m;

    if (rawPath !== undefined) {                      // {{{raw}}}
      out += resolvePath(data, rawPath) ?? '';
    } else if (sigil === '>') {                       // {{> partial}}
      out += render(loadPartial(name), data);
    } else if (sigil === '#' || sigil === '^') {      // sections
      const close = `{{/${name}}}`;
      const end = findSectionEnd(template, pos, name);
      if (end < 0) { fail(`Unclosed section {{${sigil}${name}}}`); break; }
      const inner = template.slice(pos, end);
      pos = end + close.length;
      TAG_RE.lastIndex = pos;

      const value = resolvePath(data, name);
      const isList = Array.isArray(value);
      const truthy = isList ? value.length > 0 : !!value;
      if (sigil === '#') {
        if (isList) out += value.map(item => render(inner, { ...data, ...(item && typeof item === 'object' ? item : { '.': item }) })).join('');
        else if (truthy) out += render(inner, data);
      } else if (!truthy) {
        out += render(inner, data);
      }
    } else {                                          // {{escaped}}
      const value = resolvePath(data, name);
      out += /(^|_)url$/.test(name) ? escapeHtml(safeUrl(value)) : escapeHtml(value);
    }
  }
  return out + template.slice(pos);
}

// Find matching {{/name}} accounting for nested sections of the same name
function findSectionEnd(template, from, name) {
  const open = new RegExp(`\\{\\{[#^]\\s*${name.replace(/[.]/g, '\\.')}\\s*\\}\\}`, 'g');
  const close = new RegExp(`\\{\\{/\\s*${name.replace(/[.]/g, '\\.')}\\s*\\}\\}`, 'g');
  let depth = 1, idx = from;
  while (depth > 0) {
    open.lastIndex = close.lastIndex = idx;
    const o = open.exec(template), c = close.exec(template);
    if (!c) return -1;
    if (o && o.index < c.index) { depth++; idx = open.lastIndex; }
    else { depth--; idx = close.lastIndex; if (depth === 0) return c.index; }
  }
  return -1;
}

const partialCache = {};
function loadPartial(name) {
  if (!(name in partialCache)) {
    const p = path.join(PARTIALS, `${name}.html`);
    if (!fs.existsSync(p)) { fail(`Partial not found: ${name}`); partialCache[name] = ''; }
    else partialCache[name] = fs.readFileSync(p, 'utf8');
  }
  return partialCache[name];
}

// ── Load & validate everything before touching dist/ ────────────────────────

const content = {};
for (const file of fs.readdirSync(CONTENT)) {
  if (!file.endsWith('.json')) continue;
  const filePath = path.join(CONTENT, file);
  try {
    content[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`Invalid JSON in content/${file}: ${err.message}`);
  }
}

const templates = {};
for (const { template, content: names } of PAGES) {
  const templatePath = path.join(TEMPLATES, template);
  if (!fs.existsSync(templatePath)) { fail(`Template not found: ${template}`); continue; }
  templates[template] = fs.readFileSync(templatePath, 'utf8');
  for (const name of names) {
    if (!(name in content)) fail(`${template} needs content/${name}.json, which is missing`);
  }
}

if (errors.length) {
  console.error(`\nBuild aborted: ${errors.length} error(s). dist/ left untouched.`);
  process.exit(1);
}

// ── Derived content ──────────────────────────────────────────────────────────
// The homepage's featured statement is always the newest in statements.json (not stored twice).
// Homepage `press` stays hand-curated in homepage.json (it mixes articles and videos).
if (content.homepage) {
  content.homepage.statements = (content.statements?.statements || []).slice(0, 1)
    .map(({ slug, date, title, snippet }) => ({ slug, date, title, snippet }));
}

// ── Render ───────────────────────────────────────────────────────────────────

const outputs = {};
for (const { template, content: names } of PAGES) {
  const page = template.replace(/\.html$/, '');
  const data = Object.assign(
    { page, is_home: page === 'index', current: { [page]: true } }, // used by partials for nav state
    ...names.map(n => content[n])
  );

  for (const [arrayKey, field] of Object.entries(MARKDOWN_FIELDS)) {
    if (Array.isArray(data[arrayKey])) {
      data[arrayKey] = data[arrayKey].map(item => ({ ...item, [field]: mdToHtml(item[field]) }));
    }
  }

  outputs[template] = render(templates[template], data);
}

if (errors.length) {
  console.error(`\nBuild aborted: ${errors.length} error(s). dist/ left untouched.`);
  process.exit(1);
}

// ── Sitemap ──────────────────────────────────────────────────────────────────

function lastmod(page) {
  const files = [path.join(TEMPLATES, page.template), ...page.content.map(n => path.join(CONTENT, `${n}.json`))];
  const newest = Math.max(...files.filter(fs.existsSync).map(f => fs.statSync(f).mtimeMs));
  return new Date(newest).toISOString().slice(0, 10);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schema/sitemap/0.9">
${PAGES.filter(p => p.sitemap !== false).map(p => {
  const loc = p.template === 'index.html' ? `${SITE_URL}/` : `${SITE_URL}/${p.template}`;
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod(p)}</lastmod>\n    <priority>${p.priority || '0.7'}</priority>\n  </url>`;
}).join('\n')}
</urlset>
`;

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

for (const [template, html] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(DIST, template), html, 'utf8');
  console.log(`Built: ${template}`);
}
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap, 'utf8');

console.log('Build complete → dist/');
