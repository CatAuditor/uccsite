// CSV of every subscriber (editor+). Audited: a bulk PII download is an
// event worth a row in audit_log.
import { requireRole } from '../../../lib/auth';
import { withDb, withWriteTx, recordChange } from '../../../lib/data';

export const dynamic = 'force-dynamic';

const cell = (v) => {
  const s = String(v ?? '');
  // Formula-injection guard for spreadsheets + CSV quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET() {
  let session;
  try { session = await requireRole('editor'); } catch { return new Response('Forbidden', { status: 403 }); }
  const rows = await withDb(async (client) => (await client.query(
    `SELECT email, first_name, last_name, address, zip, created_at::text AS created_at FROM subscribers ORDER BY created_at`)).rows);
  await withWriteTx((client) => recordChange(client, { actor: session.email, action: 'subscribers.export', diff: { rows: rows.length } }));
  const header = 'email,first_name,last_name,address,zip,created_at';
  const body = rows.map(r => [r.email, r.first_name, r.last_name, r.address, r.zip, r.created_at].map(cell).join(',')).join('\r\n');
  return new Response(`${header}\r\n${body}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
