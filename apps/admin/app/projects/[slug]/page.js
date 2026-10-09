// Project workspace (docs/systems/projects.md "Workspace"): one project and
// everything under it. Tabs: Overview (the record), Tree (folders holding
// documents, files and notes), Notes (write or upload), Activity (audit rows
// about this project's things).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/auth';
import { withDb, collectionStamp } from '../../../lib/data';
import { config } from '../../../lib/config';
import { workspace, activity } from '../../../lib/projects';
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from '@uccsite/db/files';
import { renderMarkdown } from '../../../lib/mini-markdown.mjs';
import ActionForm from '../../action-form';
import RequestPublish from '../../request-publish';
import FileUploader from '../../files/uploader';
import { saveProject, createNote } from './actions';

export const dynamic = 'force-dynamic';

const TABS = [['overview', 'Overview'], ['tree', 'Folders & files'], ['notes', 'Notes'], ['activity', 'Activity']];
const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '');

export default async function ProjectWorkspacePage({ params, searchParams }) {
  const session = await requireSession();
  const { slug } = await params;
  const { tab = 'overview' } = await searchParams;
  const data = await withDb(async (client) => {
    const ws = await workspace(client, slug);
    if (!ws) return null;
    return { ...ws, baseline: await collectionStamp(client, 'projects'), log: tab === 'activity' ? await activity(client, ws) : [] };
  });
  if (!data) notFound();
  const { project, projects, parent, children, documents, files, notes, folders, press, petitions, activePetition, counts, baseline, log } = data;
  const readOnly = session.role === 'viewer';
  const href = (t) => `/projects/${slug}${t === 'overview' ? '' : `?tab=${t}`}`;
  const docsByCategory = [...new Set(documents.map(d => d.category || 'Uncategorized'))].map(c => [c, documents.filter(d => (d.category || 'Uncategorized') === c)]);
  const folderOptions = [...new Set(folders.map(f => f.path).filter(Boolean))];

  return (
    <div>
      <p className="hint"><Link href="/projects">Projects</Link>{parent && <> › <Link href={`/projects/${parent.slug}`}>{parent.name}</Link></>} › {project.name}</p>
      <h1>{project.name} <span className="hint">{project.url}</span></h1>
      <p className="notice">
        <strong>{counts.documents}</strong> document{counts.documents === 1 ? '' : 's'} ({counts.published} live) · <strong>{counts.files}</strong> file{counts.files === 1 ? '' : 's'} · <strong>{counts.notes}</strong> note{counts.notes === 1 ? '' : 's'}
        {children.length > 0 && <> · <strong>{children.length}</strong> sub-project{children.length === 1 ? '' : 's'}</>}
        {' · '}<a href={`${config.publicOrigin}${project.url}`} target="_blank" rel="noopener">Project page on the site</a>
        {' · '}<strong>{counts.press}</strong> press {counts.press === 1 ? 'story' : 'stories'}
        {' · '}<Link href={`/documents?project=${encodeURIComponent(slug)}`}>New document here</Link>
      </p>

      <div className="files-tabs" role="tablist">
        {TABS.map(([t, label]) => <Link key={t} href={href(t)} className={tab === t ? 'active' : ''} role="tab" aria-selected={tab === t}>{label}</Link>)}
      </div>

      {tab === 'overview' && (
        <ActionForm className="editor" action={saveProject} successMessage="Saved. Publish to make it live.">
          <input type="hidden" name="id" value={project.id} />
          <input type="hidden" name="currentSlug" value={project.slug} />
          <input type="hidden" name="baseline" value={baseline} />
          <OverviewFields project={project} projects={projects} readOnly={readOnly} />
          {!readOnly && <><button type="submit">Save project</button><RequestPublish /></>}
          <p className="hint">Press coverage for this project is filed on <Link href="/press">Press &amp; coverage</Link> (Project field).</p>
          <p className="hint">
            Petition: {activePetition
              ? <>the live campaign <strong>{activePetition.slug}</strong> is filed here — the project page shows it with a sign button. </>
              : <>no live campaign is filed here. </>}
            {petitions.length
              ? <>Signatures under this project: {petitions.map((p, i) => <span key={p.petition}>{i ? ' · ' : ''}<strong>{p.petition}</strong> {p.n} ({p.utah} Utah)</span>)}. </>
              : <>No signatures filed under this project yet. </>}
            Campaign copy and the signature list live on <Link href="/petition">Petition</Link> (Project field).
          </p>
        </ActionForm>
      )}

      {tab === 'tree' && (
        <div>
          {children.length > 0 && (
            <>
              <h2>Sub-projects</h2>
              <ul>{children.map(c => <li key={c.slug}><Link href={`/projects/${c.slug}`}>{c.name}</Link> <span className="hint">{c.url}</span></li>)}</ul>
            </>
          )}
          <h2>Documents ({documents.length})</h2>
          {docsByCategory.map(([category, docs]) => (
            <div key={category}>
              <div className="nested-title">{category}</div>
              <table>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.id}>
                      <td><Link href={`/documents/${d.id}`}>{d.title}</Link></td>
                      <td><code>{d.url}</code>{d.shortPath && <span className="hint"> · also {d.shortPath}</span>}</td>
                      <td className={d.status === 'published' ? 'status-succeeded' : 'status-noop'}>{d.status}</td>
                      <td className="hint">{fmtDate(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {!documents.length && <p className="hint">No documents yet. <Link href={`/documents?project=${encodeURIComponent(slug)}`}>Create one under this project</Link>.</p>}

          <h2>Folders ({folders.length - 1}) · files and notes</h2>
          {!readOnly && <FileUploader projects={projects.map(p => ({ slug: p.slug, name: p.label }))} accept={ACCEPTED_EXTENSIONS.map(e => `.${e}`).join(',')} maxBytes={MAX_FILE_BYTES} defaultProject={slug} defaultFolder="" />}
          <div className="tree-folders">
            {folders.map(f => (
              <div key={f.path || '/'} className="tree-folder" style={{ marginLeft: `${f.depth * 18}px` }}>
                <div className="nested-title">{f.path ? `📁 ${f.name}` : '📁 (root)'} <span className="hint">{f.files.length} file{f.files.length === 1 ? '' : 's'}, {f.notes.length} note{f.notes.length === 1 ? '' : 's'}</span>
                  {!readOnly && <> · <Link href={`/projects/${slug}?tab=notes&folder=${encodeURIComponent(f.path)}`}>+ note here</Link></>}
                </div>
                {(f.files.length > 0 || f.notes.length > 0) && (
                  <table className="files-table">
                    <tbody>
                      {f.notes.map(n => (
                        <tr key={n.id}>
                          <td>📝 <Link href={`/projects/${slug}/notes/${n.id}`}>{n.title}</Link>{n.pinned && <span className="chip"> pinned</span>}</td>
                          <td className="hint">note{n.sourceFilename ? ` · from ${n.sourceFilename}` : ''}</td>
                          <td className="hint">{n.author}</td>
                          <td className="hint">{fmtDate(n.updatedAt)}</td>
                        </tr>
                      ))}
                      {f.files.map(x => (
                        <tr key={x.id} className={x.status !== 'ready' ? 'status-failed' : ''}>
                          <td>📄 {x.downloadUrl ? <a href={x.downloadUrl}>{x.originalFilename}</a> : <span>{x.originalFilename} (incomplete)</span>}{x.note && <div className="hint">{x.note}</div>}</td>
                          <td className="hint">{fmtBytes(x.bytes)}{x.publicPath ? <> · <a href={`${config.publicOrigin}${x.publicPath}`} target="_blank" rel="noopener" className="status-succeeded">live</a></> : x.publishRequestedAt ? <> · <span className="status-pending">awaiting approval</span></> : ' · private'}</td>
                          <td className="hint">{x.uploadedBy}</td>
                          <td className="hint">{fmtDate(x.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
          <p className="hint">Publish, unpublish, move or delete files on the <Link href={`/files?project=${encodeURIComponent(slug)}`}>Files page</Link>.</p>

          <h2>Press ({press.length})</h2>
          <p className="hint">Stories filed under this project: shown on its page and in the coverage strip inside its reports. Edit them on <Link href="/press">Press &amp; coverage</Link> (set the Project field to file a story here).</p>
          {press.length > 0 && (
            <table>
              <tbody>
                {press.map((it, i) => (
                  <tr key={i}>
                    <td>{it.type === 'video' ? '🎬' : '📰'} <a href={it.url || (it.youtube_id ? `https://www.youtube.com/watch?v=${it.youtube_id}` : '#')} target="_blank" rel="noopener">{it.headline}</a></td>
                    <td className="hint">{it.outlet}</td>
                    <td className="hint">{it.date}</td>
                    <td className="hint">{it.featured === '1' ? 'homepage' : ''}{it.hide_from_news === '1' ? ' · not on News & Media' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <NotesTab slug={slug} notes={notes} folderOptions={folderOptions} defaultFolder={String((await searchParams).folder || '')} readOnly={readOnly} />
      )}

      {tab === 'activity' && (
        <div>
          <h2>Activity</h2>
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Thing</th></tr></thead>
            <tbody>
              {log.map((r, i) => (
                <tr key={i}>
                  <td>{r.at?.slice(0, 19).replace('T', ' ')}</td>
                  <td>{r.actor}</td>
                  <td>{r.action}</td>
                  <td>{r.name || (r.entity_type === 'projects' ? 'project list' : r.entity_id)}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan="4">Nothing recorded for this project yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OverviewFields({ project, projects, readOnly }) {
  const parents = projects.filter(p => !p.isSub && p.slug !== project.slug);
  const fields = [
    ['name', 'Project name', ''],
    ['slug', 'Slug', 'lowercase-with-dashes. The project page is /projects/<slug>. Renaming keeps every document, file and note attached and the next publish redirects the old addresses.'],
    ['date', 'Date', 'e.g. August 2026 (used for "newest first")'],
    ['author', 'Lead (team member’s full name)', ''],
    ['status', 'Status', 'e.g. Active, Closed'],
    ['status_color', 'Status colour', 'hex, e.g. #c0392b'],
    ['region', 'Region', ''],
    ['cta_url', 'Button link', 'the main report’s address, e.g. /projects/alpr/report'],
    ['cta_text', 'Button text', ''],
  ];
  return (
    <fieldset className="item">
      <legend>Project record</legend>
      {fields.map(([name, label, hint]) => (
        <div key={name}>
          <label htmlFor={`p-${name}`}>{label}</label>
          <input type="text" id={`p-${name}`} name={name} defaultValue={project[name] || ''} disabled={readOnly} />
          {hint && <div className="hint">{hint}</div>}
        </div>
      ))}
      <label htmlFor="p-parent">Part of</label>
      <select id="p-parent" name="parent_slug" defaultValue={project.parentSlug || ''} disabled={readOnly || projects.some(p => p.parentSlug === project.slug)}>
        <option value="">— a top-level project —</option>
        {parents.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
      </select>
      <div className="hint">{projects.some(p => p.parentSlug === project.slug) ? 'This project has sub-projects, so it stays top-level (two levels at most).' : 'Making this a sub-project moves it, and every document under it, to /projects/<parent>/<slug>.'}</div>
      <label htmlFor="p-tagline">Tagline</label>
      <textarea id="p-tagline" name="tagline" defaultValue={project.tagline || ''} disabled={readOnly} rows={3} />
      <label htmlFor="p-summary">Project page intro</label>
      <textarea id="p-summary" name="summary" defaultValue={project.summary || ''} disabled={readOnly} rows={8} />
      <div className="hint">Shown on the project page under the button. Supports **bold**, *italic*, [link text](https://url). Blank line = new paragraph.</div>
    </fieldset>
  );
}

function NotesTab({ slug, notes, folderOptions, defaultFolder, readOnly }) {
  return (
    <div>
      <h2>Notes ({notes.length})</h2>
      <p className="notice">Internal working notes: never published, visible to everyone with an admin login. Type in Markdown or upload a <code>.md</code> or <code>.docx</code> (Word, Google Docs, Claude). A note can later become a draft document.</p>
      {!readOnly && (
        <ActionForm className="editor" action={createNote} successMessage="Note saved.">
          <input type="hidden" name="projectSlug" value={slug} />
          <label htmlFor="n-title">Title</label>
          <input type="text" id="n-title" name="title" placeholder="blank = the file’s heading or name" />
          <label htmlFor="n-folder">Folder (optional)</label>
          <input type="text" id="n-folder" name="folder" list="note-folders" defaultValue={defaultFolder} placeholder="e.g. Records requests/2026" />
          <datalist id="note-folders">{folderOptions.map(f => <option key={f} value={f} />)}</datalist>
          <label htmlFor="n-file">Upload (optional): .md, .txt or .docx</label>
          <input type="file" id="n-file" name="file" accept=".md,.markdown,.txt,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          <label htmlFor="n-body">Note</label>
          <textarea id="n-body" name="bodyMd" rows={10} placeholder="Markdown. Headings with #, bullets with -, **bold**, links as [text](https://…)" />
          <label><input type="checkbox" name="pinned" /> Pin to the top</label>
          <button type="submit">Add note</button>
        </ActionForm>
      )}
      {notes.map(n => (
        <article key={n.id} className="note-card">
          <h3><Link href={`/projects/${slug}/notes/${n.id}`}>{n.title}</Link>{n.pinned && <span className="chip"> pinned</span>}</h3>
          <div className="hint">{n.folder ? `${n.folder} · ` : ''}{n.author} · {fmtDate(n.updatedAt)}{n.sourceFilename ? ` · from ${n.sourceFilename}` : ''}</div>
          <div className="note-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.bodyMd.length > 1200 ? `${n.bodyMd.slice(0, 1200)}…` : n.bodyMd) }} />
        </article>
      ))}
      {!notes.length && <p className="hint">No notes yet.</p>}
    </div>
  );
}
