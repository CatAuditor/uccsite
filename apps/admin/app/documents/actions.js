'use server';
// Documents server actions (spec §5 save-time ingest, §6.3 overrides, §6.5
// promote-to-rule). Every action re-checks the role; results follow the
// { ok } | { error } convention (lib/actions.js). Saves are one transaction
// holding the document upsert + revision snapshot (body_html_raw AND the
// resolved override set, §9) + audit row.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getDocument, upsertDocument, deleteDocument as deleteDocumentRow, listOverrides, setOverride,
  upsertStyleRule, deleteStyleRule, loadForeignClassMap, setForeignClassMapping, deleteForeignClassMapping,
  STATUSES, TEMPLATE_KEYS,
} from '@uccsite/db/documents';
import { requireRole } from '../../lib/auth';
import { withWriteTx, withDb, recordChange } from '../../lib/data';
import { runAction } from '../../lib/actions';
import { runIngest, loadSiteSources, styleKitFor, ruleMatchCounts, validateSelector } from '../../lib/documents';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const RESERVED_SLUGS = new Set(['index', 'team', 'blog', 'statements', 'issues', 'projects', 'tip', 'success', '404', 'admin', 'api', 'media', 'css', 'js', 'assets']);

const str = (fd, name, max = 2000) => String(fd.get(name) ?? '').trim().slice(0, max);
const flag = (fd, name) => (fd.get(name) ? 1 : 0);

// Snapshot shape (restore path in app/revisions): the document's editable
// fields + its overrides. body_html_raw is included verbatim (§9).
async function snapshotOf(client, id) {
  const doc = await getDocument(client, { id });
  if (!doc) return null;
  const { bodyHtmlNormalized, ingestReport, liveHash, liveAt, lastPublishError, createdAt, updatedAt, contentHash, publishedAt, ...fields } = doc;
  return { ...fields, overrides: (await listOverrides(client, id)).map(({ nid, classes, mode }) => ({ nid, classes, mode })) };
}

