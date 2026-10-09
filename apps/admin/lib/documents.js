// Documents editor server helpers (spec §5, §6.5, §12). Everything here runs
// on the server: ingest on save, the element tree (explainStyles), the live
// preview compose, rule match counts, and the Style Kit catalog parsed from
// the LIVE site stylesheet (read from the site bucket, so the admin sees the
// vocabulary that is actually published, locally and on Amplify alike).
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ingest, stripNids } from '@uccsite/html-ingest';
import { applyStyles, explainStyles, validateSelector, matchCountTree, rootedTree, orphanedOverrides } from '@uccsite/style-apply';
import { parseStyleKit, classNames } from '@uccsite/style-kit';
import { documents as compose, SITE_URL, memberSlug } from '@uccsite/render';
import { serialize as serializeBlocks, sampleHtml, BLOCK_TYPES, fullWidth, validateBody } from '@uccsite/doc-blocks';
import {
  listDocuments, getDocument, listStyleRules, listOverrides, loadForeignClassMap,
} from '@uccsite/db/documents';
import { loadSettings, list } from '@uccsite/db/content';
import { config } from './config';
import { listProjects } from './files';

let s3 = null;
const getS3 = () => (s3 ??= new S3Client({ region: config.region }));

// Site sources the editor needs: the live stylesheet + partials + shells.
// Cached for the process lifetime (a publish changes them rarely; restart the
// admin or wait for a new instance to pick up a new stylesheet).
const cache = { at: 0, siteCss: '', partials: null, shells: null, repoCss: '', siteCssStale: false };
const SITE_SRC_TTL_MS = 5 * 60 * 1000;

// siteCssDrift(sources) → null | string. The live stylesheet only changes
// after a cdk deploy of the site stack AND a publish; until then classes
// added in the repo do not exist for documents (the ingest strips them) and
// the kit cannot list them. Surfaced on the Documents editor, the Styles
// page and in the kit (docs/error-handling/client-side-error/
// 2026-10-06-kit-classes-stripped-stale-bucket-css.md).
export function siteCssDrift(sources) {
  if (!sources?.siteCssStale) return null;
  return `The live site stylesheet (${sources.siteCss.length.toLocaleString()} characters) differs from the stylesheet in this admin build (${sources.repoCss.length.toLocaleString()} characters). Classes added in the repo do not exist for documents until the site stack is redeployed (cdk deploy) and a publish runs; until then the editor strips them on save and the authoring kit cannot list them.`;
}

async function getObjectText(key) {
  const res = await getS3().send(new GetObjectCommand({ Bucket: config.siteBucket, Key: key }));
  return res.Body.transformToString('utf8');
}

// loadSiteSources() → { siteCss, partials, shells }. Partials and shells are
// bundled with the admin (they are repo files, developer-owned) — read once.
export async function loadSiteSources() {
  if (Date.now() - cache.at < SITE_SRC_TTL_MS && cache.partials) return cache;
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const readDir = (dir) => {
    const out = {};
    if (!existsSync(dir)) return out;
    for (const f of readdirSync(dir)) if (f.endsWith('.html')) out[f.replace(/\.html$/, '')] = readFileSync(join(dir, f), 'utf8');
    return out;
  };
  const root = config.siteSrcRoot;
  cache.partials = readDir(join(root, 'templates', 'partials'));
  cache.shells = readDir(join(root, 'templates', 'documents'));
  cache.repoCss = existsSync(join(root, 'css', 'styles.css')) ? readFileSync(join(root, 'css', 'styles.css'), 'utf8') : '';
  try {
    cache.siteCss = await getObjectText('css/styles.css');
  } catch (err) {
    console.warn(`[documents] could not read css/styles.css from the site bucket (${err.name}); falling back to the repo copy`);
    cache.siteCss = cache.repoCss;
  }
  // Compare without line endings: the Amplify checkout may be CRLF, the bucket LF.
  const norm = (s) => String(s || '').replace(/\r\n?/g, '\n').trim();
  cache.siteCssStale = Boolean(cache.repoCss) && norm(cache.siteCss) !== norm(cache.repoCss);
  if (cache.siteCssStale) console.warn(`[documents] live css/styles.css (${cache.siteCss.length} chars) differs from the admin build's repo copy (${cache.repoCss.length} chars): deploy + publish pending`);
  cache.at = Date.now();
  return cache;
}

