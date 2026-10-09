// CSV of petition signatures (editor+), one campaign slug or every one.
// Audited (`petition.export`): a bulk PII download is an event worth a row.
// POST only — a cross-site GET link could trigger a download in an
// editor's browser. Timestamps are ISO 8601 UTC (the signing time).
import { utahZipSql } from '@uccsite/db/audience';
import { requireRole } from '../../../lib/auth';
import { withDb, withWriteTx, recordChange } from '../../../lib/data';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const cell = (v) => {
  const s = String(v ?? '');
  // Formula-injection guard for spreadsheets + CSV quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function POST(request) {
  let session;
  try { session = await requireRole('editor'); } catch { return new Response('Forbidden', { status: 403 }); }
  const form = await request.formData().catch(() => null);
  const requested = String(form?.get('petition') ?? 'all').slice(0, 64);
  const petition = requested === 'all' ? null : (SLUG_RE.test(requested) ? requested : null);
  if (requested !== 'all' && !petition) return new Response('Bad petition slug', { status: 400 });
  const residencyRaw = String(form?.get('residency') ?? 'all');
  const residency = ['utah', 'outside'].includes(residencyRaw) ? residencyRaw : 'all';

  const where = [];
  const params = [];
  if (petition) { params.push(petition); where.push(`petition = $${params.length}`); }
  if (residency === 'utah') where.push(utahZipSql('zip'));
  if (residency === 'outside') where.push(`NOT ${utahZipSql('zip')}`);
  const rows = await withDb(async (client) => (await client.query(
    `SELECT petition, project_slug, first_name, last_name, email, zip, (${utahZipSql('zip')}) AS utah, address, phone,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS signed_at
     FROM petition_signatures ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`,
    params)).rows);
  await withWriteTx((client) => recordChange(client, {
    actor: session.email, action: 'petition.export', diff: { petition: petition || 'all', residency, rows: rows.length },
  }));

  const header = 'petition,project,first_name,last_name,email,zip,utah_resident,address,phone,signed_at_utc';
  const body = rows.map(r => [r.petition, r.project_slug, r.first_name, r.last_name, r.email, r.zip, r.utah ? 'yes' : 'no', r.address, r.phone, r.signed_at].map(cell).join(',')).join('\r\n');
  const name = `petition-${petition || 'all'}-${residency}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(`${header}\r\n${body}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
