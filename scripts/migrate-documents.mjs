#!/usr/bin/env node
// migrate-documents.mjs — turn the eight long-form templates into Documents
// (spec §3.2, planning addendum 3): head → structured SEO fields, the inline
// <style> block → page_css, the body between {{> header}} and {{> footer}} →
// body_html_raw (coverage loops become {{coverage:key}} tokens; inline style
// attributes become page-css classes because the sanitizer strips them).
//
// Then it PROVES the port: every document is composed through the real
// publish path (packages/render/documents.js) and compared with the
// template-rendered page — same title/description/canonical/og/h1, same
// visible text, same headings, same links. Differences are printed; --apply
// refuses on any hard difference.
//
// Usage: node scripts/migrate-documents.mjs              (dry run, prints report)
//        $env:AWS_PROFILE='uccsite'; node scripts/migrate-documents.mjs --env staging --apply
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { buildSite, PAGES, documents: docs } = require('@uccsite/render');
const { loadRenderInputs } = require('../aws/publish/inputs.js');
const { parseFragmentTree, walkElements } = require('@uccsite/html-ingest');

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT = argValue(args, '--out', join(ROOT, 'docs', 'migration', 'documents'));

// slug → { category, priority } (planning addendum 3 grouping).
const DOCS = {
  'alpr': { category: 'Reports', priority: '0.9' },
  'stratos': { category: 'Reports' },
  'weber-county': { category: 'Reports' },
  'privacy-report': { category: 'Reports' },
  'how-did-this-happen': { category: 'Reports' },
  'dignity-index-statement': { category: 'Reports' },
  'theory': { category: 'Whitepapers' },
  'privacy': { category: 'Legal', priority: '0.3' },
};

const meta = (head, re) => { const m = head.match(re); return m ? decode(m[1]) : ''; };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function extract(slug, template) {
  const head = template.slice(0, template.indexOf('</head>'));
  const styleBlocks = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  let css = styleBlocks.join('\n').replace(/^\n+/, '').replace(/^    /gm, '');
  const start = template.indexOf('{{> header}}') + '{{> header}}'.length;
  const end = template.indexOf('{{> footer}}');
  let body = template.slice(start, end).trim();

  // Coverage loops → token (the strip is rendered from the collection at compose).
  body = body.replace(/<div class="coverage-list">\s*\{\{#([a-z]+)_coverage\}\}[\s\S]*?\{\{\/\1_coverage\}\}\s*<\/div>/g,
    (_, key) => `{{coverage:${key}}}`);
  // Inline style attributes → generated page-css classes (sanitizer strips style=).
  const inline = new Map();
  body = body.replace(/<([a-z0-9]+)([^>]*?)\sstyle="([^"]*)"([^>]*)>/g, (m, tag, before, style, after) => {
    const cls = 's-' + createHash('sha256').update(style).digest('hex').slice(0, 6);
    inline.set(cls, style.trim().replace(/;\s*$/, ''));
    const hasClass = /\sclass="/.test(before + after);
    const attrs = hasClass
      ? (before + after).replace(/\sclass="([^"]*)"/, (_, c) => ` class="${c} ${cls}"`)
      : `${before} class="${cls}"${after}`;
    return `<${tag}${attrs}>`;
  });
  if (inline.size) css += '\n/* migrated inline style attributes */\n' + [...inline].map(([c, s]) => `.${c} { ${s}; }`).join('\n') + '\n';
  // Per-page structural fixes the accessibility gate requires (§5.7): the
  // heading level is corrected and the old level's styling is carried over
  // by a class so the page looks the same.
  if (slug === 'weber-county') {
    const before = body;
    body = body.replace('<h3>The Core Problem</h3>', '<h2 class="as-h3">The Core Problem</h2>');
    if (body === before) throw new Error('weber-county: expected heading not found');
    const rule = css.match(/\.briefing-inner h3 \{[^}]*\}/);
    if (!rule) throw new Error('weber-county: .briefing-inner h3 rule not found');
    css += '\n/* heading-skip fix: h3 -> h2 keeps the h3 look */\n' + rule[0].replace('.briefing-inner h3', '.briefing-inner h2.as-h3') + '\n';
  }
  if (/\{\{[#^>/]/.test(body) || /\{\{\{?[a-zA-Z_.]+\}?\}\}/.test(body.replace(/\{\{(coverage|video):[^}]+\}\}/g, ''))) {
    throw new Error(`${slug}: body still contains template tags — extend the migration`);
  }

  const jsonldRaw = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let jsonldType = '', jsonldOverrides = null;
  if (jsonldRaw) {
    const j = JSON.parse(jsonldRaw[1]);
    jsonldType = j['@type'];
    const { '@context': _c, '@type': _t, ...rest } = j;
    jsonldOverrides = rest; // everything the base block doesn't generate, verbatim
  }
  const title = meta(head, /<title>([^<]*)<\/title>/);
  return {
    slug, title: title.replace(/\s*\|\s*Utah Civic Compact$/, ''), category: DOCS[slug].category,
    templateKey: 'report', status: 'published', sortOrder: Object.keys(DOCS).indexOf(slug),
    bodyHtmlRaw: body + '\n', bodyHtmlNormalized: null, ingestReport: null, pageCss: css,
    metaTitle: title,
    metaDescription: meta(head, /<meta name="description" content="([^"]*)"/),
    metaKeywords: meta(head, /<meta name="keywords" content="([^"]*)"/),
    canonicalUrl: meta(head, /<link rel="canonical" href="([^"]*)"/),
    ogType: meta(head, /<meta property="og:type" content="([^"]*)"/),
    ogTitle: meta(head, /<meta property="og:title" content="([^"]*)"/),
    ogDescription: meta(head, /<meta property="og:description" content="([^"]*)"/),
    ogImage: meta(head, /<meta property="og:image" content="([^"]*)"/),
    twitterCard: meta(head, /<meta name="twitter:card" content="([^"]*)"/),
    noindex: /<meta name="robots" content="[^"]*noindex/.test(head) ? 1 : 0,
    nofollow: /<meta name="robots" content="[^"]*nofollow/.test(head) ? 1 : 0,
    jsonldType, jsonldOverrides, allowScripts: 0, sitemapPriority: DOCS[slug].priority || '',
  };
}

