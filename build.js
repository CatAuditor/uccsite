#!/usr/bin/env node
// Build script: merges content JSON into HTML templates → dist/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const TEMPLATES = path.join(ROOT, 'templates');
const CONTENT = path.join(ROOT, 'content');
const STATIC = path.join(ROOT, 'static');

// Static files and directories to copy from root into dist/
const COPY_FROM_ROOT = ['css', 'js', 'assets', '_headers', 'robots.txt', 'sitemap.xml', 'llms.txt', 'favicon.svg', 'torch.svg', 'UCC.png', 'tip.html'];

// Templates → content file mapping
const PAGES = [
  { template: 'index.html',   content: ['settings', 'homepage'] },
  { template: 'team.html',    content: ['settings', 'team'] },
  { template: 'blog.html',    content: ['settings', 'blog'] },
  { template: 'stratos.html', content: ['settings'] },
  { template: 'theory.html',  content: ['settings'] },
  { template: 'success.html', content: ['settings'] },
];

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

// Convert markdown paragraphs to HTML <p> tags (handles **bold** and *italic*)
function mdToHtml(md) {
  if (!md) return '';
  return md.trim().split(/\n{2,}/).map(p => {
    const html = p.trim()
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br />');
    return `<p>${html}</p>`;
  }).join('\n');
}

// Resolve a dot-path like "hero.title" against a data object
function resolvePath(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

// Escape HTML special chars for {{var}} interpolation
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Minimal template engine: supports {{var}}, {{{var}}}, {{#list}}...{{/list}}
// Nested paths (e.g. {{hero.title}}) are supported.
function render(template, data) {
  // Loops: {{#key}}...{{/key}}
  template = template.replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, path, inner) => {
    const arr = resolvePath(data, path);
    if (!Array.isArray(arr)) return '';
    return arr.map(item => render(inner, { ...data, ...item })).join('');
  });
  // Raw HTML: {{{var}}}
  template = template.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, path) => {
    return resolvePath(data, path) ?? '';
  });
  // Escaped: {{var}}
  template = template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    return escapeHtml(resolvePath(data, path));
  });
  return template;
}

// ── Main build ───────────────────────────────────────────────────────────────

// Clean and recreate dist/
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);

// Copy static assets from root
for (const item of COPY_FROM_ROOT) {
  copyRecursive(path.join(ROOT, item), path.join(DIST, item));
}

// Copy static/ directory (admin UI etc.) → dist/
if (fs.existsSync(STATIC)) {
  for (const entry of fs.readdirSync(STATIC)) {
    copyRecursive(path.join(STATIC, entry), path.join(DIST, entry));
  }
}

// Build each page
for (const { template, content: contentFiles } of PAGES) {
  const templatePath = path.join(TEMPLATES, template);
  if (!fs.existsSync(templatePath)) {
    console.warn(`Template not found: ${template}`);
    continue;
  }

  // Merge content files into one data object
  const data = {};
  for (const name of contentFiles) {
    const filePath = path.join(CONTENT, `${name}.json`);
    if (fs.existsSync(filePath)) {
      Object.assign(data, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    }
  }

  // Convert markdown bio fields to HTML before rendering
  if (Array.isArray(data.members)) {
    data.members = data.members.map(m => ({ ...m, bio: mdToHtml(m.bio) }));
  }

  const html = render(fs.readFileSync(templatePath, 'utf8'), data);
  fs.writeFileSync(path.join(DIST, template), html, 'utf8');
  console.log(`Built: ${template}`);
}

console.log('Build complete → dist/');
