// CSV of one newsletter's per-recipient delivery ledger (owner). Audited
// (`newsletter.ledger`) like the mailing-list export — it is a bulk PII
// download. POST only, same reasoning as /subscribers/export.
import { requireRole } from '../../../../lib/auth';
import { withDb, withWriteTx, recordChange } from '../../../../lib/data';
import { deliveriesFor } from '@uccsite/db/newsletters';

export const dynamic = 'force-dynamic';

const cell = (v) => { const s = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

export async function POST(request, { params }) {
  let session;
  try { session = await requireRole('owner'); } catch { return new Response('Forbidden', { status: 403 }); }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return new Response('Bad id', { status: 400 });
  const rows = await withDb((client) => deliveriesFor(client, id));
  await withWriteTx((client) => recordChange(client, { actor: session.email, action: 'newsletter.ledger', entityType: 'newsletter', entityId: id, diff: { rows: rows.length } }));
  const body = ['email,status,message_id,error,at', ...rows.map((r) => [r.email, r.status, r.message_id, r.error, r.at].map(cell).join(','))].join('\r\n');
  return new Response(`${body}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="newsletter-${id}-deliveries.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
