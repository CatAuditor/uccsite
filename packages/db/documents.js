'use strict';
// Documents + styling tables ⇄ objects (spec §3.2, §6, §9). Same discipline
// as content.js: FIELD map is the single source for columns, rows map to the
// shapes the render/compose layer consumes (packages/render/documents.js).
const { withRetry } = require('./index');

// column → object key. Every editable column is here; adding one is a
// migration (content-schema.js) + an entry here + the editor field.
const DOCUMENT_FIELDS = {
  slug: 'slug', title: 'title', category: 'category', template_key: 'templateKey',
  status: 'status', sort_order: 'sortOrder',
  body_html_raw: 'bodyHtmlRaw', body_html_normalized: 'bodyHtmlNormalized', ingest_report: 'ingestReport',
  page_css: 'pageCss',
  meta_title: 'metaTitle', meta_description: 'metaDescription', meta_keywords: 'metaKeywords',
  canonical_url: 'canonicalUrl', og_type: 'ogType', og_title: 'ogTitle', og_description: 'ogDescription',
  og_image: 'ogImage', twitter_card: 'twitterCard', noindex: 'noindex', nofollow: 'nofollow',
  jsonld_type: 'jsonldType', jsonld_overrides: 'jsonldOverrides', allow_scripts: 'allowScripts',
  sitemap_priority: 'sitemapPriority',
};
const JSON_COLS = new Set(['ingest_report', 'jsonld_overrides']);
const INT_COLS = new Set(['noindex', 'nofollow', 'allow_scripts', 'sort_order']);
const STATUSES = ['draft', 'published'];
const TEMPLATE_KEYS = ['report'];

const SELECT_COLS = `id, ${Object.keys(DOCUMENT_FIELDS).join(', ')},
  published_at::text AS published_at, content_hash, live_hash, live_at::text AS live_at,
  last_publish_error, created_at::text AS created_at, updated_at::text AS updated_at`;

function rowToDocument(row) {
  const doc = { id: row.id };
  for (const [col, key] of Object.entries(DOCUMENT_FIELDS)) {
    let v = row[col];
    if (JSON_COLS.has(col)) { try { v = v ? JSON.parse(v) : null; } catch { v = null; } }
    else if (INT_COLS.has(col)) v = Number(v || 0);
    else v = v ?? '';
    doc[key] = v;
  }
  doc.publishedAt = row.published_at || null;
  doc.contentHash = row.content_hash || null;
  doc.liveHash = row.live_hash || null;
  doc.liveAt = row.live_at || null;
  doc.lastPublishError = row.last_publish_error || '';
  doc.createdAt = row.created_at;
  doc.updatedAt = row.updated_at;
  return doc;
}

function documentToParams(doc) {
  return Object.entries(DOCUMENT_FIELDS).map(([col, key]) => {
    const v = doc[key];
    if (JSON_COLS.has(col)) return v == null ? null : JSON.stringify(v);
    if (INT_COLS.has(col)) return Number(v || 0);
    return v == null || v === '' ? null : String(v);
  });
}

// listDocuments(client, { status }) → document[] ordered by category, sort_order, title
async function listDocuments(client, { status } = {}) {
  const where = status ? `WHERE status = $1` : '';
  const res = await client.query(
    `SELECT ${SELECT_COLS} FROM documents ${where} ORDER BY category NULLS LAST, sort_order, title`,
    status ? [status] : []);
  return res.rows.map(rowToDocument);
}

async function getDocument(client, { id, slug }) {
  const res = id
    ? await client.query(`SELECT ${SELECT_COLS} FROM documents WHERE id = $1`, [id])
    : await client.query(`SELECT ${SELECT_COLS} FROM documents WHERE slug = $1`, [slug]);
  return res.rows[0] ? rowToDocument(res.rows[0]) : null;
}

