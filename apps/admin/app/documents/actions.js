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
import { runIngest, loadSiteSources, styleKitFor, ruleMatchCounts, validateSelector, tokenErrors, blocksToRaw, previewBlocksFor } from '../../lib/documents';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import { docxToHtml, markdownToHtml, uploadKind, uploadToHtml } from '../../lib/convert-upload.mjs';
import { parse as parseBlocks, rewritePageCss, slugify as slugifyText } from '@uccsite/doc-blocks';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const RESERVED_SLUGS = new Set(['index', 'team', 'blog', 'statements', 'issues', 'projects', 'tip', 'success', '404', 'admin', 'api', 'media', 'css', 'js', 'assets']);

const SHORT_PATH_RE = /^\/[a-z0-9][a-z0-9-]{0,80}$/;

const str = (fd, name, max = 2000) => String(fd.get(name) ?? '').trim().slice(0, max);
const flag = (fd, name) => (fd.get(name) ? 1 : 0);

// validateAddress(client, { id, slug, projectSlug, shortPath }) — the
// document's place in the tree (docs/decisions/project-tree-nested-urls.md):
// the slug is unique within its project (root documents also keep clear of
// the fixed pages and reserved paths), it may not collide with a sub-project
// under the same parent, the project must exist, and the optional short path
// is one root segment nobody else has claimed. Throws the message to show.
async function validateAddress(client, { id = null, slug, projectSlug = '', shortPath = '' }) {
  if (!SLUG_RE.test(slug)) throw new Error('Slug must be lowercase letters, digits and dashes');
  if (projectSlug && !SLUG_RE.test(projectSlug)) throw new Error('Bad project');
  if (!projectSlug && RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is a fixed page or reserved path`);
  if (projectSlug) {
    if (!(await client.query('SELECT 1 FROM projects WHERE slug = $1', [projectSlug])).rows[0]) throw new Error(`Project "${projectSlug}" does not exist`);
    if ((await client.query('SELECT 1 FROM projects WHERE parent_slug = $1 AND slug = $2', [projectSlug, slug])).rows[0]) {
      throw new Error(`"${slug}" is a sub-project of that project; the document needs another slug`);
    }
    if ((await client.query('SELECT 1 FROM petitions WHERE project_slug = $1 AND slug = $2', [projectSlug, slug])).rows[0]) {
      throw new Error(`"${slug}" is a petition under that project (docs/systems/petition.md); the document needs another slug`);
    }
  }
  const other = await getDocument(client, { slug, projectSlug });
  if (other && other.id !== id) throw new Error(`Slug "${slug}" is already used ${projectSlug ? 'in this project' : 'at the root'} by "${other.title}"`);
  if (shortPath) {
    if (!SHORT_PATH_RE.test(shortPath)) throw new Error('Short link must be a slash and one word, e.g. /alpr');
    const name = shortPath.slice(1);
    if (RESERVED_SLUGS.has(name)) throw new Error(`"${shortPath}" is a fixed page or reserved path`);
    const taken = (await client.query(
      `SELECT title FROM documents WHERE id IS DISTINCT FROM $1 AND (short_path = $2 OR (coalesce(project_slug, '') = '' AND slug = $3)) LIMIT 1`, [id, shortPath, name])).rows[0];
    if (taken) throw new Error(`"${shortPath}" is already the address of "${taken.title}"`);
  }
}

// Snapshot shape (restore path in app/revisions): the document's editable
// fields + its overrides. body_html_raw is included verbatim (§9).
async function snapshotOf(client, id) {
  const doc = await getDocument(client, { id });
  if (!doc) return null;
  const { bodyHtmlNormalized, ingestReport, liveHash, liveAt, lastPublishError, createdAt, updatedAt, contentHash, publishedAt, ...fields } = doc;
  return { ...fields, overrides: (await listOverrides(client, id)).map(({ nid, classes, mode }) => ({ nid, classes, mode })) };
}

// Upload-first (docs/systems/document-builder.md): an optional file fills
// the title, author and blocks; title/slug fall back to what the file says.
export async function createDocument(prevState, formData) {
  let newId = null;
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    const file = formData.get('file');
    const parsed = file && typeof file.arrayBuffer === 'function' && file.size > 0 ? await parseUploadFile(file) : null;
    const title = str(formData, 'title', 200) || (parsed ? parsed.title : '');
    const slug = (str(formData, 'slug', 80) || slugifyText(title)).toLowerCase();
    const category = str(formData, 'category', 60) || 'Reports';
    const projectSlug = str(formData, 'projectSlug', 80);
    if (projectSlug && !SLUG_RE.test(projectSlug)) throw new Error('Bad project');
    if (!title) throw new Error(parsed ? 'The file has no heading to use as the title; type one' : 'Title is required');
    await withWriteTx(async (client) => {
      await validateAddress(client, { slug, projectSlug });
      // Every new document is a builder document (empty blocks when no file).
      const author = parsed ? parsed.author : '';
      const { body, html } = await blocksToRaw(client, parsed ? parsed.body : { v: 1, header: {}, sections: [] }, { title, author });
      newId = await upsertDocument(client, { title, slug, category, author, projectSlug, templateKey: 'report', status: 'draft', sortOrder: 0, bodyHtmlRaw: html, bodyBlocks: body, pageCss: '' });
      await recordChange(client, { actor: s.email, action: 'document.create', entityType: 'document', entityId: newId, diff: { slug, title, project: projectSlug, upload: parsed ? { file: file.name, blocks: parsed.report.blocks, raw: parsed.report.raw } : undefined } });
    });
    if (parsed) console.log(`[documents] upload-first "${file.name}" ${file.size}B -> ${parsed.report.sections} sections, ${parsed.report.blocks} blocks, ${parsed.report.raw} raw, ${parsed.report.imagesPending} images pending`);
  });
  if (result.ok && newId) redirect(`/documents/${newId}`);
  return result;
}

// parseUploadFile(file) → { title, author, body, report } — the shared
// upload → blocks step (createDocument and parseUpload). Embedded images
// (data: URLs from a .docx) become Image blocks with an empty src that the
// editor fills from the Media library; nothing is stored here.
async function parseUploadFile(file) {
  if (file.size > UPLOAD_MAX_BYTES) throw new Error('File is larger than 8 MB');
  const conv = await uploadToHtml(file);
  const res = parseBlocks(conv.html);
  let imagesPending = 0;
  for (const s of res.body.sections) for (const b of s.blocks) {
    if (b.type === 'figure' && /^data:/i.test(b.src || '')) { b.src = ''; b.caption = b.caption || `Image ${++imagesPending}`; b.pending = true; }
    else if (b.type === 'figure' && b.src) { /* external or site path: kept, the ingest warns if it is not from the media library */ }
  }
  if (res.title && res.title !== res.title.trim()) res.title = res.title.trim();
  const blocks = res.body.sections.reduce((n, s) => n + s.blocks.length, 0);
  return {
    title: res.title, author: res.author, body: res.body,
    report: { kind: conv.kind, sections: res.body.sections.length, blocks, raw: res.report.raw, notes: res.report.notes, imagesPending, warnings: conv.warnings || [] },
  };
}

// parseUpload(formData{file}) → { ok, title, author, body, report } for the
// builder's "Replace from a file" (nothing stored; the editor saves).
export async function parseUpload(formData) {
  return runAction(async () => {
    await requireRole('editor');
    const file = formData.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('No file received');
    const parsed = await parseUploadFile(file);
    console.log(`[documents] parse upload "${file.name}" ${file.size}B -> ${parsed.report.sections} sections, ${parsed.report.blocks} blocks, ${parsed.report.raw} raw, ${parsed.report.imagesPending} images pending`);
    return { ok: true, ...parsed };
  });
}

// previewBlocks({ id, body, title, author }) → { ok, html, report }: the
// live preview while editing. Nothing is stored. Editor+ because the
// composed page carries the site sources.
export async function previewBlocks(payload) {
  return runAction(async () => {
    await requireRole('editor');
    const { id, body, title, author } = payload || {};
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new Error('Bad document id');
    const out = await withDb((client) => previewBlocksFor(client, { id, body, title: String(title || '').slice(0, 200), author: String(author || '').slice(0, 120) }));
    return { ok: true, ...out };
  });
}

// convertToBlocks(formData{id}) — a legacy raw-HTML document becomes a
// builder document: parse the body into blocks, regenerate body_html_raw from
// them, rewrite the page CSS wrapper selectors to the new frame. One
// transaction with a revision snapshot, so Revisions can undo it.
export async function convertToBlocks(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    const sources = await loadSiteSources();
    let report;
    await withWriteTx(async (client) => {
      const current = await getDocument(client, { id });
      if (!current) throw new Error('Document not found');
      if (current.bodyBlocks) throw new Error('Already a builder document');
      const before = await snapshotOf(client, id);
      const res = parseBlocks(current.bodyHtmlRaw, { keepFrame: true }); // its page CSS targets its own frame
      if (res.title && res.title !== current.title) res.body.header.headline = res.title;
      const author = current.author || res.author;
      const { body, html } = await blocksToRaw(client, res.body, { title: current.title, author });
      const pageCss = rewritePageCss(current.pageCss);
      const next = { ...current, author, bodyBlocks: body, bodyHtmlRaw: html, pageCss };
      const foreignClassMap = await loadForeignClassMap(client, current.templateKey);
      const result = runIngest(next, { siteCss: sources.siteCss, foreignClassMap });
      next.bodyHtmlNormalized = result.bodyHtmlNormalized;
      next.ingestReport = result.report;
      await upsertDocument(client, next);
      report = { sections: body.sections.length, blocks: body.sections.reduce((n, sec) => n + sec.blocks.length, 0), raw: res.report.raw, notes: res.report.notes };
      await recordChange(client, { actor: s.email, action: 'document.convert_blocks', entityType: 'document', entityId: id, snapshot: before, diff: report });
    });
    revalidatePath(`/documents/${id}`);
    console.log(`[documents] convert to blocks ${id}: ${report.sections} sections, ${report.blocks} blocks, ${report.raw} raw`);
    return { ok: true, message: `Converted: ${report.sections} sections, ${report.blocks} blocks${report.raw ? `, ${report.raw} kept as custom HTML` : ''}. Review the preview, then save.` };
  });
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
    // 'archived' is entered and left only through archiveDocument /
    // unarchiveDocument (each audited): the status select never offers it.
    const templateKey = str(formData, 'templateKey', 40) || 'report';
    if (!TEMPLATE_KEYS.includes(templateKey)) throw new Error('Unknown template');
    const slug = str(formData, 'slug', 80).toLowerCase();
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
      if (status === 'archived' && current.status !== 'archived') throw new Error('Use the Archive button to archive a document.');
      if (status !== 'archived' && current.status === 'archived') throw new Error('This document is archived. Use "Restore as draft" to bring it back.');
      await validateAddress(client, { id, slug, projectSlug: str(formData, 'projectSlug', 80), shortPath: str(formData, 'shortPath', 90).toLowerCase() });
      const before = await snapshotOf(client, id);
      const allowScripts = s.role === 'owner' ? flag(formData, 'allowScripts') : current.allowScripts; // owner-only field
      const title = str(formData, 'title', 200);
      const author = str(formData, 'author', 120);
      // Builder documents post their blocks as JSON; body_html_raw is
      // generated from them (docs/systems/document-builder.md). A legacy
      // document posts the HTML box.
      const blocksText = formData.get('bodyBlocks');
      let bodyBlocks = current.bodyBlocks || null;
      let bodyHtmlRaw = String(formData.get('bodyHtmlRaw') ?? '');
      if (typeof blocksText === 'string' && blocksText.trim()) {
        let input;
        try { input = JSON.parse(blocksText); } catch { throw new Error('The block data could not be read; reload the page and try again.'); }
        const out = await blocksToRaw(client, input, { title, author });
        bodyBlocks = out.body;
        bodyHtmlRaw = out.html;
      }
      const next = {
        ...current,
        title, slug, category: str(formData, 'category', 60), author, templateKey, status,
        projectSlug: str(formData, 'projectSlug', 80), // projects.slug soft link — sets the page's address (docs/systems/projects.md)
        shortPath: str(formData, 'shortPath', 90).toLowerCase(), // optional /alias → 301 (validated above)
        sortOrder: Number(str(formData, 'sortOrder', 10) || 0),
        bodyHtmlRaw, bodyBlocks,
        pageCss: String(formData.get('pageCss') ?? ''),
        metaTitle: str(formData, 'metaTitle', 200), metaDescription: str(formData, 'metaDescription', 400),
        metaKeywords: str(formData, 'metaKeywords', 400), canonicalUrl: str(formData, 'canonicalUrl', 300),
        ogType: str(formData, 'ogType', 40), ogTitle: str(formData, 'ogTitle', 200), ogDescription: str(formData, 'ogDescription', 400),
        ogImage: str(formData, 'ogImage', 300), twitterCard: str(formData, 'twitterCard', 40),
        noindex: flag(formData, 'noindex'), nofollow: flag(formData, 'nofollow'),
        jsonldType: str(formData, 'jsonldType', 60), jsonldOverrides, allowScripts,
        sitemapPriority: str(formData, 'sitemapPriority', 5),
      };
      if (next.sitemapPriority && !/^(0(\.\d)?|1(\.0)?)$/.test(next.sitemapPriority)) {
        throw new Error('Sitemap priority must be 0.0–1.0 (e.g. 0.7) or blank');
      }
      // URL fields: absolute https only; the canonical must stay on this site.
      const SITE = 'https://utahciviccompact.org';
      if (next.canonicalUrl && !next.canonicalUrl.startsWith(SITE + '/')) throw new Error(`Canonical URL must start with ${SITE}/`);
      if (next.ogImage && !/^https:\/\/[^\s"<>]+$/.test(next.ogImage)) throw new Error('og:image must be an absolute https URL');
      if (!next.title) throw new Error('Title is required');
      const foreignClassMap = await loadForeignClassMap(client, templateKey);
      const result = runIngest(next, { siteCss: sources.siteCss, foreignClassMap });
      next.bodyHtmlNormalized = result.bodyHtmlNormalized;
      next.ingestReport = result.report;
      if (status === 'published' && !result.ok) {
        throw new Error(`Cannot publish: ${result.report.a11y.map(a => a.message).join(' ')} Fix the HTML or save as draft.`);
      }
      // Tokens are validated here too: a bad {{coverage:}}/{{video:}} would
      // otherwise abort the whole site publish for everyone.
      const tokenProblems = await tokenErrors(client, result.bodyHtmlNormalized, sources);
      if (tokenProblems.length) {
        if (status === 'published') throw new Error(`Cannot publish: ${tokenProblems.join('; ')}`);
        result.report.warnings.push(...tokenProblems.map(t => `Token problem (blocks publishing): ${t}`));
      }
      if (status === 'published' && !next.metaDescription) throw new Error('A meta description is required to publish (SEO §12).');
      if (status === 'published' && !current.publishedAt) next.publishedAt = new Date().toISOString();
      await upsertDocument(client, next);
      if (next.publishedAt && !current.publishedAt) await client.query('UPDATE documents SET published_at = now() WHERE id = $1', [id]);
      // Every use of the script escape hatch is audited separately (spec §5).
      if (Number(next.allowScripts) !== Number(current.allowScripts)) {
        await recordChange(client, { actor: s.email, action: next.allowScripts ? 'document.allow_scripts.on' : 'document.allow_scripts.off', entityType: 'document', entityId: id });
      }
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

// assignDocuments: move the ticked documents to a project (or out of one).
// Each move is validated like a save (slug free in the target, no clash with
// a sub-project) and recorded as its own revision + 'document.move' audit
// row; the next publish writes the new addresses and 301s from the old ones.
export async function assignDocuments(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const ids = formData.getAll('ids').map(String).filter(v => /^[0-9a-f-]{36}$/.test(v));
    if (!ids.length) throw new Error('Tick at least one document first');
    if (ids.length > 200) throw new Error('Too many at once');
    const projectSlug = str(formData, 'projectSlug', 80);
    let moved = 0;
    await withWriteTx(async (client) => {
      for (const id of ids) {
        const current = await getDocument(client, { id });
        if (!current) continue;
        if ((current.projectSlug || '') === projectSlug) continue;
        await validateAddress(client, { id, slug: current.slug, projectSlug, shortPath: current.shortPath });
        const before = await snapshotOf(client, id);
        await client.query('UPDATE documents SET project_slug = $2, updated_at = now() WHERE id = $1', [id, projectSlug || null]);
        await recordChange(client, { actor: s.email, action: 'document.move', entityType: 'document', entityId: id, snapshot: before, diff: { slug: current.slug, from: current.projectSlug || '', to: projectSlug } });
        moved++;
      }
    });
    revalidatePath('/documents');
    revalidatePath('/projects');
    return { ok: true, message: moved ? `Moved ${moved} document${moved === 1 ? '' : 's'}. Publish to make the new addresses live (the old ones redirect).` : 'Nothing to move — already there.' };
  });
}

export async function deleteDocument(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    await withWriteTx(async (client) => {
      const before = await snapshotOf(client, id);
      if (!before) throw new Error('Document not found');
      if (before.status === 'published') throw new Error('Archive the document (or save it as a draft) before deleting.');
      await deleteDocumentRow(client, id);
      await recordChange(client, { actor: s.email, action: 'document.delete', entityType: 'document', entityId: id, snapshot: before });
    });
    revalidatePath('/documents');
    redirect('/documents');
  });
}

// archiveDocument: take a document down for good (docs/systems/documents.md
// "Archiving"). Sets status 'archived' and nothing else; the next approved
// publish deletes the page and its page CSS from the site bucket, invalidates
// them at the edge, drops the page from the sitemap, author pages and the
// Writing page, and writes a 410 Gone for /<slug> into the KeyValueStore.
// The slug stays reserved (the fixed template never resurrects, §3.2) and
// the body, styling and revisions are kept so the piece can be restored.
async function setArchived(formData, archived) {
  const s = await requireRole('editor');
  const id = str(formData, 'id', 80);
  await withWriteTx(async (client) => {
    const before = await snapshotOf(client, id);
    if (!before) throw new Error('Document not found');
    if (archived && before.status === 'archived') throw new Error('Already archived.');
    if (!archived && before.status !== 'archived') throw new Error('This document is not archived.');
    await client.query(`UPDATE documents SET status = $2, updated_at = now() WHERE id = $1`, [id, archived ? 'archived' : 'draft']);
    await recordChange(client, {
      actor: s.email, action: archived ? 'document.archive' : 'document.unarchive', entityType: 'document', entityId: id,
      snapshot: before, diff: { slug: before.slug, status: archived ? 'archived' : 'draft', was: before.status },
    });
  });
  revalidatePath(`/documents/${id}`);
  revalidatePath('/documents');
  return id;
}

export async function archiveDocument(prevState, formData) {
  return runAction(async () => {
    await setArchived(formData, true);
    return { ok: true, message: 'Archived. The page comes off the site, and /slug answers "410 Gone", when the next publish request is approved.' };
  });
}

export async function unarchiveDocument(prevState, formData) {
  return runAction(async () => {
    await setArchived(formData, false);
    return { ok: true, message: 'Restored as a draft. Set it to published and request a publish to put it back on the site.' };
  });
}

// setOverrides({ documentId, nids: [], classes: [], mode }) — one or many
// elements (the bulk actions send several nids at once).
export async function setOverrides(payload) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const { documentId, nids, classes, mode } = payload || {};
    if (!documentId || !Array.isArray(nids) || !nids.length) throw new Error('Nothing selected');
    if (nids.length > 500) throw new Error('Too many elements at once (max 500)');
    const sources = await loadSiteSources();
    await withWriteTx(async (client) => {
      const doc = await getDocument(client, { id: documentId });
      if (!doc) throw new Error('Document not found');
      const known = styleKitFor(sources.siteCss, doc.pageCss).known;
      const clean = [...new Set((classes || []).map(String))].filter(c => known.has(c));
      const unknown = (classes || []).filter(c => !known.has(c));
      if (unknown.length) throw new Error(`Not in the Style Kit: ${unknown.join(', ')}`);
      // Bulk append MERGES with each target's existing override; a single
      // target (the picker) and replace mode set exactly what was sent.
      const existing = new Map((await listOverrides(client, documentId)).map(o => [o.nid, o]));
      for (const nid of nids) {
        const prior = existing.get(String(nid));
        const merged = mode === 'append' && nids.length > 1 && prior ? [...new Set([...prior.classes, ...clean])] : clean;
        await setOverride(client, { documentId, nid: String(nid), classes: merged, mode });
      }
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
    let id;
    await withWriteTx(async (client) => {
      // Page rules may use the page's own stylesheet classes; template rules only the site kit.
      const pageCss = rule.scope === 'page' ? (await getDocument(client, { id: rule.documentId }))?.pageCss || '' : '';
      const known = styleKitFor(sources.siteCss, pageCss).known;
      const unknown = rule.classes.filter(c => !known.has(c));
      if (unknown.length) throw new Error(`Not in the Style Kit: ${unknown.join(', ')}`);
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

// convertUpload(formData): a .docx or Markdown file → the HTML fragment for
// the Body HTML box (docs/systems/documents.md "Upload a file"). Called
// directly from the client (not via ActionForm); nothing is stored, the
// editor still has to save, which runs the ingest. 8 MB cap matches
// next.config.js bodySizeLimit.
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export async function convertUpload(formData) {
  return runAction(async () => {
    await requireRole('editor');
    const file = formData.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('No file received');
    if (file.size > UPLOAD_MAX_BYTES) throw new Error('File is larger than 8 MB');
    const kind = uploadKind(file.name);
    let out;
    if (kind === 'docx') out = await docxToHtml(Buffer.from(await file.arrayBuffer()));
    else if (kind === 'markdown') out = markdownToHtml(await file.text());
    // .html normally never reaches the server (html-editor.js reads it in the
    // browser), but a phone picker can hand over a file whose name lost its
    // extension while its type is still text/html — accept it as-is here too.
    else if (kind === 'html' || file.type === 'text/html') out = { html: await file.text(), imagesOmitted: 0, warnings: [] };
    else throw new Error('Upload a .docx, .md or .html file');
    console.log(`[documents] convert ${kind} "${file.name}" ${file.size}B -> ${out.html.length} chars, ${out.imagesOmitted} images omitted${out.warnings?.length ? `, warnings: ${out.warnings.join(' | ')}` : ''}`);
    return { ok: true, html: out.html, imagesOmitted: out.imagesOmitted, warnings: out.warnings || [] };
  });
}
