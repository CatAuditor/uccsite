// Projects editor (docs/systems/projects.md) with, above it, each project's
// nested things — its documents, its files and its block on the site — so
// an admin can get from a project to everything under it ("Nesting").
import Link from 'next/link';
import { listDocuments } from '@uccsite/db/documents';
import { projectOf } from '@uccsite/render';
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
  const { projects, docs, fileCounts } = await withDb(async (client) => ({
    projects: await listProjects(client),
    docs: (await listDocuments(client)).filter(d => d.status !== 'archived'),
    fileCounts: new Map((await client.query('SELECT project_slug, count(*)::int AS n FROM project_files GROUP BY project_slug')).rows.map(r => [r.project_slug || '', r.n])),
  }));
  const docCount = (p) => docs.filter(d => projectOf(d, projects) === p).length;

  return (
    <div>
      {projects.length > 0 && (
        <div className="notice">
          <strong>Inside each project.</strong> Documents and files are edited on their own pages; this is the way in by project.
          <ul>
            {projects.map(p => (
              <li key={p.slug}>
                <strong>{p.name}</strong>{' — '}
                <Link href={`/documents?project=${encodeURIComponent(p.slug)}`}>Documents ({docCount(p)})</Link>{' · '}
                <Link href={`/files?project=${encodeURIComponent(p.slug)}`}>Files ({fileCounts.get(p.slug) || 0})</Link>{' · '}
                <a href={`${config.publicOrigin}/projects#project-${p.slug}`} target="_blank" rel="noopener">On the site</a>
              </li>
            ))}
          </ul>
          A document joins a project through the <strong>Project</strong> field in its editor; the page a project's button opens counts automatically. The site shows the nested documents under each project block after the next publish.
        </div>
      )}
      <Collection />
    </div>
  );
}
