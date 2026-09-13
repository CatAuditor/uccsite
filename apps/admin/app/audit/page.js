import { withDb } from '../../lib/data';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const rows = await withDb(async (client) => (await client.query(
    `SELECT actor, action, entity_type, entity_id, at::text AS at
     FROM audit_log ORDER BY at DESC LIMIT 100`)).rows);
  return (
    <div>
      <h1>Audit Log</h1>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.at?.slice(0, 19).replace('T', ' ')}</td>
              <td>{r.actor}</td>
              <td>{r.action}</td>
              <td>{r.entity_type ? `${r.entity_type}/${r.entity_id}` : ''}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="4">Empty — every admin mutation lands here.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
