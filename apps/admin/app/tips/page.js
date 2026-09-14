// Tipline inbox (docs/systems/tipline.md). Editor+ only: tips are contact
// PII plus confidential content, the same rule as /donations. Read-only
// here; status changes and deletion happen on the detail page.
import Link from 'next/link';
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { STATUSES } from './statuses';

export const dynamic = 'force-dynamic';

export default async function TipsPage({ searchParams }) {
  await requireRole('editor');
  const sp = await searchParams;
  const filter = typeof sp?.status === 'string' ? sp.status.slice(0, 40) : 'open';
  const where = filter === 'all' ? '' : filter === 'open' ? `WHERE status <> 'Closed'` : 'WHERE status = $1';
  const params = where.includes('$1') ? [filter] : [];
  const { rows, counts } = await withDb(async (client) => ({
    rows: (await client.query(
      `SELECT id, name, anonymous, email, subject_of_tip, status,
              left(tip_summary, 80) AS excerpt, length(tip_summary) AS len,
              created_at::text AS created_at
       FROM tips ${where} ORDER BY created_at DESC LIMIT 500`, params)).rows,
    counts: (await client.query('SELECT status, count(*)::int AS n FROM tips GROUP BY status')).rows,
  }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const seen = new Set(STATUSES);
  const statuses = [...STATUSES, ...counts.map(c => c.status).filter(s => !seen.has(s))];
  const n = (s) => counts.find(c => c.status === s)?.n || 0;

  return (
    <div>
      <h1>Tips <span className="hint">{total} total</span></h1>
      <p className="notice">
        Confidential tipline submissions. Do not copy tip contents anywhere outside this admin. Open a tip to change
        its status; owners can delete one.
      </p>
      <p>
        Show: <Link href="/tips">open</Link> · <Link href="/tips?status=all">all</Link>
        {statuses.map(s => <span key={s}> · <Link href={`/tips?status=${encodeURIComponent(s)}`}>{s} ({n(s)})</Link></span>)}
      </p>
      <table>
        <thead><tr><th>Received</th><th>Status</th><th>Subject</th><th>From</th><th>Tip</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.created_at?.slice(0, 10)}</td>
              <td>{r.status}</td>
              <td><Link href={`/tips/${r.id}`}>{r.subject_of_tip || '(no subject)'}</Link></td>
              <td>{r.anonymous ? 'Anonymous' : (r.name || '—')}<div className="hint">{r.email || '(no email)'}</div></td>
              <td>{r.excerpt}{r.len > 80 ? '…' : ''}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="5">No tips{filter === 'open' ? ' open' : ''}.</td></tr>}
        </tbody>
      </table>
      {rows.length === 500 && <p className="hint">Showing the newest 500. Narrow by status to see older ones.</p>}
    </div>
  );
}