// ── Comparison helpers ──────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return e in ENT ? ENT[e] : m;
});
const text = (html) => decodeEntities(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const canonJson = (s) => { try { const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v; return JSON.stringify(sort(JSON.parse(s))); } catch { return s; } };
const grab = (html, re) => [...html.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))].map(m => m[1]);
function summarize(html) {
  const bodyStart = html.indexOf('<main'); const bodyEnd = html.lastIndexOf('</main>');
  const main = html.slice(bodyStart, bodyEnd);
  return {
    title: grab(html, /<title>([^<]*)<\/title>/)[0],
    description: decodeEntities(grab(html, /<meta name="description" content="([^"]*)"/)[0] || ''),
    canonical: grab(html, /<link rel="canonical" href="([^"]*)"/)[0],
    ogTitle: grab(html, /<meta property="og:title" content="([^"]*)"/)[0],
    ogDescription: decodeEntities(grab(html, /<meta property="og:description" content="([^"]*)"/)[0] || ''),
    ogImage: grab(html, /<meta property="og:image" content="([^"]*)"/)[0],
    twitterCard: grab(html, /<meta name="twitter:card" content="([^"]*)"/)[0],
    jsonld: canonJson(grab(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[0] || ''),
    headings: grab(main, /<(h[1-6])[^>]*>/g).join(' '),
    h1: text(grab(main, /<h1[^>]*>([\s\S]*?)<\/h1>/)[0] || ''),
    links: grab(main, /<a\s[^>]*href="([^"]*)"/g).sort().join('\n'),
    text: text(main),
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────
const fail = (m) => { throw new Error(m); };
const inputs = loadRenderInputs(ROOT, fail);
const siteCss = readFileSync(join(ROOT, 'css', 'styles.css'), 'utf8');
const lastmod = () => '2026-01-01';
const { files: oldFiles, errors: oldErrors } = buildSite({ ...inputs, lastmod });
if (oldErrors.length) fail(oldErrors.join('\n'));