// styleKitFor(siteCss, pageCss) → { entries, undocumented, known: Set }
export function styleKitFor(siteCss, pageCss) {
  const site = parseStyleKit(siteCss || '');
  const page = parseStyleKit(pageCss || '');
  const entries = [
    ...site.entries.map(e => ({ ...e, group: e.group || 'Site stylesheet' })),
    ...page.entries.filter(e => !site.entries.some(s => s.className === e.className)).map(e => ({ ...e, group: 'This page' })),
  ];
  return { entries, undocumented: site.undocumented, known: new Set(entries.map(e => e.className)) };
}

// runIngest(doc, { siteCss, foreignClassMap }) → ingest result for the doc's raw body.
export function runIngest(doc, { siteCss, foreignClassMap }) {
  return ingest(doc.bodyHtmlRaw || '', {
    knownClasses: styleKitFor(siteCss, doc.pageCss).known,
    foreignClassMap,
    previousNormalized: doc.bodyHtmlNormalized || null,
    allowScripts: Boolean(doc.allowScripts),
  });
}

// editorData(client, id) → everything the editor page renders.
export async function editorData(client, id) {
  const doc = await getDocument(client, { id });
  if (!doc) return null;
  // Sequential on purpose: one pg Client cannot run queries concurrently
  // (pg 8 queues them with a deprecation warning; pg 9 removes the queue).
  const rules = await listStyleRules(client);
  const overrides = await listOverrides(client, id);
  const foreignClassMap = await loadForeignClassMap(client, doc.templateKey);
  const settings = await loadSettings(client);
  const projects = await listProjects(client); // the Project chooser (docs/systems/projects.md "Nesting")
  const sources = await loadSiteSources();
  const kit = styleKitFor(sources.siteCss, doc.pageCss);
  const docRules = compose.rulesFor(doc, rules);
  const normalized = doc.bodyHtmlNormalized || '';
  const rows = normalized ? explainStyles(normalized, docRules, overrides) : [];
  const orphans = normalized ? orphanedOverrides(normalized, overrides) : [];
  const coverage = {
    alpr_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['alpr']),
    stratos_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['stratos']),
  };
  const preview = normalized ? previewSrcdoc({ doc, normalized, sources, settings, docRules, overrides, coverage }) : '';
  return {
    doc, rules: docRules, allRules: rules, overrides, orphans, kit, rows, preview, projects,
    unstyledCount: rows.filter(r => r.unstyled).length,
    foreignClassMap,
    siteCssDrift: siteCssDrift(sources),
    // Builder (docs/systems/document-builder.md): the picker gallery and the
    // choices the block editors offer.
    gallery: blockGallery(sources),
    coverageKeys: (await client.query('SELECT DISTINCT report_key FROM coverage_entries ORDER BY report_key')).rows.map(r => r.report_key),
    publishedFiles: (await client.query(`SELECT original_filename, public_key, project_slug FROM project_files WHERE public_key IS NOT NULL ORDER BY original_filename`)).rows
      .map(r => ({ label: `${r.original_filename}${r.project_slug ? ` (${r.project_slug})` : ''}`, href: `/${r.public_key}` })),
    authorHref: await authorHrefFor(client, doc.author),
  };
}

// previewSrcdoc(...) → the real composed page with nids KEPT (the tree ↔
// preview link needs them), stylesheets inlined (the bucket is private on
// staging), and a <base> so the site's absolute /assets and /css paths resolve.
export function previewSrcdoc({ doc, normalized, sources, settings, docRules, overrides, coverage }) {
  const styled = applyStyles(normalized, docRules, overrides);
  const withTokens = compose.replaceTokens(styled, { partials: sources.partials, coverage, fail: () => {} });
  const composed = compose.composeDocument({
    doc, shell: sources.shells[doc.templateKey] || sources.shells.report, partials: sources.partials,
    settings, siteUrl: SITE_URL, siteCss: sources.siteCss, rules: docRules, overrides, coverage,
  });
  // Replacer FUNCTIONS: author-controlled CSS/HTML must not be interpreted
  // as $-patterns by String.prototype.replace.
  return composed.html
    .replace(/<main id="main">[\s\S]*<\/main>/, () => `<main id="main">\n${withTokens}\n</main>`)
    .replace('<link rel="stylesheet" href="/css/fonts.css" />', () => `<link rel="stylesheet" href="${config.publicOrigin}/css/fonts.css" />`)
    .replace('<link rel="stylesheet" href="/css/styles.css" />', () => cssTag(sources.siteCss))
    .replace(/<link rel="stylesheet" href="\/css\/pages\/[^"]+" \/>/, () => cssTag(doc.pageCss))
    .replace('<head>', () => `<head><base href="${config.publicOrigin}/" />`)
    .replace('</body>', () => `${PREVIEW_SCRIPT}</body>`);
}
const cssTag = (css) => `<style>${String(css || '').replace(/<\/style/gi, '<\\/style')}</style>`;