export async function createDocument(prevState, formData) {
  let newId = null;
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    const title = str(formData, 'title', 200);
    const slug = str(formData, 'slug', 80).toLowerCase();
    const category = str(formData, 'category', 60) || 'Reports';
    if (!title) throw new Error('Title is required');
    if (!SLUG_RE.test(slug)) throw new Error('Slug must be lowercase letters, digits and dashes');
    if (RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is a fixed page or reserved path`);
    await withWriteTx(async (client) => {
      if (await getDocument(client, { slug })) throw new Error(`A document with slug "${slug}" already exists`);
      newId = await upsertDocument(client, { title, slug, category, templateKey: 'report', status: 'draft', sortOrder: 0, bodyHtmlRaw: '', pageCss: '' });
      await recordChange(client, { actor: s.email, action: 'document.create', entityType: 'document', entityId: newId, diff: { slug, title } });
    });
  });
  if (result.ok && newId) redirect(`/documents/${newId}`);
  return result;
}

// saveDocument: metadata + body + css in one go. Ingest runs here (spec §5
// "on save, so the editor gets immediate feedback") and again on publish.
export async function saveDocument(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    const baseline = str(formData, 'baseline', 80);
    const status = str(formData, 'status', 20);
    if (!STATUSES.includes(status)) throw new Error('Bad status');
    const templateKey = str(formData, 'templateKey', 40) || 'report';
    if (!TEMPLATE_KEYS.includes(templateKey)) throw new Error('Unknown template');
    const slug = str(formData, 'slug', 80).toLowerCase();
    if (!SLUG_RE.test(slug)) throw new Error('Slug must be lowercase letters, digits and dashes');
    if (RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is a fixed page or reserved path`);
    let jsonldOverrides = null;
    const jsonldText = str(formData, 'jsonldOverrides', 20000);
    if (jsonldText) {
      try { jsonldOverrides = JSON.parse(jsonldText); } catch { throw new Error('JSON-LD overrides must be valid JSON'); }
      if (!jsonldOverrides || typeof jsonldOverrides !== 'object' || Array.isArray(jsonldOverrides)) throw new Error('JSON-LD overrides must be a JSON object');
    }
    const sources = await loadSiteSources();
    let summary;
    await withWriteTx(async (client) => {
      const current = await getDocument(client, { id });
      if (!current) throw new Error('Document not found');
      if (baseline && current.updatedAt !== baseline) throw new Error(CONFLICT_MESSAGE);
      const other = await getDocument(client, { slug });
      if (other && other.id !== id) throw new Error(`Slug "${slug}" is used by "${other.title}"`);
      const before = await snapshotOf(client, id);
      const allowScripts = s.role === 'owner' ? flag(formData, 'allowScripts') : current.allowScripts; // owner-only field
      const next = {
        ...current,
        title: str(formData, 'title', 200), slug, category: str(formData, 'category', 60), templateKey, status,
        sortOrder: Number(str(formData, 'sortOrder', 10) || 0),
        bodyHtmlRaw: String(formData.get('bodyHtmlRaw') ?? ''),
        pageCss: String(formData.get('pageCss') ?? ''),
        metaTitle: str(formData, 'metaTitle', 200), metaDescription: str(formData, 'metaDescription', 400),
        metaKeywords: str(formData, 'metaKeywords', 400), canonicalUrl: str(formData, 'canonicalUrl', 300),
        ogType: str(formData, 'ogType', 40), ogTitle: str(formData, 'ogTitle', 200), ogDescription: str(formData, 'ogDescription', 400),
        ogImage: str(formData, 'ogImage', 300), twitterCard: str(formData, 'twitterCard', 40),
        noindex: flag(formData, 'noindex'), nofollow: flag(formData, 'nofollow'),
        jsonldType: str(formData, 'jsonldType', 60), jsonldOverrides, allowScripts,
        sitemapPriority: str(formData, 'sitemapPriority', 5),
      };
      if (!next.title) throw new Error('Title is required');
      const foreignClassMap = await loadForeignClassMap(client, templateKey);
      const result = runIngest(next, { siteCss: sources.siteCss, foreignClassMap });
      next.bodyHtmlNormalized = result.bodyHtmlNormalized;
      next.ingestReport = result.report;
      if (status === 'published' && !result.ok) {
        throw new Error(`Cannot publish: ${result.report.a11y.map(a => a.message).join(' ')} Fix the HTML or save as draft.`);
      }
      if (status === 'published' && !next.metaDescription) throw new Error('A meta description is required to publish (SEO §12).');
      if (status === 'published' && !current.publishedAt) next.publishedAt = new Date().toISOString();
      await upsertDocument(client, next);
      if (next.publishedAt && !current.publishedAt) await client.query('UPDATE documents SET published_at = now() WHERE id = $1', [id]);
      await recordChange(client, {
        actor: s.email, action: 'document.save', entityType: 'document', entityId: id,
        snapshot: before,
        diff: { slug, status, removed: result.report.removed.length, foreign: result.report.foreignClasses.length, a11y: result.report.a11y.length, match: result.report.match },
      });
      summary = result.report;
    });
    revalidatePath(`/documents/${id}`);
    revalidatePath('/documents');
    const parts = [];
    if (summary.removed.length) parts.push(`${summary.removed.reduce((n, r) => n + (r.count || 1), 0)} removed`);
    if (summary.foreignClasses.length) parts.push(`${summary.foreignClasses.length} foreign classes`);
    if (summary.a11y.length) parts.push(`${summary.a11y.length} accessibility issues`);
    if (summary.match) parts.push(`${summary.match.matched ?? ''} matched`);
    return { ok: true, message: `Saved.${parts.length ? ' Ingest: ' + parts.join(', ') + ' — see the report below.' : ''}` };
  });
}

export async function deleteDocument(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    await withWriteTx(async (client) => {
      const before = await snapshotOf(client, id);
      if (!before) throw new Error('Document not found');
      if (before.status === 'published') throw new Error('Unpublish (save as draft) before deleting.');
      await deleteDocumentRow(client, id);
      await recordChange(client, { actor: s.email, action: 'document.delete', entityType: 'document', entityId: id, snapshot: before });
    });
    revalidatePath('/documents');
    redirect('/documents');
  });
}

// setOverrides({ documentId, nids: [], classes: [], mode }) — one or many
// elements (the bulk actions send several nids at once).
export async function setOverrides(payload) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const { documentId, nids, classes, mode } = payload || {};
    if (!documentId || !Array.isArray(nids) || !nids.length) throw new Error('Nothing selected');
    const sources = await loadSiteSources();
    await withWriteTx(async (client) => {
      const doc = await getDocument(client, { id: documentId });
      if (!doc) throw new Error('Document not found');
      const known = styleKitFor(sources.siteCss, doc.pageCss).known;
      const clean = [...new Set((classes || []).map(String))].filter(c => known.has(c));
      const unknown = (classes || []).filter(c => !known.has(c));
      if (unknown.length) throw new Error(`Not in the Style Kit: ${unknown.join(', ')}`);
      for (const nid of nids) await setOverride(client, { documentId, nid: String(nid), classes: clean, mode });
      await recordChange(client, {
        actor: s.email, action: 'document.override', entityType: 'document', entityId: documentId,
        diff: { nids, classes: clean, mode },
      });
    });
    revalidatePath(`/documents/${documentId}`);
    return { ok: true, message: `Applied to ${nids.length} element${nids.length === 1 ? '' : 's'}.` };
  });
}

