// Project workspace server helpers (docs/systems/projects.md "Workspace"):
// everything under one project — its record, sub-projects, documents, files
// and internal notes arranged as one folder tree — plus the note upload
// conversion (.md as is, .docx → markdown).
import mammoth from 'mammoth';
import { listDocuments } from '@uccsite/db/documents';
import { listNotes } from '@uccsite/db/project-notes';
import { documentUrl } from '@uccsite/render/projects';
import { listFiles, listProjects } from './files';

export const NOTE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

// noteUploadToMarkdown(file) → { markdown, title, sourceFilename, warnings }
// .md/.markdown/.txt are taken verbatim; .docx goes through mammoth's markdown
// writer (images are dropped — a note is text). The title is the first
// heading, else the file name without its extension.
export async function noteUploadToMarkdown(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) throw new Error('No file received');
  if (file.size > NOTE_UPLOAD_MAX_BYTES) throw new Error('File is larger than 8 MB');
  const name = String(file.name || 'note');
  let markdown;
  let warnings = [];
  if (/\.docx$/i.test(name)) {
    const res = await mammoth.convertToMarkdown({ buffer: Buffer.from(await file.arrayBuffer()) });
    markdown = String(res.value || '').replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '*[image omitted]*');
    warnings = [...new Set(res.messages.filter(m => m.type === 'warning').map(m => m.message))];
  } else if (/\.(md|markdown|txt)$/i.test(name)) {
    markdown = await file.text();
  } else {
    throw new Error('Upload a .md, .txt or .docx file');
  }
  markdown = markdown.replace(/\r\n/g, '\n').trim();
  const heading = markdown.match(/^#\s+(.+)$/m);
  const title = heading ? heading[1].trim() : name.replace(/\.[^.]+$/, '');
  if (heading) markdown = markdown.replace(heading[0], '').trim();
  return { markdown, title, sourceFilename: name.slice(0, 200), warnings };
}

// workspace(client, slug) → null | { project, projects, parent, children,
//   documents, files, notes, folders: [{ path, files, notes }], counts }
// Sequential queries: one pg Client cannot run two at once.
export async function workspace(client, slug) {
  const projects = await listProjects(client);
  const project = projects.find(p => p.slug === slug);
  if (!project) return null;
  const parent = project.parentSlug ? projects.find(p => p.slug === project.parentSlug) || null : null;
  const children = projects.filter(p => p.parentSlug === slug);
  const documents = (await listDocuments(client)).filter(d => d.projectSlug === slug).map(d => ({ ...d, url: documentUrl(d, projects) }));
  const files = (await listFiles(client)).filter(f => f.projectSlug === slug);
  const notes = await listNotes(client, { projectSlug: slug });
  const folderMap = new Map([['', { path: '', files: [], notes: [] }]]);
  const folder = (path) => {
    // every ancestor folder exists in the tree, even when empty
    const parts = String(path || '').split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!folderMap.has(p)) folderMap.set(p, { path: p, files: [], notes: [] });
    }
    return folderMap.get(parts.join('/'));
  };
  for (const f of files) folder(f.folder).files.push(f);
  for (const n of notes) folder(n.folder).notes.push(n);
  const folders = [...folderMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of folders) {
    f.files.sort((a, b) => a.originalFilename.localeCompare(b.originalFilename));
    f.notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    f.depth = f.path ? f.path.split('/').length : 0;
    f.name = f.path ? f.path.split('/').pop() : '';
  }
  return {
    project, projects, parent, children, documents, files, notes, folders,
    counts: { documents: documents.length, files: files.length, notes: notes.length, published: documents.filter(d => d.status === 'published').length },
  };
}

// activity(client, { documents, files, notes }) → the audit rows about this
// project's things, newest first (max 60). Project-record saves are the
// collection's own rows ('projects' entity).
export async function activity(client, { documents, files, notes }) {
  const ids = [...documents.map(d => d.id), ...files.map(f => f.id), ...notes.map(n => n.id)];
  const params = [...ids];
  const inList = ids.length ? `OR entity_id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})` : '';
  const res = await client.query(
    `SELECT actor, action, entity_type, entity_id, diff, at::text AS at FROM audit_log
     WHERE entity_type = 'projects' ${inList} ORDER BY at DESC LIMIT 60`, params);
  const names = new Map([...documents.map(d => [d.id, d.title]), ...files.map(f => [f.id, f.originalFilename]), ...notes.map(n => [n.id, n.title])]);
  return res.rows.map(r => ({ ...r, name: names.get(r.entity_id) || '' }));
}
