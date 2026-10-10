// CSV of the mailing list, narrowed by the same audience filters the page
// shows (editor+). Audited: a bulk PII download is an event worth a row in
// audit_log (`subscribers.export` with the filters + row count).
import { audienceFor } from '@uccsite/db/lists';
import { requireRole } from '../../../lib/auth';
import { withDb, withWriteTx, recordChange } from '../../../lib/data';

export const dynamic = 'force-dynamic';

const cell = (v) => {
  const s = String(v ?? '');
  // Formula-injection guard for spreadsheets + CSV quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

// POST only: a cross-site GET link could trigger a full PII download (and
// an audit row) in an editor's browser.
export async function POST(request) {
  let session;
  try { session = await requireRole('editor'); } catch { return new Response('Forbidden', { status: 403 }); }
  const form = await request.formData().catch(() => null);
  // Ad-hoc filters from the Mailing list page, or a saved list (`list`) from
  // the Saved lists page — the same resolver the sender uses.
  const audience = Object.fromEntries([...(form?.entries() || [])].filter(([, v]) => typeof v === 'string'));
  const resolved = await withDb(async (client) => {
    const r = await audienceFor(client, audience, { orderBy: 'a.created_at' });
    return r ? { rows: (await client.query(r.sql, r.params)).rows, description: r.description } : null;
  });
  if (!resolved) return new Response('That saved list no longer exists', { status: 404 });
  const { rows, description } = resolved;
  await withWriteTx((client) => recordChange(client, {
    actor: session.email, action: 'subscribers.export', diff: { audience: description, rows: rows.length },
  }));
  const header = 'email,first_name,last_name,address,zip,residency,donor,petitions,via,created_at';
  const body = rows.map(r => [r.email, r.first_name, r.last_name, r.address, r.zip, r.residency, r.donor ? 'donor' : '', r.petitions, r.via, r.created_at].map(cell).join(',')).join('\r\n');
  const tag = description.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80);
  return new Response(`${header}\r\n${body}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mailing-list-${tag}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
