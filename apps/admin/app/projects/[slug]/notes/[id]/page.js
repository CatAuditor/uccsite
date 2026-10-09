// One internal project note: edit, move, pin, delete, or turn into a draft
// document (docs/systems/projects.md "Notes").
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getNote } from '@uccsite/db/project-notes';
import { requireSession } from '../../../../../lib/auth';
import { withDb } from '../../../../../lib/data';
import { listProjects } from '../../../../../lib/files';
import { renderMarkdown } from '../../../../../lib/mini-markdown.mjs';
import ActionForm from '../../../../action-form';
import { saveNote, deleteNote, noteToDocument } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function NotePage({ params }) {
  const session = await requireSession();
  const { slug, id } = await params;
  const { note, projects } = await withDb(async (client) => ({ note: await getNote(client, id), projects: await listProjects(client) }));
  if (!note || note.projectSlug !== slug) notFound();
  const project = projects.find(p => p.slug === slug);
  const readOnly = session.role === 'viewer';

  return (
    <div className="doc-editor">
      <p className="hint"><Link href="/projects">Projects</Link> › <Link href={`/projects/${slug}`}>{project?.name || slug}</Link> › <Link href={`/projects/${slug}?tab=notes`}>Notes</Link> › {note.title}</p>
      <h1>{note.title} <span className="hint">internal note</span></h1>
      {readOnly && <p className="notice">Viewer role — read-only.</p>}
      <div className="note-split">
        <ActionForm className="editor doc-form" action={saveNote} successMessage="Saved.">
          <input type="hidden" name="id" value={note.id} />
          <input type="hidden" name="baseline" value={note.updatedAt} />
          <label htmlFor="title">Title</label>
          <input type="text" id="title" name="title" defaultValue={note.title} disabled={readOnly} />
          <label htmlFor="projectSlug">Project</label>
          <select id="projectSlug" name="projectSlug" defaultValue={note.projectSlug} disabled={readOnly}>
            {projects.map(p => <option key={p.slug} value={p.slug}>{p.label}</option>)}
          </select>
          <label htmlFor="folder">Folder</label>
          <input type="text" id="folder" name="folder" defaultValue={note.folder} disabled={readOnly} placeholder="blank = the project root" />
          <label htmlFor="bodyMd">Note (Markdown)</label>
          <textarea id="bodyMd" name="bodyMd" rows={24} defaultValue={note.bodyMd} disabled={readOnly} />
          <label><input type="checkbox" name="pinned" defaultChecked={note.pinned} disabled={readOnly} /> Pinned to the top</label>
          <div className="hint">{note.author && `Started by ${note.author}. `}{note.sourceFilename && `Uploaded as ${note.sourceFilename}. `}Last saved {note.updatedAt?.slice(0, 16).replace('T', ' ')}.</div>
          {!readOnly && <button type="submit">Save note</button>}
        </ActionForm>
        <div>
          <h2>Preview</h2>
          <article className="note-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.bodyMd) }} />
        </div>
      </div>
      {!readOnly && (
        <div className="list-tools">
          <ActionForm action={noteToDocument} className="inline">
            <input type="hidden" name="id" value={note.id} />
            <button type="submit" className="secondary" title="Creates a draft document under this project from this note's text; the note stays">Start a document from this note</button>
          </ActionForm>
          <ActionForm action={deleteNote} className="inline">
            <input type="hidden" name="id" value={note.id} />
            <button type="submit" className="danger">Delete note</button>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
