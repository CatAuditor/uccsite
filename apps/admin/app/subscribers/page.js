// Mailing list — "who is this email going to". ONE audience definition
// (packages/db/audience.js) shared with scripts/send-periodical.js: every
// subscriber (join form + petition signers) plus opted-in Stripe members,
// each labelled residency (Utah / outside / unknown, from the best ZIP we
// hold — all 84xxx ZIPs are Utah), donor, and petitions signed. The filter
// controls narrow the list AND the CSV; the sender takes the same flags.
// Editor+ only — contact PII like /donations. Read-only here; unsubscribe
// stays with the signed link in every email (portal-magic-link.md).
import { audienceQuery, normalizeFilters, describeFilters, RESIDENCIES } from '@uccsite/db/audience';
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 500;
const RESIDENCY_LABEL = { utah: 'Utah residents', outside: 'outside Utah', unknown: 'ZIP unknown' };

export default async function SubscribersPage({ searchParams }) {
  await requireRole('editor');
  const sp = await searchParams;
  const filters = normalizeFilters({
    residency: typeof sp?.residency === 'string' ? sp.residency : 'all',
    donors: sp?.donors,
    petition: typeof sp?.petition === 'string' ? sp.petition : '',
  });
  const { rows, matching, byResidency, petitions } = await withDb(async (client) => {
    const list = audienceQuery(filters, { limit: LIST_LIMIT });
    const count = audienceQuery(filters, { columns: 'count(*)::int AS n', orderBy: null });
    const all = audienceQuery({}, { columns: 'a.residency, count(*)::int AS n, count(*) FILTER (WHERE a.donor)::int AS donors', orderBy: null });
    return {
      rows: (await client.query(list.sql, list.params)).rows,
      matching: (await client.query(count.sql, count.params)).rows[0].n,
      byResidency: (await client.query(all.sql + ' GROUP BY a.residency', all.params)).rows,
      petitions: (await client.query('SELECT DISTINCT petition FROM petition_signatures ORDER BY petition')).rows.map(r => r.petition),
    };
  });
  const totalAll = byResidency.reduce((s, r) => s + r.n, 0);
  const donorsAll = byResidency.reduce((s, r) => s + r.donors, 0);
  const n = (res) => byResidency.find(r => r.residency === res)?.n || 0;

  return (
    <div>
      <h1>Mailing list <span className="hint">{totalAll} people · {n('utah')} Utah · {n('outside')} outside · {n('unknown')} ZIP unknown · {donorsAll} donors</span></h1>
      <p className="notice">
        Everyone a newsletter can reach: join-form sign-ups, petition signers, and donors who ticked
        &ldquo;receive updates&rdquo; at checkout. <strong>Residency</strong> comes from the best ZIP we hold
        (every 84xxx ZIP is Utah). Use the controls to decide who an email goes to; the CSV and the
        sender (<code>scripts/send-periodical.js --audience … --donors-only --petition …</code>) use
        the same rules. Removing someone: they use the unsubscribe link in any email.
      </p>

      <form method="get" action="/subscribers" className="list-tools">
        <label htmlFor="residency">Residency</label>
        <select id="residency" name="residency" defaultValue={filters.residency}>
          <option value="all">everyone</option>
          {RESIDENCIES.map(r => <option key={r} value={r}>{RESIDENCY_LABEL[r]}</option>)}
        </select>
        <label htmlFor="petition">Signed petition</label>
        <select id="petition" name="petition" defaultValue={filters.petition}>
          <option value="">any / none</option>
          {petitions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label htmlFor="donors"><input type="checkbox" id="donors" name="donors" value="1" defaultChecked={filters.donors} /> donors only</label>
        <button type="submit">Apply</button>
      </form>

      <p><strong>This email is going to {matching} {matching === 1 ? 'person' : 'people'}</strong> ({describeFilters(filters)}).</p>
      <form action="/subscribers/export" method="post" className="inline">
        <input type="hidden" name="residency" value={filters.residency} />
        <input type="hidden" name="donors" value={filters.donors ? '1' : ''} />
        <input type="hidden" name="petition" value={filters.petition} />
        <button type="submit">Download CSV — {describeFilters(filters)} ({matching} rows)</button>
      </form>

      <table>
        <thead><tr><th>Email</th><th>Name</th><th>ZIP</th><th>Residency</th><th>Donor</th><th>Petitions</th><th>Via</th><th>Joined</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email}>
              <td>{r.email}</td>
              <td>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
              <td>{r.zip || '—'}</td>
              <td>{r.residency}</td>
              <td>{r.donor ? 'donor' : ''}</td>
              <td>{r.petitions || ''}</td>
              <td>{r.via}</td>
              <td>{r.created_at?.slice(0, 10)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="8">Nobody matches these filters.</td></tr>}
        </tbody>
      </table>
      {matching > rows.length && <p className="hint">Showing the newest {rows.length} of {matching}; the CSV has all of them.</p>}
    </div>
  );
}
