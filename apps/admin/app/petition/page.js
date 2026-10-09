// Petition (docs/systems/petition.md): the campaign copy — homepage hero
// takeover, /petition form, /petition-thanks — plus the signatures the
// public form collects, with a CSV export per campaign slug.
//
// Copy lives in the homepage singleton's `petition` JSON group (ownership
// declared in lib/collections.js, page: 'petition', so the Homepage editor
// leaves it alone). Save = one transaction with a lost-update check, like
// /appeals. Signatures are contact PII → editor+ like /subscribers.
// Utah vs outside: derived from the ZIP (every 84xxx ZIP is Utah —
// packages/db/audience.js). The public counter counts Utah only; the admin
// shows both and exports either.
import { revalidatePath } from 'next/cache';
import { loadHomepage, saveHomepage } from '@uccsite/db/content';
import { utahZipSql } from '@uccsite/db/audience';
import { listProjects } from '../../lib/files';
import { requireRole } from '../../lib/auth';
import { withDb, withWriteTx, recordChange, singletonStamp } from '../../lib/data';
import { HOMEPAGE_GROUPS } from '../../lib/collections';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import { runAction } from '../../lib/actions';
import ActionForm from '../action-form';
import RequestPublish from '../request-publish';
import { draftHero, liveHero, HeroStatus } from '../../lib/hero-status';

export const dynamic = 'force-dynamic';

const GROUP = HOMEPAGE_GROUPS.find(g => g.page === 'petition');
// Same pattern aws/api/routes.js enforces on the public form.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LIST_LIMIT = 500;

