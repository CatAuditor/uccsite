// Template engine ported line-for-line from build.js (the original hand-rolled
// zero-dependency engine). Pure: no fs, no globals. Behavior is locked by the
// Phase 1 golden-file tests — do not "improve" semantics here.
//
// Syntax: {{var}} (HTML-escaped; names matching /(^|_)url$/ also pass through
// safeUrl), {{{var}}} (raw), {{#sec}}…{{/sec}} (list iterate / truthy once),
// {{^sec}}…{{/sec}} (inverted), {{> partial}}, dot-paths, {{.}} = whole scope.
// Single pass: inserted values are never re-scanned for tags.
'use strict';

// Escape HTML special chars for {{var}} interpolation
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http(s), relative, mailto links in hrefs sourced from content
function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^(https?:|mailto:|\/|#)/i.test(u) && !/[\s"'<>]/.test(u)) return u;
  return '#';
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

// Resolve a dot-path like "hero.title" against a data object
function resolvePath(obj, dotPath) {
  if (dotPath === '.') return obj;
  return dotPath.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

const TAG_RE_SRC = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*(#|\^|>)?\s*([\w./-]+)\s*\}\}/g;

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

// render(template, data, partials, fail)
//   partials: { name → template string }
//   fail(msg): error collector — called for unclosed sections / missing partials,
//   matching build.js's fail-fast error accumulation.
function render(template, data, partials, fail) {
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
      let partial = partials[name];
      if (partial === undefined) { fail(`Partial not found: ${name}`); partial = ''; }
      out += render(partial, data, partials, fail);
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
        if (isList) out += value.map(item => render(inner, { ...data, ...(item && typeof item === 'object' ? item : { '.': item }) }, partials, fail)).join('');
        else if (truthy) out += render(inner, data, partials, fail);
      } else if (!truthy) {
        out += render(inner, data, partials, fail);
      }
    } else {                                          // {{escaped}}
      const value = resolvePath(data, name);
      out += /(^|_)url$/.test(name) ? escapeHtml(safeUrl(value)) : escapeHtml(value);
    }
  }
  return out + template.slice(pos);
}

module.exports = { escapeHtml, safeUrl, mdToHtml, resolvePath, render, findSectionEnd, TAG_RE_SRC };