const documents = Object.keys(DOCS).map(slug => extract(slug, inputs.templates[`${slug}.html`]));
const built = docs.buildDocuments({
  documents, shells: inputs.shells, partials: inputs.partials, settings: inputs.content.settings,
  siteUrl: 'https://utahciviccompact.org', siteCss, rules: [], overrides: [], foreignClassMaps: {},
  coverage: inputs.content.coverage,
});
mkdirSync(OUT, { recursive: true });
let hard = 0;
for (const doc of documents) {
  const composed = built.files[`${doc.slug}.html`];
  const errs = built.errors.filter(e => e.startsWith(`document ${doc.slug}:`));
  const report = { slug: doc.slug, errors: errs, ingest: null, diffs: [] };
  if (composed) {
    const a = summarize(oldFiles[`${doc.slug}.html`]);
    const b = summarize(composed);
    for (const k of Object.keys(a)) {
      if (a[k] !== b[k]) {
        // Expected: metadata the old page lacked (the generated head fills the
        // §12 fallback chain) and the weber-county heading-level fix.
        const expected = (!a[k] && b[k])
          || (doc.slug === 'weber-county' && k === 'headings' && a[k] === 'h1 h3' && b[k] === 'h1 h2');
        report.diffs.push({ field: k, expected, old: String(a[k]).slice(0, 300), new: String(b[k]).slice(0, 300) });
        if (!expected && !['jsonld'].includes(k)) hard++;
      }
    }
    // Text: report the first divergence point so it's diagnosable.
    if (a.text !== b.text) {
      let i = 0; while (i < a.text.length && a.text[i] === b.text[i]) i++;
      report.textDivergence = { at: i, old: a.text.slice(Math.max(0, i - 60), i + 120), new: b.text.slice(Math.max(0, i - 60), i + 120) };
      hard++;
    }
  } else hard++;
  const ingested = docs.composeDocument({ doc, shell: inputs.shells.report, partials: inputs.partials, settings: inputs.content.settings, siteUrl: 'https://utahciviccompact.org', siteCss, coverage: inputs.content.coverage }).ingestResult;
  report.ingest = { removed: ingested.report.removed, foreignClasses: ingested.report.foreignClasses.slice(0, 20), warnings: ingested.report.warnings, a11y: ingested.report.a11y, ok: ingested.ok };
  // Store the ingest result too (the editor's tree/preview read body_html_normalized;
  // without it a migrated document looks empty until its first save).
  doc.bodyHtmlNormalized = ingested.bodyHtmlNormalized;
  doc.ingestReport = ingested.report;
  writeFileSync(join(OUT, `${doc.slug}.report.json`), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(OUT, `${doc.slug}.document.json`), JSON.stringify(doc, null, 2) + '\n');
  const unexpected = report.diffs.filter(d => !d.expected);
  const flag = errs.length || unexpected.length ? 'DIFF' : 'ok  ';
  console.log(`${flag} ${doc.slug}: errors=${errs.length} diffs=${report.diffs.map(d => d.field + (d.expected ? '(expected)' : '')).join(',') || '-'} removed=${report.ingest.removed.length} foreign=${ingested.report.foreignClasses.length} a11y=${ingested.report.a11y.length}`);
}
console.log(`\nReports in ${OUT}. Hard differences: ${hard}`);

if (APPLY) {
  if (hard) { console.error('Refusing to apply with hard differences.'); process.exit(1); }
  const envName = argValue(args, '--env', 'staging');
  const { withConnection } = require('../packages/db');
  const { upsertDocument, getDocument } = require('../packages/db/documents');
  const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
  await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
    for (const doc of documents) {
      const existing = await getDocument(client, { slug: doc.slug });
      const id = await upsertDocument(client, { ...doc, id: existing?.id });
      console.log(`${existing ? 'updated' : 'inserted'} ${doc.slug} (${id})`);
    }
  });
  console.log(`Documents written to ${stackName}.`);
}
