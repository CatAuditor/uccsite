// Petition (docs/systems/petition.md): the campaign copy — homepage hero
// takeover, /petition form, /petition-thanks — plus the signatures the
// public form collects, with a CSV export per campaign slug.
//
// Copy lives in the homepage singleton's `petition` JSON group (ownership
// declared in lib/collections.js, page: 'petition', so the Homepage editor
// leaves it alone). Save = one transaction with a lost-update check, like
// /appeals. Signatures are contact PII → editor+ like /subscribers.
import { revalidatePath } from 'next/cache';
import { loadHomepage, saveHomepage } from '@uccsite/db/content';
import { requireRole } from '../../lib/auth';
import { withDb, withWriteTx, recordChange, singletonStamp } from '../../lib/data';
import { HOMEPAGE_GROUPS } from '../../lib/collections';
import { CONFLICT_MESSAGE } from '../../lib/collection-save';
import { runAction } from '../../lib/actions';
import ActionForm from '../action-form';

export const dynamic = 'force-dynamic';

const GROUP = HOMEPAGE_GROUPS.find(g => g.page === 'petition');
// Same pattern aws/api/routes.js enforces on the public form.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LIST_LIMIT = 500;

export default async function PetitionPage({ searchParams }) {
  const session = await requireRole('editor');
  const sp = await searchParams;
  const { homepage, baseline } = await withDb(async (client) => ({
    homepage: await loadHomepage(client),
    baseline: await singletonStamp(client, 'homepage'),
  }));
  const copy = homepage.petition || {};
  const activeSlug = SLUG_RE.test(copy.slug || '') ? copy.slug : '';
  const requested = typeof sp?.petition === 'string' ? sp.petition.slice(0, 64) : '';
  const filter = requested === 'all' ? 'all' : (SLUG_RE.test(requested) ? requested : (activeSlug || 'all'));

  const { counts, rows } = await withDb(async (client) => ({
    counts: (await client.query(
      `SELECT petition, count(*)::int AS n, MAX(created_at)::text AS newest
       FROM petition_signatures GROUP BY petition ORDER BY newest DESC`)).rows,
    rows: (await client.query(
      `SELECT id, petition, first_name, last_name, email, zip, address, phone, created_at::text AS created_at
       FROM petition_signatures ${filter === 'all' ? '' : 'WHERE petition = $1'}
       ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`, filter === 'all' ? [] : [filter])).rows,
  }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const shown = filter === 'all' ? total : (counts.find(c => c.petition === filter)?.n || 0);

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
      <h1>Petition <span className="hint">{total} signatures</span></h1>
      <p className="notice">
        {copy.headline
          ? <>Petition is <strong>on</strong>: the homepage hero shows it and <code>/petition</code> takes signatures under the slug <strong>{activeSlug || '(invalid slug — fix below)'}</strong>.</>
          : <>Petition is <strong>off</strong> (no headline): the homepage shows the standing hero and <code>/petition</code> says no petition is open.</>}
        {' '}Copy changes go live on the next approved publish; signatures arrive here instantly.
      </p>

      <h2>Signatures</h2>
      <p>
        Show:{' '}
        {counts.map(c => (
          <span key={c.petition}>
            <a href={`/petition?petition=${encodeURIComponent(c.petition)}`}>{c.petition} ({c.n})</a> ·{' '}
          </span>
        ))}
        <a href="/petition?petition=all">all ({total})</a>
      </p>
      <form action="/petition/export" method="post" className="inline">
        <input type="hidden" name="petition" value={filter} />
        <button type="submit">Download CSV — {filter === 'all' ? 'every petition' : filter} ({shown} rows)</button>
      </form>
      <table>
        <thead><tr><th>Signed</th><th>Petition</th><th>Name</th><th>Email</th><th>ZIP</th><th>Address</th><th>Phone</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
              <td>{r.petition}</td>
              <td>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
              <td>{r.email}</td>
              <td>{r.zip}</td>
              <td>{r.address || '—'}</td>
              <td>{r.phone || '—'}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="7">No signatures{filter === 'all' ? '' : ` for ${filter}`} yet.</td></tr>}
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
                  : <input type="text" id={id} name={id} defaultValue={value} />}
                {hint && <div className="hint">{hint}</div>}
              </div>
            );
          })}
        </fieldset>
        <button type="submit">Save petition copy</button>
      </ActionForm>
      <p className="notice">
        Signed in as {session.email}. Not editable here: the payment modal's $10/$25/$50/$100 amounts and the
        501(c)(4) legal line — those live in the templates.
      </p>
    </div>
  );
}
