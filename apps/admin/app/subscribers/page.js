// Newsletter subscribers (the `subscribers` table the join form fills; the
// periodical script reads the same rows). Editor+ only — it is contact PII
// like /donations. Read-only here; unsubscribe stays with the signed link
// in every email (portal-magic-link.md).
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';

export const dynamic = 'force-dynamic';

export default async function SubscribersPage() {
  await requireRole('editor');
  const { rows, total } = await withDb(async (client) => ({
    total: Number((await client.query('SELECT count(*)::int AS n FROM subscribers')).rows[0].n),
    rows: (await client.query(
      `SELECT email, first_name, last_name, zip, created_at::text AS created_at
       FROM subscribers ORDER BY created_at DESC LIMIT 500`)).rows,
  }));
  return (
    <div>
      <h1>Subscribers <span className="hint">{total} total</span></h1>
      <p className="notice">Newsletter sign-ups from the site. Removing someone: they use the unsubscribe link in any email.</p>
      <form action="/subscribers/export" method="post"><button type="submit">Download CSV (all rows)</button></form>
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>ZIP</th><th>Joined</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email}><td>{r.email}</td><td>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td><td>{r.zip}</td><td>{r.created_at?.slice(0, 10)}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan="4">No subscribers yet.</td></tr>}
        </tbody>
      </table>
      {total > rows.length && <p className="hint">Showing the newest {rows.length}; the CSV has all {total}.</p>}
    </div>
  );
}