// previewRule({ scope, templateKey, documentId, selector }) → match counts
export async function previewRule(payload) {
  return runAction(async () => {
    await requireRole('editor');
    const v = validateSelector(String(payload?.selector || ''));
    if (!v.ok) throw new Error(v.reason);
    const counts = await withDb((client) => ruleMatchCounts(client, payload));
    return { ok: true, ...counts };
  });
}

// saveRule({ id?, scope, templateKey, documentId, selector, classes, priority, note })
export async function saveRule(payload) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const rule = {
      id: payload?.id || null,
      scope: payload?.scope === 'page' ? 'page' : 'template',
      templateKey: payload?.scope === 'page' ? null : (payload?.templateKey || 'report'),
      documentId: payload?.scope === 'page' ? payload?.documentId : null,
      selector: String(payload?.selector || '').trim(),
      classes: [...new Set((payload?.classes || []).map(String).filter(Boolean))],
      priority: Number.isFinite(Number(payload?.priority)) ? Number(payload.priority) : 10,
      note: String(payload?.note || '').slice(0, 300),
    };
    const v = validateSelector(rule.selector);
    if (!v.ok) throw new Error(v.reason);
    if (!rule.classes.length) throw new Error('Pick at least one class');
    if (rule.scope === 'page' && !rule.documentId) throw new Error('Page rule needs a document');
    if (!TEMPLATE_KEYS.includes(rule.templateKey || 'report')) throw new Error('Unknown template');
    const sources = await loadSiteSources();
    const known = styleKitFor(sources.siteCss, '').known;
    const unknown = rule.classes.filter(c => !known.has(c));
    if (unknown.length) throw new Error(`Not in the Style Kit: ${unknown.join(', ')}`);
    let id;
    await withWriteTx(async (client) => {
      id = await upsertStyleRule(client, rule);
      await recordChange(client, { actor: s.email, action: rule.id ? 'style_rule.update' : 'style_rule.create', entityType: 'style_rule', entityId: id, diff: rule });
    });
    revalidatePath('/styles');
    if (rule.documentId) revalidatePath(`/documents/${rule.documentId}`);
    return { ok: true, id, message: 'Rule saved.' };
  });
}

export async function removeRule(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    await withWriteTx(async (client) => {
      await deleteStyleRule(client, id);
      await recordChange(client, { actor: s.email, action: 'style_rule.delete', entityType: 'style_rule', entityId: id });
    });
    revalidatePath('/styles');
    return { ok: true, message: 'Rule deleted.' };
  });
}

// mapForeignClass(prev, formData): from → to ('' = drop). Re-ingest happens on
// the document's next save (the map is consulted at ingest, §5.5).
export async function mapForeignClass(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const fromClass = str(formData, 'fromClass', 100);
    const toClass = str(formData, 'toClass', 100);
    const templateKey = str(formData, 'templateKey', 40) || null;
    if (!fromClass) throw new Error('Foreign class is required');
    if (toClass) {
      const sources = await loadSiteSources();
      if (!styleKitFor(sources.siteCss, '').known.has(toClass)) throw new Error(`"${toClass}" is not in the Style Kit`);
    }
    await withWriteTx(async (client) => {
      await setForeignClassMapping(client, { templateKey, fromClass, toClass });
      await recordChange(client, { actor: s.email, action: 'foreign_class.map', entityType: 'foreign_class_map', entityId: fromClass, diff: { templateKey, fromClass, toClass } });
    });
    revalidatePath('/styles');
    const back = str(formData, 'documentId', 80);
    if (back) revalidatePath(`/documents/${back}`);
    return { ok: true, message: toClass ? `${fromClass} → ${toClass} on next save.` : `${fromClass} will be dropped silently on next save.` };
  });
}

export async function unmapForeignClass(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    await withWriteTx(async (client) => {
      await deleteForeignClassMapping(client, id);
      await recordChange(client, { actor: s.email, action: 'foreign_class.unmap', entityType: 'foreign_class_map', entityId: id });
    });
    revalidatePath('/styles');
    return { ok: true, message: 'Mapping removed.' };
  });
}
