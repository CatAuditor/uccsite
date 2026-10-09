// Projects (docs/systems/projects.md): the tree of projects — each with its
// counts and a link into its workspace (record, folders, notes, activity) —
// followed by the list editor (order, bulk fields, press coverage).
import Link from 'next/link';
import { listDocuments } from '@uccsite/db/documents';
import { noteCounts } from '@uccsite/db/project-notes';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { config } from '../../lib/config';
import { listProjects } from '../../lib/files';
import { makeCollectionPage } from '../collection-page';

export const dynamic = 'force-dynamic';

const Collection = makeCollectionPage('projects');

export default async function ProjectsPage() {
  await requireSession();
  // Sequential: one pg Client cannot run two queries at once.
  const { projects, docs, fileCounts, notes } = await withDb(async (client) => ({
    projects: await listProjects(client),
    docs: (await listDocuments(client)).filter(d => d.status !== 'archived'),
    fileCounts: new Map((await client.query('SELECT project_slug, count(*)::int AS n FROM project_files GROUP BY project_slug')).rows.map(r => [r.project_slug || '', r.n])),
    notes: await noteCounts(client),
  }));
  const docCount = (p) => docs.filter(d => d.projectSlug === p.slug).length;
  const orphanDocs = docs.filter(d => d.projectSlug && !projects.some(p => p.slug === d.projectSlug));

  return (
    <div>
      <h1>Projects</h1>
      <p className="notice">
        Every project has its own page on the site (<code>/projects/&lt;slug&gt;</code>) and a <strong>workspace</strong> here: its record,
        the documents published under it (at <code>/projects/&lt;slug&gt;/&lt;document&gt;</code>), its files and folders, and internal notes.
        A project can sit inside another (two levels). Open a project below to work in it.
      </p>
      {projects.length > 0 && (
        <table>
          <thead><tr><th>Project</th><th>Address</th><th>Status</th><th>Documents</th><th>Files</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.slug}>
                <td>{p.isSub && <span className="hint">↳ </span>}<Link href={`/projects/${p.slug}`}><strong>{p.name}</strong></Link></td>
                <td><code>{p.url}</code></td>
                <td>{p.status}</td>
                <td><Link href={`/documents?project=${encodeURIComponent(p.slug)}`}>{docCount(p)}</Link></td>
                <td><Link href={`/files?project=${encodeURIComponent(p.slug)}`}>{fileCounts.get(p.slug) || 0}</Link></td>
                <td><Link href={`/projects/${p.slug}?tab=notes`}>{notes.get(p.slug) || 0}</Link></td>
                <td><a href={`${config.publicOrigin}${p.url}`} target="_blank" rel="noopener">On the site</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {orphanDocs.length > 0 && (
        <p className="error">{orphanDocs.length} document{orphanDocs.length === 1 ? ' is' : 's are'} assigned to a project that no longer exists ({[...new Set(orphanDocs.map(d => d.projectSlug))].join(', ')}). They publish at the root until reassigned: <Link href="/documents">All documents</Link>.</p>
      )}
      <p className="hint">Documents and files not in any project: <Link href="/documents">{docs.filter(d => !d.projectSlug).length} documents</Link> · <Link href="/files?project=_general">{fileCounts.get('') || 0} files</Link>.</p>
      <h2 id="editor">All projects: order, record fields and press</h2>
      <p className="hint">Add a project here (name + slug, then open its workspace), reorder the list, or edit the press coverage and videos shown on each project page.</p>
      <Collection />
    </div>
  );
}
