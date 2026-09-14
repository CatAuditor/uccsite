// Documents editor server helpers (spec §5, §6.5, §12). Everything here runs
// on the server: ingest on save, the element tree (explainStyles), the live
// preview compose, rule match counts, and the Style Kit catalog parsed from
// the LIVE site stylesheet (read from the site bucket, so the admin sees the
// vocabulary that is actually published, locally and on Amplify alike).
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ingest, stripNids } from '@uccsite/html-ingest';
import { applyStyles, explainStyles, validateSelector, matchCountTree, rootedTree, orphanedOverrides } from '@uccsite/style-apply';
import { parseStyleKit, classNames } from '@uccsite/style-kit';
import { documents as compose, SITE_URL } from '@uccsite/render';
import {
  listDocuments, getDocument, listStyleRules, listOverrides, loadForeignClassMap,
} from '@uccsite/db/documents';
import { loadSettings, list } from '@uccsite/db/content';
import { config } from './config';

let s3 = null;
const getS3 = () => (s3 ??= new S3Client({ region: config.region }));

// Site sources the editor needs: the live stylesheet + partials + shells.
// Cached for the process lifetime (a publish changes them rarely; restart the
// admin or wait for a new instance to pick up a new stylesheet).
const cache = { at: 0, siteCss: '', partials: null, shells: null };
const SITE_SRC_TTL_MS = 5 * 60 * 1000;

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
  try {
    cache.siteCss = await getObjectText('css/styles.css');
  } catch (err) {
    console.warn(`[documents] could not read css/styles.css from the site bucket (${err.name}); falling back to the repo copy`);
    cache.siteCss = existsSync(join(root, 'css', 'styles.css')) ? readFileSync(join(root, 'css', 'styles.css'), 'utf8') : '';
  }
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
  // Preview: the real composed page with nids KEPT (the tree ↔ preview link
  // needs them), stylesheets inlined (the bucket is private on staging), and
  // a <base> so the site's absolute /assets and /css paths resolve.
  let preview = '';
  if (normalized) {
    const styled = applyStyles(normalized, docRules, overrides);
    const withTokens = compose.replaceTokens(styled, { partials: sources.partials, coverage, fail: () => {} });
    const composed = compose.composeDocument({
      doc, shell: sources.shells[doc.templateKey] || sources.shells.report, partials: sources.partials,
      settings, siteUrl: SITE_URL, siteCss: sources.siteCss, rules: docRules, overrides, coverage,
    });
    // Replacer FUNCTIONS: author-controlled CSS/HTML must not be interpreted
    // as $-patterns by String.prototype.replace.
    const cssTag = (css) => `<style>${String(css || '').replace(/<\/style/gi, '<\\/style')}</style>`;
    preview = composed.html
      .replace(/<main id="main">[\s\S]*<\/main>/, () => `<main id="main">\n${withTokens}\n</main>`)
      .replace('<link rel="stylesheet" href="/css/fonts.css" />', () => `<link rel="stylesheet" href="${config.publicOrigin}/css/fonts.css" />`)
      .replace('<link rel="stylesheet" href="/css/styles.css" />', () => cssTag(sources.siteCss))
      .replace(/<link rel="stylesheet" href="\/css\/pages\/[^"]+" \/>/, () => cssTag(doc.pageCss))
      .replace('<head>', () => `<head><base href="${config.publicOrigin}/" />`)
      .replace('</body>', () => `${PREVIEW_SCRIPT}</body>`);
  }
  return {
    doc, rules: docRules, allRules: rules, overrides, orphans, kit, rows, preview,
    unstyledCount: rows.filter(r => r.unstyled).length,
    foreignClassMap,
  };
}

// Injected into the preview srcdoc: click → select row; hover message → outline.
const PREVIEW_SCRIPT = `<script>
(function(){
  var last=null;
  function outline(nid){ if(last){last.style.outline='';} last=null; if(!nid) return; var el=document.querySelector('[data-nid="'+nid+'"]'); if(el){ el.style.outline='2px solid #c8a84b'; el.scrollIntoView({block:'nearest'}); last=el; } }
  document.addEventListener('click', function(e){ var a=e.target.closest('a'); if(a) e.preventDefault(); var el=e.target.closest('[data-nid]'); if(!el) return; e.preventDefault(); parent.postMessage({ucc:'select', nid: el.getAttribute('data-nid')}, '*'); });
  window.addEventListener('message', function(e){ if(e.data && e.data.ucc==='hover') outline(e.data.nid); });
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
