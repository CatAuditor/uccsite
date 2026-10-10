// Mailing list — "who is this email going to" plus list management. ONE
// audience definition (packages/db/audience.js) shared with the newsletter
// sender and scripts/send-periodical.js: every confirmed, still-subscribed,
// non-bounced subscriber (join form + petition signers) plus opted-in Stripe
// members, each labelled residency (Utah / outside / unknown, from the best
// ZIP we hold — all 84xxx ZIPs are Utah), donor, and petitions signed.
//
// The table is the DIRECTORY (directoryQuery): everyone we hold a row for,
// each with a status — subscribed / unconfirmed / unsubscribed / suppressed —
// narrowed by status, search and the audience filters. The "This email is
// going to N people" line and the CSV use the audience filters alone, so they
// always describe the recipients. Editor+ only — contact PII like /donations.
// Actions (remove / restore / erase) live in ./actions.js — docs/systems/
// newsletters.md "Mailing list management".
import Link from 'next/link';
import { audienceQuery, directoryQuery, normalizeDirectoryFilters, describeFilters, STATUSES, FILTER_KEYS } from '@uccsite/db/audience';
import { listLists } from '@uccsite/db/lists';
import AudienceFilters from '../audience-filters';
import { addToListAction } from '../lists/actions';
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { latestEvents, suppressionFor } from '@uccsite/db/email-events';
import ActionForm from '../action-form';
import { removeFromList, restoreToList, eraseRecord } from './actions';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 500;
const STATUS_LABEL = { subscribed: 'Subscribed', unconfirmed: 'Not confirmed yet', unsubscribed: 'Unsubscribed', suppressed: 'Bounced / complained' };
const day = (ts) => (ts ? ts.slice(0, 10) : '');

