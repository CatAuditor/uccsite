import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await requireSession();
  const rows = await withDb(async (client) => (await client.query(
    `SELECT actor, action, entity_type, entity_id, at::text AS at,
            CASE WHEN action = 'admin.error' THEN left(diff, 1500) END AS detail
     FROM audit_log ORDER BY at DESC LIMIT 100`)).rows);
  // admin.error rows (instrumentation.js onRequestError) carry the message a
  // production page could only show as "ref <digest>".
  const detail = (d) => { try { const o = JSON.parse(d); return `${o.name}: ${o.message} — ${o.path} (${o.type})${o.stack ? `
${o.stack}` : ''}`; } catch { return d; } };
  return (
    <div>
      <h1>Audit Log</h1>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.at?.slice(0, 19).replace('T', ' ')}</td>
              <td>{r.actor}</td>
              <td>{r.action}</td>
              <td>{r.entity_type ? `${r.entity_type}/${r.entity_id}` : ''}</td>
              <td>{r.detail ? <details><summary>error</summary><pre className="hint" style={{ whiteSpace: 'pre-wrap' }}>{detail(r.detail)}</pre></details> : ''}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="5">Empty — every admin mutation lands here.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
