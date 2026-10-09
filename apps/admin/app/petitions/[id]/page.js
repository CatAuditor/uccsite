// One petition (docs/systems/petition.md "Admin"): its record (slug, project,
// status, homepage hero), its copy (the page, the form, the thank-you page,
// the payment window, sharing), the automatic thank-you email, its
// signatures with a CSV, and delete (only while nobody has signed).
// Editor+ like /subscribers (signatures are contact PII).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPetition, PETITION_STATUSES } from '@uccsite/db/petitions';
import { petitionTrigger } from '@uccsite/db/newsletters';
import { utahZipSql } from '@uccsite/db/audience';
import { petitionUrl } from '@uccsite/render/petitions';
import { listProjects } from '../../../lib/files';
import { requireRole } from '../../../lib/auth';
import { withDb, collectionStamp } from '../../../lib/data';
import { config } from '../../../lib/config';
import { PETITION_FIELDS, PETITION_FIELD_GROUPS } from '../../../lib/collections';
import ActionForm from '../../action-form';
import RequestPublish from '../../request-publish';
import AutomaticEmailPicker from '../../automatic-email-picker';
import { savePetition, deletePetition } from '../actions';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 500;

export default async function PetitionPage({ params, searchParams }) {
  const session = await requireRole('editor');
  const { id } = await params;
  const sp = await searchParams;
  const residency = ['utah', 'outside'].includes(sp?.residency) ? sp.residency : 'all';
  const data = await withDb(async (client) => {
    const petition = await getPetition(client, { id });
    if (!petition) return null;
    const where = [`petition = $1`];
    if (residency === 'utah') where.push(utahZipSql('zip'));
    if (residency === 'outside') where.push(`NOT ${utahZipSql('zip')}`);
    return {
      petition,
      projects: await listProjects(client),
      baseline: await collectionStamp(client, 'petitions'),
      count: (await client.query(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE ${utahZipSql('zip')})::int AS utah FROM petition_signatures WHERE petition = $1`, [petition.slug])).rows[0],
      rows: (await client.query(
        `SELECT id, project_slug, first_name, last_name, email, zip, address, phone, created_at::text AS created_at, (${utahZipSql('zip')}) AS utah
         FROM petition_signatures WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`, [petition.slug])).rows,
    };
  });
  if (!data) notFound();
  const { petition, projects, baseline, count, rows } = data;
  const url = petitionUrl(petition, projects.map(p => ({ slug: p.slug, parent_slug: p.parent_slug })));
  const project = projects.find(p => p.slug === petition.project_slug) || null;
  const status = petition.status || 'draft';
  const shown = residency === 'utah' ? count.utah : residency === 'outside' ? count.n - count.utah : count.n;
  const link = (res) => `/petitions/${id}${res === 'all' ? '' : `?residency=${res}`}`;
  const siteLink = (path) => `${config.publicOrigin}${path}`;

  return (
    <div>
      <p className="hint"><Link href="/petitions">← All petitions</Link></p>
      <h1>{petition.slug} <span className="hint">{count.n} signatures · {count.utah} Utah · {count.n - count.utah} outside</span></h1>
      <p className="notice">
        {status === 'open' && <>This petition is <strong>open</strong>: it takes signatures at <a href={siteLink(url)} target="_blank" rel="noopener"><code>{url}</code></a> and shows on the project page{petition.featured === '1' ? <> and <strong>as the homepage hero</strong></> : null}. </>}
        {status === 'closed' && <>This petition is <strong>closed</strong>: its page at <code>{url}</code> stays up with the final count; the form is gone and the API refuses new signatures. </>}
        {status === 'draft' && <>This petition is a <strong>draft</strong>: nothing is on the site yet. Set it to Open and publish to take signatures at <code>{url}</code>. </>}
        {project ? <>Filed under <Link href={`/projects/${project.slug}`}><strong>{project.name}</strong></Link>; every signature carries that project. </> : <>Its project is missing — pick one below. </>}
        Copy changes go live on the next approved publish. The public counter shows <strong>Utah signatures only</strong> (ZIP 84xxx).
      </p>

      <h2>Signatures</h2>
      <p>
        Residency:{' '}
        <a href={link('all')}>{residency === 'all' ? <strong>both</strong> : 'both'} ({count.n})</a> ·{' '}
        <a href={link('utah')}>{residency === 'utah' ? <strong>Utah</strong> : 'Utah'} ({count.utah})</a> ·{' '}
        <a href={link('outside')}>{residency === 'outside' ? <strong>outside Utah</strong> : 'outside Utah'} ({count.n - count.utah})</a>
      </p>
      <form action="/petitions/export" method="post" className="inline">
        <input type="hidden" name="petition" value={petition.slug} />
        <input type="hidden" name="residency" value={residency} />
        <button type="submit">Download CSV — {petition.slug}, {residency === 'all' ? 'Utah + outside' : residency === 'utah' ? 'Utah only' : 'outside Utah only'} ({shown} rows)</button>
      </form>
      <table>
        <thead><tr><th>Signed</th><th>Name</th><th>Email</th><th>ZIP</th><th>Utah</th><th>Address</th><th>Phone</th><th>Project</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
              <td>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
              <td>{r.email}</td>
              <td>{r.zip}</td>
              <td>{r.utah ? 'yes' : 'no'}</td>
              <td>{r.address || '—'}</td>
              <td>{r.phone || '—'}</td>
              <td>{r.project_slug || '—'}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="8">No signatures{residency === 'all' ? '' : ` (${residency})`} yet.</td></tr>}
        </tbody>
      </table>
      {shown > rows.length && <p className="hint">Showing the newest {rows.length} of {shown}; the CSV has all of them.</p>}

      <h2>Thank-you email</h2>
      <p className="hint">Sent once to each person on their first signature of <strong>this</strong> petition. Every petition has its own choice; nothing chosen = the built-in email with this petition&apos;s headline and project.</p>
      <AutomaticEmailPicker trigger={petitionTrigger(petition.slug)} readOnly={false} revalidate={[`/petitions/${id}`]} />

      <h2>The petition</h2>
      <ActionForm className="editor" action={savePetition} successMessage="Petition saved. Publish to make it live.">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="baseline" value={baseline} />
        <fieldset className="item">
          <legend>Record</legend>
          <div>
            <label htmlFor="slug">Slug</label>
            <input type="text" id="slug" name="slug" defaultValue={petition.slug || ''} readOnly={count.n > 0} />
            <div className="hint">{count.n > 0 ? 'Locked: signatures are filed under this slug. Close this petition and start a new one for a different ask.' : 'lowercase-with-dashes; unique across every project. Every signature is filed under it.'}</div>
          </div>
          <div>
            <label htmlFor="project_slug">Project</label>
            <select id="project_slug" name="project_slug" defaultValue={petition.project_slug || ''}>
              <option value="">— choose a project —</option>
              {projects.map(p => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </select>
            <div className="hint">The page lives at /projects/&lt;project&gt;/&lt;slug&gt;; the project page shows the petition; new signatures carry the project; the thank-you email links to it.</div>
          </div>
          <div>
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={status}>
              {PETITION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="hint">draft = not on the site · open = taking signatures · closed = page stays with the final count, no form</div>
          </div>
          <div>
            <label htmlFor="featured"><input type="checkbox" id="featured" name="featured" value="1" defaultChecked={petition.featured === '1'} /> Show in the homepage hero</label>
            <div className="hint">Only one petition can be the hero; ticking this un-ticks the others. It only works while the petition is open.</div>
          </div>
        </fieldset>
        {PETITION_FIELDS.map(([field, label, widget, hint], i) => {
          const heading = PETITION_FIELD_GROUPS[field];
          const value = petition[field] ?? '';
          return (
            <div key={field}>
              {heading && <h3 className={i ? '' : 'first'}>{heading}</h3>}
              <label htmlFor={field}>{label}</label>
              {widget === 'textarea'
                ? <textarea id={field} name={field} defaultValue={value} />
                : <input type="text" id={field} name={field} defaultValue={value} />}
              {hint && <div className="hint">{hint}</div>}
            </div>
          );
        })}
        <button type="submit">Save petition</button><RequestPublish />
      </ActionForm>

      {count.n === 0 && (
        <>
          <h2>Delete</h2>
          <ActionForm className="inline" action={deletePetition} successMessage="Deleted.">
            <input type="hidden" name="id" value={id} />
            <button type="submit">Delete this petition</button>
            <span className="hint"> Only possible while nobody has signed; afterwards, close it instead.</span>
          </ActionForm>
        </>
      )}
      <p className="notice">
        Signed in as {session.email}. Not editable here: the 501(c)(4) legal line — it lives in the templates.
      </p>
    </div>
  );
}
