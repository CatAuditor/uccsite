'use server';
// Project workspace actions (docs/systems/projects.md "Workspace"): the one
// project's record, its internal notes, and "start a document from this
// note". Every action re-checks the role; results follow { ok } | { error }.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadProjects, replaceProjects } from '@uccsite/db/content';
import { getNote, upsertNote, deleteNote as deleteNoteRow } from '@uccsite/db/project-notes';
import { getDocument, upsertDocument } from '@uccsite/db/documents';
import { parse as parseBlocks, slugify } from '@uccsite/doc-blocks';
import { requireRole } from '../../../lib/auth';
import { withWriteTx, recordChange, collectionStamp } from '../../../lib/data';
import { runAction } from '../../../lib/actions';
import { CONFLICT_MESSAGE } from '../../../lib/collection-save';
import { COLLECTIONS } from '../../../lib/collections';
import { noteUploadToMarkdown } from '../../../lib/projects';
import { markdownToHtml } from '../../../lib/convert-upload.mjs';
import { blocksToRaw } from '../../../lib/documents';

const str = (fd, name, max = 2000) => String(fd.get(name) ?? '').trim().slice(0, max);
const UUID_RE = /^[0-9a-f-]{36}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

// The record fields the Overview form edits (children — press — stay as they are).
const RECORD_FIELDS = COLLECTIONS.projects.fields.filter(f => f.widget !== 'list').map(f => f.name);

// saveProject: this one project's record through the same save as the list
// editor (replaceProjects keeps ids, cascades a rename, validates the tree),
// so the two editors cannot disagree. Lost-update check on the projects table.
export async function saveProject(prevState, formData) {
  let nextSlug;
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    if (!UUID_RE.test(id)) throw new Error('Bad project id');
    const baseline = str(formData, 'baseline', 120);
    await withWriteTx(async (client) => {
      const current = await collectionStamp(client, 'projects');
      if (baseline && current !== baseline) throw new Error(CONFLICT_MESSAGE);
      const before = await loadProjects(client, { ids: true });
      const mine = before.find(p => p.id === id);
      if (!mine) throw new Error('Project not found');
      const edited = { ...mine };
      for (const f of RECORD_FIELDS) {
        const v = str(formData, f, f === 'summary' ? 20000 : 2000);
        if (v) edited[f] = v; else delete edited[f];
      }
      if (!edited.name) throw new Error('A project needs a name');
      edited.slug = String(edited.slug || '').toLowerCase();
      if (!SLUG_RE.test(edited.slug)) throw new Error('Slug must be lowercase letters, digits and dashes');
      nextSlug = edited.slug;
      const next = before.map(p => (p.id === id ? edited : p));
      await replaceProjects(client, next, { tx: false });
      await recordChange(client, {
        actor: s.email, action: 'projects.save', entityType: 'projects', entityId: 'collection',
        snapshot: before, diff: { project: edited.slug, renamed: mine.slug !== edited.slug ? { from: mine.slug, to: edited.slug } : undefined, parent: edited.parent_slug || '' },
      });
    });
    revalidatePath('/projects');
    revalidatePath(`/projects/${nextSlug}`);
    return { ok: true, message: 'Saved. Publish to make it live.' };
  });
  if (result.ok && nextSlug && nextSlug !== str(formData, 'currentSlug', 80)) redirect(`/projects/${nextSlug}`);
  return result;
}

// createNote: typed markdown and/or an uploaded .md/.docx; the upload fills
// the body (and the title when blank).
export async function createNote(prevState, formData) {
  let noteId;
  const slug = str(formData, 'projectSlug', 80);
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    if (!SLUG_RE.test(slug)) throw new Error('Bad project');
    const file = formData.get('file');
    const upload = file && typeof file.arrayBuffer === 'function' && file.size > 0 ? await noteUploadToMarkdown(file) : null;
    let body = str(formData, 'bodyMd', 200000);
    if (upload) body = body ? `${body}\n\n${upload.markdown}` : upload.markdown;
    const title = str(formData, 'title', 200) || (upload ? upload.title : '');
    if (!title) throw new Error('A note needs a title');
    await withWriteTx(async (client) => {
      const exists = (await client.query('SELECT 1 FROM projects WHERE slug = $1', [slug])).rows[0];
      if (!exists) throw new Error('Project not found');
      noteId = await upsertNote(client, { projectSlug: slug, folder: str(formData, 'folder', 400), title, bodyMd: body, sourceFilename: upload?.sourceFilename, pinned: Boolean(formData.get('pinned')), author: s.email });
      await recordChange(client, { actor: s.email, action: 'note.create', entityType: 'note', entityId: noteId, diff: { project: slug, title, upload: upload ? { file: upload.sourceFilename, warnings: upload.warnings } : undefined } });
    });
    console.log(`[projects] note created ${noteId} in ${slug}${upload ? ` from "${upload.sourceFilename}"` : ''}`);
  });
  if (result.ok && noteId) redirect(`/projects/${slug}/notes/${noteId}`);
  return result;
}

