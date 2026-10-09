#!/usr/bin/env node
// copy-document.mjs — copy one document from one environment to another as a
// builder document (docs/systems/document-builder.md). The source row's
// fields (title, author, SEO, status …) are copied; the body is parsed into
// blocks and serialized back, so the words are the source's words and the
// page is editable in the builder. With --standard-frame the page takes the
// site's standard document frame (doc-body > doc-inner, byline strip,
// contents list) instead of its own; without it the look is preserved.
// Refuses to overwrite a row that already exists in the target unless
// --overwrite. Records a revision (when overwriting) and an audit row.
//
// Usage: $env:AWS_PROFILE='uccsite'
//        node scripts/copy-document.mjs --from prod --to staging --slug license-plate-has-a-price [--standard-frame] [--status draft] [--overwrite]
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';
import { parse, serialize } from '../packages/doc-blocks/index.js';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { getDocument, upsertDocument, loadForeignClassMap, listOverrides } = require('../packages/db/documents');
const { ingest, parseFragmentTree } = require('../packages/html-ingest');
const { documents: compose, memberSlug } = require('../packages/render');
const { readFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { fileURLToPath } = require('node:url');

const args = process.argv.slice(2);
const FROM = argValue(args, '--from', 'prod');
const TO = argValue(args, '--to', 'staging');
const SLUG = argValue(args, '--slug', '');
const STATUS = argValue(args, '--status', '');
const STANDARD = args.includes('--standard-frame');
const OVERWRITE = args.includes('--overwrite');
if (!SLUG) throw new Error('--slug is required');
if (FROM === TO) throw new Error('--from and --to must differ');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const siteCss = readFileSync(join(ROOT, 'css', 'styles.css'), 'utf8');

const flatText = (html) => { const out = []; (function walk(n) { for (const c of n.children || []) { if (c.type === 'text' && c.data.trim()) out.push(c.data.replace(/\s+/g, ' ').trim()); walk(c); } })(parseFragmentTree(html)); return out.join(' '); };

const src = await resolveEnv(FROM, ['DsqlEndpoint']);
let doc;
await withConnection({ endpoint: src.outputs.DsqlEndpoint, region: src.region }, async (client) => {
  doc = await getDocument(client, { slug: SLUG });
  if (!doc) throw new Error(`No document "${SLUG}" in ${FROM}`);
});
console.log(`[copy] ${FROM}/${SLUG}: "${doc.title}" (${doc.status}, ${doc.bodyHtmlRaw.length} chars, page css ${doc.pageCss.length} chars${doc.bodyBlocks ? ', already blocks' : ''})`);

const dst = await resolveEnv(TO, ['DsqlEndpoint']);
await withConnection({ endpoint: dst.outputs.DsqlEndpoint, region: dst.region }, async (client) => {
  const existing = await getDocument(client, { slug: SLUG });
  if (existing && !OVERWRITE) throw new Error(`"${SLUG}" already exists in ${TO}; pass --overwrite to replace it`);
  const members = (await client.query('SELECT name, slug FROM team_members')).rows;
  const authorHref = (() => { const m = members.find(x => x.name && x.name.trim() === String(doc.author || '').trim()); return m ? `/team/${memberSlug(m)}` : ''; })();

  const res = parse(doc.bodyHtmlRaw);
  if (res.title && res.title !== doc.title) res.body.header.headline = res.title;
  const author = doc.author || res.author;
  if (STANDARD) {
    res.body.header.frame = [];
    res.body.header.toc = res.body.sections.filter(s => s.heading).length >= 2 ? 'auto' : 'none';
    if (!res.body.header.badge) res.body.header.badge = 'Utah Civic Compact';
  }
  const html = serialize(res.body, { title: doc.title, author }, { authorHref });
  const pageCss = STANDARD ? '' : doc.pageCss;
  const foreignClassMap = await loadForeignClassMap(client, doc.templateKey);
  const result = ingest(html, { knownClasses: compose.knownClassesFor(siteCss, pageCss), foreignClassMap, allowScripts: Boolean(doc.allowScripts) });

  const blocks = res.body.sections.reduce((n, s) => n + s.blocks.length, 0);
  console.log(`[copy] blocks: ${res.body.sections.length} sections, ${blocks} blocks, ${res.report.raw} raw${STANDARD ? '; standard frame' : ''}; ingest: ${result.report.foreignClasses.length} foreign classes, ${result.report.a11y.length} a11y issues`);
  for (const n of res.report.notes) console.log(`[copy] note: ${n}`);
  // Words check: every word of the source body must still be in the new body
  // (header fields move the byline and the contents list, so the reverse is not asserted).
  const before = flatText(doc.bodyHtmlRaw), after = flatText(html);
  const missing = before.split(' ').filter((w, i, a) => !after.includes(w));
  console.log(`[copy] words: source ${before.split(' ').length}, result ${after.split(' ').length}, source words missing from result: ${missing.length}${missing.length ? ` (${missing.slice(0, 20).join(' ')})` : ''}`);

  const next = {
    ...doc, id: existing?.id, author, status: STATUS || doc.status,
    bodyHtmlRaw: html, bodyBlocks: res.body, pageCss,
    bodyHtmlNormalized: result.bodyHtmlNormalized, ingestReport: result.report,
  };
  delete next.liveHash; delete next.liveAt; delete next.lastPublishError; delete next.contentHash;
  const snapshot = existing ? (({ bodyHtmlNormalized, ingestReport, liveHash, liveAt, lastPublishError, createdAt, updatedAt, contentHash, publishedAt, ...fields }) => ({ ...fields, overrides: [] }))(existing) : null;
  if (existing) { const ov = await listOverrides(client, existing.id); snapshot.overrides = ov.map(({ nid, classes, mode }) => ({ nid, classes, mode })); }
  const id = await upsertDocument(client, next);
  if (snapshot) await client.query(`INSERT INTO revisions (id, entity_type, entity_id, snapshot, author) VALUES (gen_random_uuid(), 'document', $1, $2, $3)`, [id, JSON.stringify(snapshot), 'scripts/copy-document']);
  await client.query(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), $1, $2, 'document', $3, $4)`,
    ['scripts/copy-document', existing ? 'document.save' : 'document.create', id, JSON.stringify({ slug: SLUG, from: FROM, standardFrame: STANDARD, sections: res.body.sections.length, blocks, raw: res.report.raw })]);
  console.log(`[copy] ${existing ? 'replaced' : 'created'} ${TO}/${SLUG} (${next.status}) id ${id}`);
});
