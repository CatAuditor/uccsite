// One-off: save the styled body + page CSS + SEO fields onto the existing
// draft document (mirrors apps/admin saveDocument: ingest, upsert, revision
// snapshot, audit row). Status stays 'draft'. Run only after preview approval.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveEnv } from './lib/stack.mjs';
const require = createRequire(import.meta.url);
const { withConnection } = require('@uccsite/db');
const { getDocument, upsertDocument, listOverrides, loadForeignClassMap } = require('@uccsite/db/documents');
const { ingest } = require('@uccsite/html-ingest');
const { documents: docs } = require('@uccsite/render');
const S = process.env.SCRATCH;
const ACTOR = process.env.ACTOR || 'jaromforcongress@gmail.com';
const meta = JSON.parse(readFileSync(S + '/doc-meta.json', 'utf8'));
const bodyHtmlRaw = readFileSync(S + '/body.html', 'utf8');
const pageCss = readFileSync(S + '/page.css', 'utf8');
const siteCss = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const { region, outputs } = await resolveEnv('prod', ['DsqlEndpoint']);
await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  await client.query('BEGIN');
  try {
    const current = await getDocument(client, { slug: meta.slug });
    if (!current) throw new Error('draft not found');
    const { bodyHtmlNormalized, ingestReport, liveHash, liveAt, lastPublishError, createdAt, updatedAt, contentHash, publishedAt, ...fields } = current;
    const before = { ...fields, overrides: (await listOverrides(client, current.id)).map(({ nid, classes, mode }) => ({ nid, classes, mode })) };
    const foreignClassMap = await loadForeignClassMap(client, 'report');
    const result = ingest(bodyHtmlRaw, { knownClasses: docs.knownClassesFor(siteCss, pageCss), foreignClassMap, previousNormalized: current.bodyHtmlNormalized || null, allowScripts: false });
    const r = result.report;
    console.log('ingest: removed', r.removed.length, 'foreign', r.foreignClasses.length, 'a11y', r.a11y.length, 'warnings', r.warnings);
    if (r.a11y.length) throw new Error('a11y gate failed: ' + JSON.stringify(r.a11y));
    const next = { ...current, ...meta, templateKey: 'report', status: 'draft', bodyHtmlRaw, pageCss, bodyHtmlNormalized: result.bodyHtmlNormalized, ingestReport: r };
    await upsertDocument(client, next);
    await client.query(`INSERT INTO revisions (id, entity_type, entity_id, snapshot, author) VALUES (gen_random_uuid(), 'document', $1, $2, $3)`, [current.id, JSON.stringify(before), ACTOR]);
    await client.query(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), $1, 'document.save', 'document', $2, $3)`,
      [ACTOR, current.id, JSON.stringify({ slug: meta.slug, status: 'draft', removed: r.removed.length, foreign: r.foreignClasses.length, a11y: 0, match: r.match, via: 'scripts/_upload.mjs' })]);
    await client.query('COMMIT');
    const after = await getDocument(client, { slug: meta.slug });
    console.log('saved', after.id, 'status', after.status, 'body', after.bodyHtmlRaw.length, 'css', after.pageCss.length, 'updated', after.updatedAt);
  } catch (e) { await client.query('ROLLBACK'); throw e; }
});
