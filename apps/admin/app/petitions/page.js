// Petitions (docs/systems/petition.md "Admin"): every petition, filed under
// its project — status, whether it is the homepage hero, its address on the
// site, and how many have signed (Utah / outside). Click one to edit its copy
// and see its signatures. "New petition" starts a draft under a project.
// Editor+ (signatures are contact PII, like /subscribers).
import Link from 'next/link';
import { listPetitions } from '@uccsite/db/petitions';
import { loadHomepage } from '@uccsite/db/content';
import { utahZipSql } from '@uccsite/db/audience';
import { petitionUrl } from '@uccsite/render/petitions';
import { listProjects } from '../../lib/files';
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { draftHero, liveHero, HeroStatus } from '../../lib/hero-status';
import ActionForm from '../action-form';
import { createPetition } from './actions';

export const dynamic = 'force-dynamic';

export default async function PetitionsPage({ searchParams }) {
  await requireRole('editor');
  const sp = await searchParams;
  const preselect = typeof sp?.project === 'string' ? sp.project : '';
  const [{ petitions, projects, counts, homepage }, live] = await Promise.all([
    withDb(async (client) => ({
      petitions: await listPetitions(client, { ids: true }),
      projects: await listProjects(client),
      homepage: await loadHomepage(client),
      counts: (await client.query(
        `SELECT petition, project_slug, count(*)::int AS n, count(*) FILTER (WHERE ${utahZipSql('zip')})::int AS utah, MAX(created_at)::text AS newest
         FROM petition_signatures GROUP BY petition, project_slug ORDER BY newest DESC`)).rows,
    })),
    liveHero(),
  ]);
  const treeRows = projects.map(p => ({ slug: p.slug, parent_slug: p.parent_slug }));
  const countFor = (slug) => counts.filter(c => c.petition === slug).reduce((a, c) => ({ n: a.n + c.n, utah: a.utah + c.utah }), { n: 0, utah: 0 });
  const total = counts.reduce((s, c) => s + c.n, 0);
  const totalUtah = counts.reduce((s, c) => s + c.utah, 0);
  const orphans = counts.filter(c => !petitions.some(p => p.slug === c.petition));
  const projectName = (slug) => projects.find(p => p.slug === slug)?.name || slug || '—';

  return (
    <div>
      <h1>Petitions <span className="hint">{petitions.length} petition{petitions.length === 1 ? '' : 's'} · {total} signatures · {totalUtah} Utah · {total - totalUtah} outside</span></h1>
      <p className="notice">
        Every petition belongs to a <strong>project</strong> and has its own page on the site at <code>/projects/&lt;project&gt;/&lt;slug&gt;</code>
        (the thank-you page sits under it). An <strong>open</strong> petition takes signatures, shows on its project page with a sign button and is listed on <code>/petitions</code>;
        a <strong>closed</strong> one keeps its page and its count but takes no more signatures; a <strong>draft</strong> is not on the site at all.
        Tick <strong>Show in the homepage hero</strong> on one open petition to make it the homepage hero. Copy changes go live on the next approved publish; signatures arrive here instantly.
      </p>

      <HeroStatus draft={draftHero(homepage, petitions)} live={live} />

      <h2>All petitions</h2>
      <table>
        <thead><tr><th>Petition</th><th>Project</th><th>Status</th><th>Homepage hero</th><th>Address</th><th>Signatures</th><th>Utah</th><th>Outside</th></tr></thead>
        <tbody>
          {petitions.map((p) => {
            const c = countFor(p.slug);
            const url = petitionUrl(p, treeRows);
            return (
              <tr key={p.id}>
                <td><Link href={`/petitions/${p.id}`}><strong>{p.slug}</strong></Link>{p.headline ? <div className="hint">{String(p.headline).replace(/<[^>]+>/g, '').slice(0, 90)}</div> : null}</td>
                <td><Link href={`/projects/${p.project_slug}`}>{projectName(p.project_slug)}</Link></td>
                <td>{p.status || 'draft'}</td>
                <td>{p.featured === '1' ? (p.status === 'open' ? 'yes' : 'yes (not open — no effect)') : '—'}</td>
                <td>{url ? <code>{url}</code> : <span className="hint">project missing</span>}</td>
                <td>{c.n}</td><td>{c.utah}</td><td>{c.n - c.utah}</td>
              </tr>
            );
          })}
          {!petitions.length && <tr><td colSpan="8">No petitions yet — start one below.</td></tr>}
        </tbody>
      </table>
      {orphans.length > 0 && (
        <p className="hint">
          Signatures with no petition record (older slugs): {orphans.map((c, i) => <span key={`${c.petition}|${c.project_slug}`}>{i ? ' · ' : ''}<strong>{c.petition}</strong> {c.n} ({c.utah} Utah){c.project_slug ? `, project ${c.project_slug}` : ''}</span>)}.
          They are still in the CSV below.
        </p>
      )}
      <form action="/petitions/export" method="post" className="inline">
        <input type="hidden" name="petition" value="all" />
        <input type="hidden" name="residency" value="all" />
        <button type="submit">Download CSV — every petition, Utah + outside ({total} rows)</button>
      </form>

      <h2>New petition</h2>
      <ActionForm className="editor" action={createPetition} successMessage="Petition created.">
        <fieldset className="item">
          <legend>Start a draft</legend>
          <div>
            <label htmlFor="new-project">Project</label>
            <select id="new-project" name="project_slug" defaultValue={preselect} required>
              <option value="">— choose a project —</option>
              {projects.map(p => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </select>
            <div className="hint">Every petition belongs to a project; its page lives under the project&apos;s address.</div>
          </div>
          <div>
            <label htmlFor="new-slug">Slug</label>
            <input type="text" id="new-slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{0,63}" placeholder="e.g. udot-alpr-permits" />
            <div className="hint">lowercase-with-dashes; unique across every project. Every signature is filed under it and the CSV is per slug. It cannot change once anyone has signed.</div>
          </div>
          <div>
            <label htmlFor="new-headline">Headline</label>
            <textarea id="new-headline" name="headline" placeholder="Tell UDOT: the public does not support these cameras." />
            <div className="hint">You can finish the rest of the copy on the next screen.</div>
          </div>
        </fieldset>
        <button type="submit">Create draft</button>
      </ActionForm>
    </div>
  );
}
