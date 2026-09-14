// Project files (docs/systems/files.md): a signed-in file store organised by
// project, then by folder. Download = presigned GET (any role); upload,
// move, note, publish to /files/*, unpublish and delete = editor+.
import Link from 'next/link';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { config } from '../../lib/config';
import { listFiles, listProjects } from '../../lib/files';
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, MAX_PUBLIC_BYTES } from '@uccsite/db/files';
import ActionForm from '../action-form';
import FileUploader from './uploader';
import { saveFileDetails, publish, unpublish, remove } from './actions';

export const dynamic = 'force-dynamic';

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '');
const GENERAL = '_general';

function href(project, folder) {
  const q = new URLSearchParams();
  if (project) q.set('project', project);
  if (folder) q.set('folder', folder);
  const s = q.toString();
  return s ? `/files?${s}` : '/files';
}

export default async function FilesPage({ searchParams }) {
  const session = await requireSession();
  const readOnly = session.role === 'viewer';
  const { project: projectParam = '', folder: folderParam = '' } = await searchParams;
  const [files, projects] = await withDb((client) => Promise.all([listFiles(client), listProjects(client)]));

  const names = new Map(projects.map(p => [p.slug, p.name]));
  const projectLabel = (slug) => (!slug ? 'General' : names.get(slug) || `${slug} (project no longer exists)`);
  const counts = new Map();
  for (const f of files) counts.set(f.projectSlug, (counts.get(f.projectSlug) || 0) + 1);
  // Slugs that only exist on files (project renamed/deleted) still get a tab.
  const orphanSlugs = [...counts.keys()].filter(s => s && !names.has(s));

  const selectedSlug = projectParam === GENERAL ? '' : projectParam;
  const inProject = projectParam ? files.filter(f => f.projectSlug === selectedSlug) : files;
  const folders = [...new Set(inProject.map(f => f.folder).filter(Boolean))].sort();
  const shown = (folderParam ? inProject.filter(f => f.folder === folderParam || f.folder.startsWith(`${folderParam}/`)) : inProject)
    .sort((a, b) => a.projectSlug.localeCompare(b.projectSlug) || a.folder.localeCompare(b.folder) || a.originalFilename.localeCompare(b.originalFilename));

  return (
    <div>
      <h1>Files</h1>
      <p className="notice">
        Files are private to signed-in admins until <strong>Publish</strong> copies one to the live site at
        <code> /files/…</code> and lists it on the project's block on /projects (after the next site Publish).
        Unpublish or delete takes the public copy down (cached copies expire within 5 minutes).
        Files over {MAX_PUBLIC_BYTES / 1024 / 1024} MB stay private — host those on archive.org or YouTube and link to them.
        Organise by project, then by folder.
      </p>

      <div className="files-tabs">
        <Link href="/files" className={!projectParam ? 'active' : ''}>All ({files.length})</Link>
        <Link href={href(GENERAL)} className={projectParam === GENERAL ? 'active' : ''}>General ({counts.get('') || 0})</Link>
        {projects.map(p => (
          <Link key={p.slug} href={href(p.slug)} className={projectParam === p.slug ? 'active' : ''}>{p.name} ({counts.get(p.slug) || 0})</Link>
        ))}
        {orphanSlugs.map(s => (
          <Link key={s} href={href(s)} className={projectParam === s ? 'active' : ''} title="No project has this slug any more — move these files">{s}? ({counts.get(s)})</Link>
        ))}
      </div>
      {folders.length > 0 && (
        <div className="files-folders">
          <Link href={href(projectParam)} className={!folderParam ? 'active' : ''}>All folders</Link>
          {folders.map(d => (
            <Link key={d} href={href(projectParam, d)} className={folderParam === d ? 'active' : ''}>{d}</Link>
          ))}
        </div>
      )}

      {readOnly ? <p className="notice">Viewer role — download only.</p>
        : <FileUploader projects={projects} accept={ACCEPTED_EXTENSIONS.map(e => `.${e}`).join(',')}
            maxBytes={MAX_FILE_BYTES} defaultProject={selectedSlug} defaultFolder={folderParam} />}

      <h2>{projectParam ? projectLabel(selectedSlug) : 'All files'}{folderParam ? ` / ${folderParam}` : ''} ({shown.length})</h2>
      <table className="files-table">
        <thead><tr><th>File</th><th>Project / folder</th><th>Size</th><th>Uploaded</th><th>Public</th>{!readOnly && <th>Actions</th>}</tr></thead>
        <tbody>
          {shown.map((f) => (
            <tr key={f.id} className={f.status !== 'ready' ? 'status-failed' : ''}>
              <td>
                {f.downloadUrl ? <a href={f.downloadUrl}>{f.originalFilename}</a> : <span title="The upload never completed">{f.originalFilename} (incomplete)</span>}
                {f.note && <div className="hint">{f.note}</div>}
              </td>
              <td>{projectLabel(f.projectSlug)}{f.folder ? <span className="hint"> / {f.folder}</span> : ''}</td>
              <td>{fmtBytes(f.bytes)}</td>
              <td><div className="hint">{f.uploadedBy}<br />{fmtDate(f.createdAt)}</div></td>
              <td>
                {f.publicPath
                  ? <a href={`${config.publicOrigin}${f.publicPath}`} target="_blank" rel="noopener" className="status-succeeded">live</a>
                  : <span className="status-noop">private</span>}
                {f.publishedAt && <div className="hint">{fmtDate(f.publishedAt)}</div>}
              </td>
              {!readOnly && (
                <td className="files-actions">
                  {f.status === 'ready' && (
                    <ActionForm action={f.publicPath ? unpublish : publish} className="inline">
                      <input type="hidden" name="id" value={f.id} />
                      <button type="submit" disabled={!f.publicPath && f.bytes > MAX_PUBLIC_BYTES}
                        title={!f.publicPath && f.bytes > MAX_PUBLIC_BYTES ? `Over the ${MAX_PUBLIC_BYTES / 1024 / 1024} MB publish cap` : ''}>
                        {f.publicPath ? 'Unpublish' : 'Publish'}
                      </button>
                    </ActionForm>
                  )}
                  <ActionForm action={remove} className="inline">
                    <input type="hidden" name="id" value={f.id} />
                    <button type="submit" className="danger">Delete</button>
                  </ActionForm>
                  <details>
                    <summary>Move / note</summary>
                    <ActionForm action={saveFileDetails} className="files-details">
                      <input type="hidden" name="id" value={f.id} />
                      <label htmlFor={`project-${f.id}`}>Project</label>
                      <select id={`project-${f.id}`} name="project" defaultValue={names.has(f.projectSlug) ? f.projectSlug : ''}>
                        <option value="">General (no project)</option>
                        {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                      </select>
                      <label htmlFor={`folder-${f.id}`}>Folder</label>
                      <input type="text" id={`folder-${f.id}`} name="folder" defaultValue={f.folder} placeholder="e.g. Records requests/2026" />
                      <label htmlFor={`note-${f.id}`}>Note</label>
                      <input type="text" id={`note-${f.id}`} name="note" defaultValue={f.note} placeholder="What this file is" />
                      <button type="submit">Save</button>
                    </ActionForm>
                  </details>
                  {f.publicPath && <div className="hint"><code>{f.publicPath}</code></div>}
                </td>
              )}
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={readOnly ? 5 : 6}>No files here yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