// upsertDocument(client, doc) → id. Insert when doc.id is absent.
async function upsertDocument(client, doc) {
  const cols = Object.keys(DOCUMENT_FIELDS);
  const params = documentToParams(doc);
  if (doc.id) {
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await client.query(`UPDATE documents SET ${sets}, updated_at = now() WHERE id = $1`, [doc.id, ...params]);
    return doc.id;
  }
  const res = await client.query(
    `INSERT INTO documents (id, ${cols.join(', ')})
     VALUES (gen_random_uuid(), ${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, params);
  return res.rows[0].id;
}

async function deleteDocument(client, id) {
  await client.query('DELETE FROM style_overrides WHERE document_id = $1', [id]);
  await client.query(`DELETE FROM style_rules WHERE scope = 'page' AND document_id = $1`, [id]);
  await client.query('DELETE FROM documents WHERE id = $1', [id]);
}

// setPublishedAt(client, id, iso|null) — published_at sits outside DOCUMENT_FIELDS
// (stamped once on first publish, restored from exports).
async function setPublishedAt(client, id, iso) {
  await client.query('UPDATE documents SET published_at = $2 WHERE id = $1', [id, iso || null]);
}

// Publish bookkeeping (§9: content_hash / live_hash / live_at / last_publish_error).
async function markDocumentLive(client, { id, contentHash }) {
  await withRetry(() => client.query(
    `UPDATE documents SET live_hash = $2, live_at = now(), last_publish_error = NULL WHERE id = $1`,
    [id, contentHash]));
}
async function markDocumentPublishError(client, { id, error }) {
  await withRetry(() => client.query(
    `UPDATE documents SET last_publish_error = $2 WHERE id = $1`, [id, String(error).slice(0, 500)]));
}

// ── Style rules / overrides / foreign class map ────────────────────────────

const parseClasses = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } };

function rowToRule(r) {
  return {
    id: r.id, scope: r.scope, templateKey: r.template_key || null, documentId: r.document_id || null,
    selector: r.selector, classes: parseClasses(r.classes), priority: Number(r.priority), note: r.note || '',
    updatedAt: r.updated_at,
  };
}
async function listStyleRules(client) {
  const res = await client.query(
    `SELECT id, scope, template_key, document_id, selector, classes, priority, note, updated_at::text AS updated_at
     FROM style_rules ORDER BY scope, template_key, priority, selector, id`);
  return res.rows.map(rowToRule);
}
async function upsertStyleRule(client, rule) {
  const params = [rule.scope, rule.templateKey || null, rule.documentId || null, rule.selector,
    JSON.stringify(rule.classes || []), Number(rule.priority ?? 10), rule.note || null];
  if (rule.id) {
    await client.query(
      `UPDATE style_rules SET scope=$2, template_key=$3, document_id=$4, selector=$5, classes=$6, priority=$7, note=$8, updated_at=now()
       WHERE id = $1`, [rule.id, ...params]);
    return rule.id;
  }
  const res = await client.query(
    `INSERT INTO style_rules (id, scope, template_key, document_id, selector, classes, priority, note)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`, params);
  return res.rows[0].id;
}
async function deleteStyleRule(client, id) {
  await client.query('DELETE FROM style_rules WHERE id = $1', [id]);
}

function rowToOverride(r) {
  return { id: r.id, documentId: r.document_id, nid: r.nid, classes: parseClasses(r.classes), mode: r.mode };
}
async function listOverrides(client, documentId) {
  const res = await client.query(
    `SELECT id, document_id, nid, classes, mode FROM style_overrides ${documentId ? 'WHERE document_id = $1' : ''} ORDER BY nid`,
    documentId ? [documentId] : []);
  return res.rows.map(rowToOverride);
}
// setOverride: one row per (document, nid); empty classes = delete. Bumps the
// document's updated_at: a style-only change alters the published page
// (sitemap lastmod) and must invalidate open editors' baseline stamps.
async function setOverride(client, { documentId, nid, classes, mode = 'append' }) {
  await client.query('UPDATE documents SET updated_at = now() WHERE id = $1', [documentId]);
  await client.query('DELETE FROM style_overrides WHERE document_id = $1 AND nid = $2', [documentId, nid]);
  if (classes && classes.length) {
    await client.query(
      `INSERT INTO style_overrides (id, document_id, nid, classes, mode) VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [documentId, nid, JSON.stringify(classes), mode === 'replace' ? 'replace' : 'append']);
  }
}
// replaceOverrides(client, documentId, overrides[]) — the restore path.
async function replaceOverrides(client, documentId, overrides) {
  await client.query('DELETE FROM style_overrides WHERE document_id = $1', [documentId]);
  for (const o of overrides || []) {
    if (!o.classes?.length) continue;
    await client.query(
      `INSERT INTO style_overrides (id, document_id, nid, classes, mode) VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [documentId, o.nid, JSON.stringify(o.classes), o.mode === 'replace' ? 'replace' : 'append']);
  }
}

// loadForeignClassMap(client, templateKey) → { fromClass: toClass|'' } (''= drop)
async function loadForeignClassMap(client, templateKey) {
  const res = await client.query(
    `SELECT template_key, from_class, to_class FROM foreign_class_map
     WHERE template_key IS NULL OR template_key = $1 ORDER BY template_key NULLS FIRST`, [templateKey || null]);
  const map = {};
  for (const r of res.rows) map[r.from_class] = r.to_class || ''; // template-specific rows override global (sorted last)
  return map;
}
async function listForeignClassMap(client) {
  const res = await client.query(
    `SELECT id, template_key, from_class, to_class, updated_at::text AS updated_at FROM foreign_class_map ORDER BY from_class`);
  return res.rows.map(r => ({ id: r.id, templateKey: r.template_key || null, fromClass: r.from_class, toClass: r.to_class || '', updatedAt: r.updated_at }));
}
async function setForeignClassMapping(client, { templateKey, fromClass, toClass }) {
  await client.query(
    `DELETE FROM foreign_class_map WHERE from_class = $1 AND template_key IS NOT DISTINCT FROM $2`,
    [fromClass, templateKey || null]);
  await client.query(
    `INSERT INTO foreign_class_map (id, template_key, from_class, to_class) VALUES (gen_random_uuid(), $1, $2, $3)`,
    [templateKey || null, fromClass, toClass || null]);
}
async function deleteForeignClassMapping(client, id) {
  await client.query('DELETE FROM foreign_class_map WHERE id = $1', [id]);
}

// loadExportBundle(client) → every document (drafts included — the export is
// the source of truth, not the published site), overrides, rules, map.
async function loadExportBundle(client) {
  const { listRedirects } = require('./redirects');
  return {
    documents: await listDocuments(client),
    overrides: await listOverrides(client),
    rules: await listStyleRules(client),
    foreignClassMap: await listForeignClassMap(client),
    redirects: await listRedirects(client),
  };
}

// loadPublishBundle(client) → everything the publish path needs in one shot.
// allSlugs: every document row regardless of status — a slug that exists as a
// document (even a draft) must never fall back to the old fixed template.
async function loadPublishBundle(client) {
  return {
    documents: await listDocuments(client, { status: 'published' }),
    allSlugs: (await client.query('SELECT slug FROM documents')).rows.map(r => r.slug),
    rules: await listStyleRules(client),
    overrides: await listOverrides(client),
    foreignClassMapRows: await listForeignClassMap(client),
  };
}

module.exports = {
  DOCUMENT_FIELDS, STATUSES, TEMPLATE_KEYS,
  rowToDocument, documentToParams, listDocuments, getDocument, upsertDocument, deleteDocument,
  markDocumentLive, markDocumentPublishError, setPublishedAt,
  listStyleRules, upsertStyleRule, deleteStyleRule,
  listOverrides, setOverride, replaceOverrides,
  loadForeignClassMap, listForeignClassMap, setForeignClassMapping, deleteForeignClassMapping,
  loadPublishBundle, loadExportBundle,
};