export default async function PetitionPage({ searchParams }) {
  const session = await requireRole('editor');
  const sp = await searchParams;
  const [{ homepage, baseline, projects }, live] = await Promise.all([
    withDb(async (client) => ({
      homepage: await loadHomepage(client),
      baseline: await singletonStamp(client, 'homepage'),
      projects: await listProjects(client),
    })),
    liveHero(),
  ]);
  const copy = homepage.petition || {};
  const activeSlug = SLUG_RE.test(copy.slug || '') ? copy.slug : '';
  // Filed under (docs/systems/petition.md "Project"): the project the live campaign belongs to.
  const project = projects.find(p => p.slug === String(copy.project_slug || '').trim()) || null;
  const requested = typeof sp?.petition === 'string' ? sp.petition.slice(0, 64) : '';
  const filter = requested === 'all' ? 'all' : (SLUG_RE.test(requested) ? requested : (activeSlug || 'all'));
  const residency = ['utah', 'outside'].includes(sp?.residency) ? sp.residency : 'all';

  const where = [];
  const params = [];
  if (filter !== 'all') { params.push(filter); where.push(`petition = $${params.length}`); }
  if (residency === 'utah') where.push(utahZipSql('zip'));
  if (residency === 'outside') where.push(`NOT ${utahZipSql('zip')}`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { counts, rows } = await withDb(async (client) => ({
    counts: (await client.query(
      `SELECT petition, count(*)::int AS n, count(*) FILTER (WHERE ${utahZipSql('zip')})::int AS utah,
              MAX(created_at)::text AS newest
       FROM petition_signatures GROUP BY petition ORDER BY newest DESC`)).rows,
    rows: (await client.query(
      `SELECT id, petition, project_slug, first_name, last_name, email, zip, address, phone, created_at::text AS created_at,
              (${utahZipSql('zip')}) AS utah
       FROM petition_signatures ${whereSql}
       ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`, params)).rows,
  }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const totalUtah = counts.reduce((s, c) => s + c.utah, 0);
  const inSlug = filter === 'all' ? { n: total, utah: totalUtah } : (counts.find(c => c.petition === filter) || { n: 0, utah: 0 });
  const shown = residency === 'utah' ? inSlug.utah : residency === 'outside' ? inSlug.n - inSlug.utah : inSlug.n;
  const link = (slug, res) => `/petition?petition=${encodeURIComponent(slug)}${res === 'all' ? '' : `&residency=${res}`}`;

  async function save(prevState, formData) {
    'use server';
    return runAction(async () => {
      const s = await requireRole('editor');
      const next = {};
      for (const [field] of GROUP.fields) {
        const v = String(formData.get(`${GROUP.key}.${field}`) ?? '').trim();
        if (v) next[field] = v;
      }
      if (next.headline && !SLUG_RE.test(next.slug || '')) {
        throw new Error('Campaign slug must be lowercase letters, digits and dashes (e.g. udot-alpr-permits) while the petition is on.');
      }
      const expected = String(formData.get('baseline') ?? '');
      await withWriteTx(async (client) => {
        if (expected && (await singletonStamp(client, 'homepage')) !== expected) throw new Error(CONFLICT_MESSAGE);
        if (next.project_slug && !(await listProjects(client)).some(p => p.slug === next.project_slug)) {
          throw new Error(`"${next.project_slug}" is not a project. Pick one from the list or leave Project blank.`);
        }
        const before = await loadHomepage(client);
        await saveHomepage(client, { ...before, petition: next }, { tx: false });
        await recordChange(client, {
          actor: s.email, action: 'petition.save', entityType: 'homepage', entityId: 'singleton',
          snapshot: before,
        });
      });
      revalidatePath('/petition');
      revalidatePath('/homepage');
    });
  }

  return (
    <div>
      <h1>Petition <span className="hint">{total} signatures · {totalUtah} Utah · {total - totalUtah} outside</span></h1>
      <p className="notice">
        {copy.headline
          ? <>Petition is <strong>on</strong>: the homepage hero shows it and <code>/petition</code> takes signatures under the slug <strong>{activeSlug || '(invalid slug — fix below)'}</strong>.</>
          : <>Petition is <strong>off</strong> (no headline): the homepage shows the standing hero and <code>/petition</code> says no petition is open.</>}
        {' '}{project
          ? <>Filed under the project <strong><a href={`/projects/${project.slug}`}>{project.name}</a></strong>: its page on the site shows the petition, and every new signature carries that project.</>
          : <>Not filed under a project — set <strong>Project</strong> below so the project page shows the petition and signatures are filed under it.</>}
        {' '}Copy changes go live on the next approved publish; signatures arrive here instantly.
        Each signer gets one thank-you email (first signature only) — the subject and message are the two “Thank-you email” fields below.
        The public counter on the site shows <strong>Utah signatures only</strong> (ZIP 84xxx), refreshed about once a minute;
        out-of-state signatures are kept, listed and exportable here but never counted publicly.
      </p>

      <HeroStatus draft={draftHero(homepage)} live={live} />

      <h2>Signatures</h2>
      <p>
        Petition:{' '}
        {counts.map(c => (
          <span key={c.petition}>
            <a href={link(c.petition, residency)}>{c.petition} ({c.utah} Utah / {c.n - c.utah} outside)</a> ·{' '}
          </span>
        ))}
        <a href={link('all', residency)}>all ({total})</a>
        <br />
        Residency:{' '}
        <a href={link(filter, 'all')}>{residency === 'all' ? <strong>both</strong> : 'both'} ({inSlug.n})</a> ·{' '}
        <a href={link(filter, 'utah')}>{residency === 'utah' ? <strong>Utah</strong> : 'Utah'} ({inSlug.utah})</a> ·{' '}
        <a href={link(filter, 'outside')}>{residency === 'outside' ? <strong>outside Utah</strong> : 'outside Utah'} ({inSlug.n - inSlug.utah})</a>
      </p>
      <form action="/petition/export" method="post" className="inline">
        <input type="hidden" name="petition" value={filter} />
        <input type="hidden" name="residency" value={residency} />
        <button type="submit">Download CSV — {filter === 'all' ? 'every petition' : filter}, {residency === 'all' ? 'Utah + outside' : residency === 'utah' ? 'Utah only' : 'outside Utah only'} ({shown} rows)</button>
      </form>
      <table>
        <thead><tr><th>Signed</th><th>Petition</th><th>Project</th><th>Name</th><th>Email</th><th>ZIP</th><th>Utah</th><th>Address</th><th>Phone</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
              <td>{r.petition}</td>
              <td>{r.project_slug || '—'}</td>
              <td>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
              <td>{r.email}</td>
              <td>{r.zip}</td>
              <td>{r.utah ? 'yes' : 'no'}</td>
              <td>{r.address || '—'}</td>
              <td>{r.phone || '—'}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="9">No signatures{filter === 'all' ? '' : ` for ${filter}`}{residency === 'all' ? '' : ` (${residency})`} yet.</td></tr>}
        </tbody>
      </table>
      {shown > rows.length && <p className="hint">Showing the newest {rows.length} of {shown}; the CSV has all of them.</p>}

      <h2>Campaign copy</h2>
      <ActionForm className="editor" action={save} successMessage="Petition copy saved. Publish to make it live.">
        <input type="hidden" name="baseline" value={baseline} />
        <fieldset className="item">
          <legend>{GROUP.title}</legend>
          {GROUP.fields.map(([field, label, widget, hint]) => {
            const id = `${GROUP.key}.${field}`;
            const value = copy[field] ?? '';
            return (
              <div key={field}>
                <label htmlFor={id}>{label}</label>
                {widget === 'textarea'
                  ? <textarea id={id} name={id} defaultValue={value} />
                  : widget === 'project'
                    ? <select id={id} name={id} defaultValue={value}>
                        <option value="">— no project —</option>
                        {projects.map(p => <option key={p.slug} value={p.slug}>{p.label}</option>)}
                      </select>
                    : <input type="text" id={id} name={id} defaultValue={value} />}
                {hint && <div className="hint">{hint}</div>}
              </div>
            );
          })}
        </fieldset>
        <button type="submit">Save petition copy</button><RequestPublish />
      </ActionForm>
      <p className="notice">
        Signed in as {session.email}. Not editable here: the 501(c)(4) legal line — it lives in the templates.
      </p>
    </div>
  );
}
