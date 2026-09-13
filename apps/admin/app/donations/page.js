// Donations dashboard (org decision, planning addendum 2): staff see every
// donation — amount, donor, contact info where given — while the public site
// shows only the opt-in ticker.
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';

export const dynamic = 'force-dynamic';

export default async function DonationsPage() {
  // Donor PII: editor or owner only (spec §11 gives "read form submissions"
  // to editor; viewer is read-only CONTENT). requireRole throws for viewer —
  // the layout still gates unauthenticated users to /login.
  await requireRole('editor');
  const rows = await withDb(async (client) => (await client.query(
    `SELECT d.amount_cents, d.public, d.created_at::text AS created_at,
            m.first_name, m.last_name, m.email, m.zip
     FROM donations d LEFT JOIN members m ON d.member_id = m.id
     ORDER BY d.created_at DESC LIMIT 200`)).rows);
  const total = rows.reduce((s, r) => s + (r.amount_cents || 0), 0);
  const fmt = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  return (
    <div>
      <h1>Donations</h1>
      <p>{rows.length} most recent donations — {fmt(total)} shown. (Internal only; the public site shows no totals.)</p>
      <table>
        <thead>
          <tr><th>Date</th><th>Amount</th><th>Donor</th><th>Email</th><th>ZIP</th><th>Public ticker</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.created_at?.slice(0, 10)}</td>
              <td>{fmt(r.amount_cents)}</td>
              <td>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td>
              <td>{r.email || '—'}</td>
              <td>{r.zip || '—'}</td>
              <td>{r.public ? 'yes' : 'no'}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="6">No donations recorded yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