// authorHrefFor(client, name) → '/team/<slug>' when the author is a team
// member (the byline links to the author page), else ''.
export async function authorHrefFor(client, name) {
  const n = String(name || '').trim();
  if (!n) return '';
  const r = (await client.query('SELECT name, slug FROM team_members WHERE name = $1 LIMIT 1', [n])).rows[0];
  return r ? `/team/${memberSlug(r)}` : '';
}

// blocksToRaw(client, body, { title, author }) → { body, html } — validates
// the builder JSON and serializes it to body_html_raw (the save path).
export async function blocksToRaw(client, input, { title, author }) {
  const { ok, errors, body } = validateBody(input);
  if (!ok) throw new Error(`Blocks: ${errors.join('; ')}`);
  const authorHref = await authorHrefFor(client, author);
  return { body, html: serializeBlocks(body, { title, author }, { authorHref }) };
}

// previewBlocksFor(client, { id, body, title, author }) → { html, report }:
// the live preview while editing (nothing stored): serialize → ingest →
// rules/overrides → compose, exactly what a save would publish.
export async function previewBlocksFor(client, { id, body: input, title, author }) {
  const doc = await getDocument(client, { id });
  if (!doc) throw new Error('Document not found');
  const { html } = await blocksToRaw(client, input, { title, author });
  const rules = await listStyleRules(client);
  const overrides = await listOverrides(client, id);
  const foreignClassMap = await loadForeignClassMap(client, doc.templateKey);
  const settings = await loadSettings(client);
  const sources = await loadSiteSources();
  const next = { ...doc, title: title || doc.title, author, bodyHtmlRaw: html };
  const result = runIngest(next, { siteCss: sources.siteCss, foreignClassMap });
  const coverage = {
    alpr_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['alpr']),
    stratos_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['stratos']),
  };
  const srcdoc = previewSrcdoc({ doc: next, normalized: result.bodyHtmlNormalized, sources, settings, docRules: compose.rulesFor(next, rules), overrides, coverage });
  return { html: srcdoc, report: result.report };
}

