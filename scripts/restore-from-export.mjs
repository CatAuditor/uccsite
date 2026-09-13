#!/usr/bin/env node
// restore-from-export.mjs — load a §14.2 export directory (a git checkout of
// the export branch, or scripts/export-content.mjs output) into an
// environment's content tables, then read everything back and DEEP-COMPARE
// against the files. Same write path as the initial migration
// (packages/db/content.js saveContent) — a restore can't drift from what the
// migration proved round-trips. Wipe-and-load: the target's current content
// is REPLACED. Publish afterwards to make it live.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/restore-from-export.mjs --env staging --from ./export-staging
//        (--from defaults to the repo's own content/ directory)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { deepStrictEqual } from 'node:assert';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { loadContent, saveContent } = require('../packages/db/content');
const { COLLECTIONS, SCHEMA_VERSION, DOC_JSON_KEYS } = require('../packages/db/export');
const {
  listDocuments, getDocument, upsertDocument, deleteDocument, replaceOverrides, listStyleRules, deleteStyleRule, upsertStyleRule,
  listForeignClassMap, deleteForeignClassMapping, setForeignClassMapping, loadForeignClassMap, setPublishedAt,
} = require('../packages/db/documents');
const { ingest } = require('@uccsite/html-ingest');
const { orphanedOverrides } = require('@uccsite/style-apply');
const { documents: compose } = require('@uccsite/render');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const fromDir = resolve(argValue(args, '--from', join(import.meta.dirname, '..')));
if (envName === 'prod' && !args.includes('--i-mean-prod')) {
  console.error('Refusing to wipe-and-load PROD content without --i-mean-prod');
  process.exit(2);
}

const manifestPath = join(fromDir, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version > SCHEMA_VERSION) {
    console.error(`Export schema_version ${manifest.schema_version} is newer than this restore script (${SCHEMA_VERSION})`);
    process.exit(2);
  }
  console.log(`Export from ${manifest.exported_at}: ${JSON.stringify(manifest.counts)}`);
} else {
  console.log('No manifest.json — treating the directory as a plain content/ checkout');
}

const repo = {};
for (const name of COLLECTIONS) {
  const p = join(fromDir, 'content', `${name}.json`);
  if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); }
  repo[name] = JSON.parse(readFileSync(p, 'utf8'));
}

// Documents (§14.2 layout, schema 2+): documents/<slug>.html + .json; styles/rules.json.
const docsDir = join(fromDir, 'documents');
const docFiles = existsSync(docsDir) ? readdirSync(docsDir).filter(f => f.endsWith('.json')) : [];
const documents = docFiles.map((f) => {
  const meta = JSON.parse(readFileSync(join(docsDir, f), 'utf8'));
  const html = join(docsDir, f.replace(/\.json$/, '.html'));
  if (!existsSync(html)) { console.error(`Missing ${html}`); process.exit(2); }
  const normalized = join(docsDir, f.replace(/\.json$/, '.normalized.html'));
  return { ...meta, bodyHtmlRaw: readFileSync(html, 'utf8'), exportedNormalized: existsSync(normalized) ? readFileSync(normalized, 'utf8') : null };
});
const allowOrphans = args.includes('--allow-orphaned-overrides');
const stylesPath = join(fromDir, 'styles', 'rules.json');
const styles = existsSync(stylesPath) ? JSON.parse(readFileSync(stylesPath, 'utf8')) : null;

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  await saveContent(client, repo);
  const loaded = await loadContent(client);
  deepStrictEqual(loaded, repo);

  if (docFiles.length) {
    // Order matters: the foreign class map first (ingest consults it), then
    // documents (upsert by slug — ids are not portable — with overrides), then
    // rules (page rules need the new ids), then deletions of documents absent
    // from the export. Normalized bodies are re-ingested against the
    // EXPORTED normalized tree so override nids carry forward (§5.4).
    const siteCss = readFileSync(join(import.meta.dirname, '..', 'css', 'styles.css'), 'utf8');
    if (styles) {
      for (const m of await listForeignClassMap(client)) await deleteForeignClassMapping(client, m.id);
      for (const m of styles.foreignClassMap || []) await setForeignClassMapping(client, m);
    }
    const existing = await listDocuments(client);
    const keep = new Set(documents.map(d => d.slug));
    const idBySlug = {};
    const orphans = [];
    for (const doc of documents) {
      const current = existing.find(d => d.slug === doc.slug);
      const fields = Object.fromEntries(DOC_JSON_KEYS.map(k => [k, doc[k]]));
      const next = { ...(current || {}), ...fields, bodyHtmlRaw: doc.bodyHtmlRaw, id: current?.id };
      const result = ingest(doc.bodyHtmlRaw, {
        knownClasses: compose.knownClassesFor(siteCss, next.pageCss),
        foreignClassMap: await loadForeignClassMap(client, next.templateKey),
        previousNormalized: doc.exportedNormalized || current?.bodyHtmlNormalized || null,
      });
      next.bodyHtmlNormalized = result.bodyHtmlNormalized;
      next.ingestReport = result.report;
      const id = await upsertDocument(client, next);
      await setPublishedAt(client, id, doc.publishedAt || null);
      idBySlug[doc.slug] = id;
      await replaceOverrides(client, id, doc.overrides || []);
      for (const o of orphanedOverrides(result.bodyHtmlNormalized, doc.overrides || [])) orphans.push(`${doc.slug}:${o.nid}`);
    }
    if (styles) {
      for (const r of await listStyleRules(client)) await deleteStyleRule(client, r.id);
      for (const r of styles.rules || []) {
        await upsertStyleRule(client, { ...r, documentId: r.documentSlug ? idBySlug[r.documentSlug] || null : null });
      }
    }
    for (const d of existing) if (!keep.has(d.slug)) await deleteDocument(client, d.id);
    if (orphans.length) {
      const msg = `${orphans.length} style override(s) no longer match an element after restore: ${orphans.join(', ')}`;
      if (!allowOrphans) throw new Error(msg + ' — re-export with the normalized bodies, or pass --allow-orphaned-overrides');
      console.warn('WARNING: ' + msg);
    }
    // Round-trip: every restored document's raw body and metadata must read back identically.
    for (const doc of documents) {
      const back = await getDocument(client, { slug: doc.slug });
      deepStrictEqual(back.bodyHtmlRaw, doc.bodyHtmlRaw);
      for (const k of DOC_JSON_KEYS) deepStrictEqual(back[k] ?? '', doc[k] ?? '', `document ${doc.slug}.${k}`);
    }
    console.log(`Restored ${documents.length} documents, ${(styles?.rules || []).length} rules, ${(styles?.foreignClassMap || []).length} class mappings.`);
  }
  console.log(`Restored ${fromDir} into ${stackName} and round-trip verified. Publish to make it live.`);
});
