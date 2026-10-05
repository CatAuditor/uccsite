// Newsletter subscribers (the `subscribers` table the join form AND the
// petition form fill; the periodical script reads the same rows). Editor+
// only — it is contact PII like /donations. Read-only here; unsubscribe
// stays with the signed link in every email (portal-magic-link.md).
// Labels: `donor` = the email has at least one recorded donation or a
// non-canceled subscription (members ⨝ donations/subscriptions);
// `petitions` = campaign slugs they signed (docs/systems/petition.md).
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { SUBSCRIBER_ROWS_SQL } from './query';

export const dynamic = 'force-dynamic';

export default async function SubscribersPage() {
  await requireRole('editor');
  const { rows, total } = await withDb(async (client) => ({
    total: Number((await client.query('SELECT count(*)::int AS n FROM subscribers')).rows[0].n),
    rows: (await client.query(SUBSCRIBER_ROWS_SQL + ' LIMIT 500')).rows,
  }));
  return (
    <div>
      <h1>Subscribers <span className="hint">{total} total</span></h1>
      <p className="notice">Newsletter sign-ups from the join form and petition signers. <strong>Donor</strong> = has given through the site; <strong>Petitions</strong> = campaigns they signed. Removing someone: they use the unsubscribe link in any email.</p>
      <form action="/subscribers/export" method="post"><button type="submit">Download CSV (all rows)</button></form>
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>ZIP</th><th>Donor</th><th>Petitions</th><th>Joined</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email}><td>{r.email}</td><td>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td><td>{r.zip}</td><td>{r.donor ? 'donor' : ''}</td><td>{r.petitions || ''}</td><td>{r.created_at?.slice(0, 10)}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan="6">No subscribers yet.</td></tr>}
        </tbody>
      </table>
      {total > rows.length && <p className="hint">Showing the newest {rows.length}; the CSV has all {total}.</p>}
    </div>
  );
}
