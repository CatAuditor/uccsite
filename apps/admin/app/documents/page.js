// Documents list (spec §3.2): grouped by category (planning addendum 3),
// with status, live state and the last publish error; plus "new document".
// Every document shows its address (nested under its project when it has
// one — docs/systems/projects.md) and can be moved to a project in bulk.
import Link from 'next/link';
import { listDocuments } from '@uccsite/db/documents';
import { documentUrl } from '@uccsite/render/projects';
import { listProjects } from '../../lib/files';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import ActionForm from '../action-form';
import { createDocument, assignDocuments } from './actions';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage({ searchParams }) {
  const session = await requireSession();
  const { category, status, project } = await searchParams;
  // Sequential: one pg Client cannot run two queries at once.
  const { everything, projects } = await withDb(async (client) => ({ everything: await listDocuments(client), projects: await listProjects(client) }));
  const projectFor = (d) => projects.find(p => p.slug === d.projectSlug) || null;
  const projectName = projects.find(p => p.slug === project)?.name || project;
  // Archived documents are off the site; they live under ?status=archived only.
  const showArchived = status === 'archived';
  const archivedCount = everything.filter(d => d.status === 'archived').length;
  const all = everything.filter(d => (d.status === 'archived') === showArchived);
  const categories = [...new Set(everything.filter(d => d.status !== 'archived').map(d => d.category || 'Uncategorized'))];
  const byCategory = category ? all.filter(d => (d.category || 'Uncategorized') === category) : all;
  const docs = project ? byCategory.filter(d => d.projectSlug === project) : byCategory;
  const projectCounts = new Map(projects.map(p => [p.slug, all.filter(d => d.projectSlug === p.slug).length]));
  const readOnly = session.role === 'viewer';

  return (
    <div>
      <h1>{showArchived ? 'Archived documents' : project ? `${projectName} — documents` : category ? category : 'Long-form Documents'}</h1>
      {showArchived && (
        <p className="notice">
          These are off the site: not rendered, listed or in the sitemap, and each address answers &quot;410 Gone&quot; once the
          archive has been published. Open one and use <strong>Restore as draft</strong> to bring it back.{' '}
          <Link href="/documents">Back to all documents</Link>
        </p>
      )}
      <div className="notice">
        <strong>Writing a new piece?</strong> Download the authoring and style kit first and give it to Claude, or to
        whoever is writing, before the draft starts. It is one web page that carries the site&apos;s voice rules (what we
        never publish), the page fields the admin asks for, the HTML the editor accepts, and the site&apos;s styling: the
        live stylesheet, every class a writer may use with its CSS, and a sample page rendered with them. Open it in a
        browser to read it; hand the file to Claude as it is. Ask for prose and upload the finished <code>.docx</code>,{' '}
        <code>.md</code> or <code>.html</code> into a document, or ask for the HTML fragment and paste it. The kit is rebuilt
        from the live stylesheet every time you download it.{' '}
        <a href="/documents/authoring-kit" download>Download the authoring and style kit (.html)</a>
      </div>
      <p className="notice">
        A Document is pasted HTML plus its own page CSS and SEO fields. Saving runs the ingest
        report; the site changes when a publish request is approved on Publish &amp; Status. Categories: {categories.map((c, i) => (
          <span key={c}>{i ? ' · ' : ''}<Link href={`/documents?category=${encodeURIComponent(c)}`}>{c}</Link></span>
        ))}{category && <> · <Link href="/documents">all</Link></>}
        {archivedCount > 0 && !showArchived && <> · <Link href="/documents?status=archived">Archived ({archivedCount})</Link></>}
      </p>
      {projects.length > 0 && (
        <p className="notice">
          By project: {projects.map((p, i) => (
            <span key={p.slug}>{i ? ' · ' : ''}<Link href={`/documents?project=${encodeURIComponent(p.slug)}`}>{p.isSub ? '↳ ' : ''}{p.name} ({projectCounts.get(p.slug) || 0})</Link></span>
          ))}{project && <> · <Link href="/documents">all</Link></>}. A document under a project publishes at <code>/projects/&lt;project&gt;/&lt;slug&gt;</code>; tick documents below to move several at once.
          {project && <> · <Link href={`/projects/${encodeURIComponent(project)}`}>Open the {projectName} workspace</Link></>}
        </p>
      )}
      <ActionForm action={assignDocuments} successMessage="Moved. Publish to make the new addresses live (the old ones redirect).">
        <table>
          <thead><tr>{!readOnly && <th aria-label="Select" />}<th>Title</th><th>Address</th><th>Category</th><th>Project</th><th>Status</th><th>Live</th><th>Updated</th></tr></thead>
          <tbody>
            {docs.map((d) => {
              const p = projectFor(d);
              return (
                <tr key={d.id}>
                  {!readOnly && <td><input type="checkbox" name="ids" value={d.id} aria-label={`Select ${d.title}`} /></td>}
                  <td><Link href={`/documents/${d.id}`}>{d.title}</Link></td>
                  <td><code>{documentUrl(d, projects)}</code>{d.shortPath && <div className="hint">also {d.shortPath}</div>}</td>
                  <td>{d.category}</td>
                  <td>{p ? <Link href={`/projects/${p.slug}`}>{p.name}</Link> : d.projectSlug ? <span className="status-failed" title="No project has this slug any more">{d.projectSlug}?</span> : ''}</td>
                  <td className={d.status === 'published' ? 'status-succeeded' : d.status === 'archived' ? 'status-failed' : 'status-noop'}>{d.status}</td>
                  <td>
                    {d.lastPublishError ? <span className="status-failed" title={d.lastPublishError}>publish error</span>
                      : !d.liveAt ? '—'
                      : d.updatedAt > d.liveAt ? <span className="status-publishing" title={`live ${d.liveAt.slice(0, 16)}`}>edited since publish</span>
                      : d.liveAt.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td>{d.updatedAt?.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              );
            })}
            {!docs.length && <tr><td colSpan="8">No documents{project ? ' under this project' : category ? ' in this category' : ''}.</td></tr>}
          </tbody>
        </table>
        {!readOnly && docs.length > 0 && (
          <div className="list-tools">
            <label htmlFor="assign-project">Move the ticked documents to</label>
            <select id="assign-project" name="projectSlug" defaultValue="">
              <option value="">— no project (publish at /slug) —</option>
              {projects.map(p => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </select>
            <button type="submit" className="secondary">Move</button>
          </div>
        )}
      </ActionForm>

      {!readOnly && (
        <>
          <h2>New document</h2>
          <ActionForm className="editor" action={createDocument}>
            <label htmlFor="new-file">Start from a file (optional): .docx from Word, Google Docs or Claude Docs, .md Markdown, or .html</label>
            <input type="file" id="new-file" name="file" accept=".html,.htm,.docx,.md,.markdown,.txt,text/html,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            <div className="hint">The title, author, summary, byline and sections are read from the file and become editable blocks. Leave the title and slug blank to take them from the file.</div>
            <label htmlFor="new-title">Title</label>
            <input type="text" id="new-title" name="title" placeholder="blank = the file's heading" />
            <label htmlFor="new-slug">Slug (URL path)</label>
            <input type="text" id="new-slug" name="slug" placeholder="blank = made from the title" pattern="[a-z0-9][a-z0-9-]*" />
            <div className="hint">Lowercase letters, digits, dashes. The page publishes at /slug, or at /projects/&lt;project&gt;/slug when a project is chosen below.</div>
            <label htmlFor="new-category">Category</label>
            <input type="text" id="new-category" name="category" list="doc-categories" defaultValue="Reports" />
            <datalist id="doc-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
            <label htmlFor="new-project">Project</label>
            <select id="new-project" name="projectSlug" defaultValue={project || ''}>
              <option value="">— none —</option>
              {projects.map(p => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </select>
            <div className="hint">Optional. The page then lives under that project (listed on its page, nested address); change it any time in the editor.</div>
            <button type="submit">Create draft and open the builder</button>
          </ActionForm>
        </>
      )}
    </div>
  );
}