// blockGallery(sources) → srcdoc for the block picker: every block type that
// has a sample, rendered with the live site CSS inside the document frame,
// labelled, clickable (posts { ucc: 'pick', type }); the picker scrolls it
// to a type with { ucc: 'show', type }.
export function blockGallery(sources) {
  const items = Object.entries(BLOCK_TYPES).filter(([, d]) => d.sample).map(([type, d]) => {
    const html = sampleHtml(type);
    const inner = fullWidth({ type, ...d.sample }) ? html : `<div class="doc-body"><div class="doc-inner">${html}</div></div>`;
    return `<section class="g-item" data-type="${type}"><h4 class="g-label">${escapeAttr(d.label)}<span>${escapeAttr(d.description)}</span></h4>${inner}</section>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><base href="${config.publicOrigin}/" />
<link rel="stylesheet" href="${config.publicOrigin}/css/fonts.css" />${cssTag(sources.siteCss)}
<style>body{background:#eef0f3;margin:0;padding:12px 16px 40px}.g-item{margin:0 0 20px;border-radius:10px;overflow:hidden;cursor:pointer;outline:2px solid transparent;transition:outline-color .15s}.g-item:hover,.g-item.on{outline-color:#C0392B}.g-label{font:600 13px/1.4 Inter,system-ui,sans-serif;color:#1B2F4E;margin:0;padding:8px 12px;background:#fff;border-bottom:1px solid #E5E7EB}.g-label span{display:block;font-weight:400;color:#4B5563;font-size:12px}.g-item .doc-body{padding:28px 24px}.g-item .parts-nav{margin:0}a{pointer-events:none}</style></head>
<body>${items}
<script>(function(){document.addEventListener('click',function(e){var s=e.target.closest('.g-item');if(!s)return;e.preventDefault();parent.postMessage({ucc:'pick',type:s.getAttribute('data-type')},'*');});window.addEventListener('message',function(e){if(!e.data||e.data.ucc!=='show')return;document.querySelectorAll('.g-item.on').forEach(function(x){x.classList.remove('on')});var s=document.querySelector('.g-item[data-type="'+e.data.type+'"]');if(s){s.classList.add('on');s.scrollIntoView({block:'start',behavior:'smooth'});}});})();</script>
</body></html>`;
}
const escapeAttr = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Injected into the preview srcdoc: click → select row (Styling tab) and
// select block (builder); hover messages → outline by nid or by block id.
const PREVIEW_SCRIPT = `<script>
(function(){
  var last=[];
  function outline(sel){ last.forEach(function(el){el.style.outline='';el.style.outlineOffset='';}); last=[]; if(!sel) return; var els=document.querySelectorAll(sel); els.forEach(function(el){ el.style.outline='2px solid #c8a84b'; el.style.outlineOffset='4px'; last.push(el); }); if(els[0]) els[0].scrollIntoView({block:'nearest'}); }
  document.addEventListener('click', function(e){ var a=e.target.closest('a'); if(a) e.preventDefault(); var b=e.target.closest('[data-block],[data-section]'); if(b) parent.postMessage({ucc:'block', id: b.getAttribute('data-block')||b.getAttribute('data-section')}, '*'); var el=e.target.closest('[data-nid]'); if(!el) return; e.preventDefault(); parent.postMessage({ucc:'select', nid: el.getAttribute('data-nid')}, '*'); });
  window.addEventListener('message', function(e){ if(!e.data) return; if(e.data.ucc==='hover') outline(e.data.nid ? '[data-nid="'+e.data.nid+'"]' : null); if(e.data.ucc==='hoverBlock') outline(e.data.id ? '[data-block="'+e.data.id+'"],[data-section="'+e.data.id+'"]' : null); if(e.data.ucc==='scrollTo') window.scrollTo(0, e.data.y||0); });
  var t=null; window.addEventListener('scroll', function(){ clearTimeout(t); t=setTimeout(function(){ parent.postMessage({ucc:'scroll', y: window.scrollY}, '*'); }, 80); });
})();
</script>`;

// parsedDocuments(client) → [{ id, slug, templateKey, rooted }] — every
// document parsed ONCE; pass to ruleMatchCounts for many rules.
export async function parsedDocuments(client) {
  return (await listDocuments(client)).map(d => ({
    id: d.id, slug: d.slug, templateKey: d.templateKey, pageCss: d.pageCss,
    rooted: d.bodyHtmlNormalized ? rootedTree(d.bodyHtmlNormalized) : null,
  }));
}

// ruleMatchCounts(client, rule, parsed?) → { total, perDocument: [{slug, count}] }
// across every document that the rule would apply to.
export async function ruleMatchCounts(client, rule, parsed) {
  const v = validateSelector(rule.selector);
  if (!v.ok) return { error: v.reason, total: 0, perDocument: [] };
  const all = parsed || await parsedDocuments(client);
  const docs = rule.scope === 'page' ? all.filter(d => d.id === rule.documentId) : all.filter(d => d.templateKey === rule.templateKey);
  const perDocument = docs.map(d => ({ slug: d.slug, count: d.rooted ? matchCountTree(d.rooted, rule.selector) : 0 }));
  return { total: perDocument.reduce((n, d) => n + d.count, 0), perDocument };
}

// tokenErrors(client, normalizedHtml, sources) → [message] — the same token
// expansion the publish path runs, with every coverage key that exists, so a
// save can refuse to publish a document whose tokens would fail the run.
export async function tokenErrors(client, normalizedHtml, sources) {
  const keys = (await client.query('SELECT DISTINCT report_key FROM coverage_entries')).rows.map(r => r.report_key);
  const coverage = Object.fromEntries(keys.map(k => [`${k}_coverage`, []]));
  const errors = [];
  compose.replaceTokens(normalizedHtml || '', { partials: sources.partials, coverage, fail: (m) => errors.push(m) });
  return errors;
}

// suggestSelector(rows, nid) → a generated selector for promote-to-rule:
// "parentTag > tag" when the element has a parent row, else "tag".
export function suggestSelector(rows, nid) {
  const i = rows.findIndex(r => r.nid === nid);
  if (i < 0) return '';
  const row = rows[i];
  let parent = null;
  for (let j = i - 1; j >= 0; j--) if (rows[j].depth === row.depth - 1) { parent = rows[j]; break; }
  return parent ? `${parent.tag} > ${row.tag}` : row.tag;
}

export { stripNids, validateSelector, classNames };