export default async function SubscribersPage({ searchParams }) {
  await requireRole('editor');
  const sp = await searchParams;
  const pick = (k) => (typeof sp?.[k] === 'string' ? sp[k] : '');
  const raw = { status: pick('status') || 'subscribed', q: pick('q') };
  for (const k of FILTER_KEYS) raw[k] = pick(k);
  const filters = normalizeDirectoryFilters(raw);
  const filterParams = Object.fromEntries(FILTER_KEYS.map((k) => [k, filters[k] === true ? '1' : String(filters[k] || '')]));
  const { rows, matching, recipients, byStatus, byResidency, petitions, events, suppression, lists } = await withDb(async (client) => {
    const list = directoryQuery(filters, { limit: LIST_LIMIT, deliveries: true });
    const count = directoryQuery(filters, { columns: 'count(*)::int AS n', orderBy: null });
    const audience = audienceQuery(filters, { columns: 'count(*)::int AS n', orderBy: null });
    const statuses = directoryQuery({ status: 'all' }, { columns: 'a.status, count(*)::int AS n', orderBy: null });
    const all = audienceQuery({}, { columns: 'a.residency, count(*)::int AS n, count(*) FILTER (WHERE a.donor)::int AS donors', orderBy: null });
    const listRows = (await client.query(list.sql, list.params)).rows;
    return {
      rows: listRows,
      matching: (await client.query(count.sql, count.params)).rows[0].n,
      recipients: (await client.query(audience.sql, audience.params)).rows[0].n,
      byStatus: (await client.query(statuses.sql + ' GROUP BY a.status', statuses.params)).rows,
      byResidency: (await client.query(all.sql + ' GROUP BY a.residency', all.params)).rows,
      petitions: (await client.query('SELECT DISTINCT petition FROM petition_signatures ORDER BY petition')).rows.map(r => r.petition),
      events: await latestEvents(client, 50),
      suppression: await suppressionFor(client, listRows.filter(r => r.status === 'suppressed').map(r => r.email)),
      lists: await listLists(client),
    };
  });
  const totalAll = byResidency.reduce((s, r) => s + r.n, 0);
  const donorsAll = byResidency.reduce((s, r) => s + r.donors, 0);
  const n = (res) => byResidency.find(r => r.residency === res)?.n || 0;
  const st = (s) => byStatus.find(r => r.status === s)?.n || 0;
  const audienceOnly = filters.status === 'subscribed' && !filters.q;

  return (
    <div>
      <h1>Mailing list <span className="hint">{totalAll} people · {n('utah')} Utah · {n('outside')} outside · {n('unknown')} ZIP unknown · {donorsAll} donors</span></h1>
      <p className="notice">
        Everyone a newsletter can reach: join-form sign-ups, petition signers, and donors who ticked
        &ldquo;receive updates&rdquo; at checkout. <strong>Residency</strong> comes from the best ZIP we hold
        (every 84xxx ZIP is Utah). Use the controls to decide who an email goes to; the CSV and the
        sender use the same rules. <strong>Remove</strong> takes someone off the list the same way their
        unsubscribe link would (undo is available for removals made here); <strong>Erase a record</strong> at
        the bottom deletes their mailing-list record for good.
      </p>
      <p className="chips">
        {STATUSES.map(s => <span key={s} className={`chip status-${s}`}>{st(s)} {STATUS_LABEL[s].toLowerCase()}</span>)}
      </p>

      <form method="get" action="/subscribers" className="list-tools">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={filters.status}>
          <option value="all">everyone we hold</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input type="search" name="q" placeholder="Search email or name" defaultValue={filters.q} aria-label="Search email or name" />
        <button type="submit">Apply</button>
        <AudienceFilters f={filters} petitions={petitions} lists={lists} prefix="dir" />
      </form>

      <p>
        <strong>This email is going to {recipients} {recipients === 1 ? 'person' : 'people'}</strong> ({describeFilters(filters)}).
        {!audienceOnly && <> The table below shows <strong>{matching}</strong> {filters.status === 'all' ? 'of everyone we hold' : STATUS_LABEL[filters.status].toLowerCase()}{filters.q ? ` matching “${filters.q}”` : ''}; the count and the CSV are the recipients only.</>}
      </p>
      <form action="/subscribers/export" method="post" className="inline">
        {FILTER_KEYS.map((k) => <input key={k} type="hidden" name={k} value={filterParams[k]} />)}
        <button type="submit">Download CSV — {describeFilters(filters)} ({recipients} rows)</button>
      </form>
      <p className="hint">
        <Link href={`/lists?${new URLSearchParams(filterParams)}`}>Save these filters as a list</Link>
        {' '}— a named audience the composer can send to, frozen as of today or kept dynamic. &ldquo;Newsletter history&rdquo; is
        read from the admin&rsquo;s send ledger (sends since October 5, 2026).
      </p>

      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>ZIP</th><th>Donor</th><th>Petitions</th><th>Via</th><th>Joined</th><th>Newsletters</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const adminRemoved = r.status === 'unsubscribed' && r.unsubscribed_by && r.unsubscribed_by !== 'self';
            return (
              <tr key={r.email}>
                <td>{r.email}</td>
                <td>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
                <td>
                  <span className={`chip status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  {r.status === 'unsubscribed' && <div className="hint">{day(r.unsubscribed_at)} · {r.unsubscribed_by === 'self' ? 'their link' : `removed by ${r.unsubscribed_by || 'admin'}`}</div>}
                  {r.status === 'suppressed' && <div className="hint">{suppression.get(r.email) === 'complaint' ? 'marked us as spam' : 'hard bounce'}</div>}
                  {r.status === 'unconfirmed' && <div className="hint">welcome email sent {day(r.created_at)}</div>}
                  {r.status === 'subscribed' && r.confirmed_at && day(r.confirmed_at) !== day(r.created_at) && <div className="hint">confirmed {day(r.confirmed_at)}</div>}
                </td>
                <td>{r.zip || '—'}<div className="hint">{r.residency}</div></td>
                <td>{r.donor ? 'donor' : ''}</td>
                <td>{r.petitions || ''}</td>
                <td>{r.via === 'member' ? 'donation checkout' : r.via === 'petition' ? 'petition' : 'join form'}</td>
                <td>{day(r.created_at)}</td>
                <td>
                  {r.sent_count ? <>{r.sent_count} sent<div className="hint">last {day(r.last_sent_at)}</div></> : <span className="hint">none yet</span>}
                  {r.failed_count ? <div className="hint">{r.failed_count} failed</div> : null}
                </td>
                <td>
                  {r.status !== 'unsubscribed' && (
                    <ActionForm className="inline" action={removeFromList} successMessage="Removed.">
                      <input type="hidden" name="email" value={r.email} />
                      <button type="submit" className="danger">Remove</button>
                    </ActionForm>
                  )}
                  {adminRemoved && (
                    <ActionForm className="inline" action={restoreToList} successMessage="Restored.">
                      <input type="hidden" name="email" value={r.email} />
                      <button type="submit" className="secondary">Undo removal</button>
                    </ActionForm>
                  )}
                  {lists.length > 0 && r.status === 'subscribed' && (
                    <ActionForm className="inline" action={addToListAction}>
                      <input type="hidden" name="email" value={r.email} />
                      <select name="list" aria-label="Saved list" defaultValue={lists[0].id}>
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>{' '}
                      <button type="submit" className="secondary">Add to list</button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan="10">Nobody matches these filters.</td></tr>}
        </tbody>
      </table>
      {matching > rows.length && <p className="hint">Showing the newest {rows.length} of {matching}; narrow the filters or search to find the rest{audienceOnly ? '; the CSV has all of them' : ''}.</p>}

      <h2>Erase a record</h2>
      <p className="hint">
        For a &ldquo;forget me&rdquo; request. Deletes the person&rsquo;s mailing-list record for good (Remove is the reversible
        choice). Donation records, petition signatures and bounce history are separate records and stay.
      </p>
      <ActionForm className="editor" action={eraseRecord}>
        <label htmlFor="erase-email">Email address</label>
        <input type="email" id="erase-email" name="email" required autoComplete="off" />
        <label htmlFor="erase-confirm">Type it again to confirm</label>
        <input type="text" id="erase-confirm" name="confirm" required autoComplete="off" />
        <button type="submit" className="danger">Erase record</button>
      </ActionForm>

      {events.length > 0 && (
        <details>
          <summary>Recent bounces, complaints and rejects ({events.length})</summary>
          <table>
            <thead><tr><th>When</th><th>Email</th><th>Event</th><th>Detail</th><th>Skipped from now on</th></tr></thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}><td>{e.at?.slice(0, 16).replace('T', ' ')}</td><td>{e.email}</td><td>{e.type}{e.subtype ? ` (${e.subtype})` : ''}</td><td>{e.detail || ''}</td><td>{e.suppress ? 'yes' : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