export async function saveNote(prevState, formData) {
  return runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    if (!UUID_RE.test(id)) throw new Error('Bad note id');
    const baseline = str(formData, 'baseline', 80);
    let slug;
    await withWriteTx(async (client) => {
      const before = await getNote(client, id);
      if (!before) throw new Error('Note not found');
      if (baseline && before.updatedAt !== baseline) throw new Error(CONFLICT_MESSAGE);
      const projectSlug = str(formData, 'projectSlug', 80) || before.projectSlug;
      if (!(await client.query('SELECT 1 FROM projects WHERE slug = $1', [projectSlug])).rows[0]) throw new Error('Project not found');
      slug = projectSlug;
      await upsertNote(client, { ...before, projectSlug, folder: str(formData, 'folder', 400), title: str(formData, 'title', 200), bodyMd: String(formData.get('bodyMd') ?? ''), pinned: Boolean(formData.get('pinned')) });
      await recordChange(client, { actor: s.email, action: 'note.save', entityType: 'note', entityId: id, snapshot: before, diff: { project: projectSlug, moved: projectSlug !== before.projectSlug ? { from: before.projectSlug } : undefined } });
    });
    revalidatePath(`/projects/${slug}`);
    revalidatePath(`/projects/${slug}/notes/${id}`);
    return { ok: true, message: 'Saved.' };
  });
}

export async function deleteNote(prevState, formData) {
  let slug;
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    if (!UUID_RE.test(id)) throw new Error('Bad note id');
    await withWriteTx(async (client) => {
      const before = await getNote(client, id);
      if (!before) throw new Error('Note not found');
      slug = before.projectSlug;
      await deleteNoteRow(client, id);
      await recordChange(client, { actor: s.email, action: 'note.delete', entityType: 'note', entityId: id, snapshot: before });
    });
    revalidatePath(`/projects/${slug}`);
  });
  if (result.ok && slug) redirect(`/projects/${slug}?tab=notes`);
  return result;
}

// noteToDocument: the note's markdown becomes a draft builder document under
// the same project (the upload-first path of New document, from text).
export async function noteToDocument(prevState, formData) {
  let newId;
  const result = await runAction(async () => {
    const s = await requireRole('editor');
    const id = str(formData, 'id', 80);
    if (!UUID_RE.test(id)) throw new Error('Bad note id');
    await withWriteTx(async (client) => {
      const note = await getNote(client, id);
      if (!note) throw new Error('Note not found');
      const parsed = parseBlocks(markdownToHtml(`# ${note.title}\n\n${note.bodyMd}`, { keepImages: true }).html);
      const title = note.title;
      let slug = slugify(title).slice(0, 80) || 'note';
      if (await getDocument(client, { slug, projectSlug: note.projectSlug })) slug = `${slug}-${Date.now().toString(36)}`;
      const { body, html } = await blocksToRaw(client, parsed.body, { title, author: '' });
      newId = await upsertDocument(client, { title, slug, category: 'Reports', author: '', projectSlug: note.projectSlug, templateKey: 'report', status: 'draft', sortOrder: 0, bodyHtmlRaw: html, bodyBlocks: body, pageCss: '' });
      await recordChange(client, { actor: s.email, action: 'document.create', entityType: 'document', entityId: newId, diff: { slug, title, project: note.projectSlug, fromNote: id } });
    });
  });
  if (result.ok && newId) redirect(`/documents/${newId}`);
  return result;
}
