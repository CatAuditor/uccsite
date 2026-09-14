// One tip: full text, status change (editor+), delete (owner). The tipster's
// text is rendered verbatim as text — never as HTML.
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '../../../lib/auth';
import { withDb } from '../../../lib/data';
import ActionForm from '../../action-form';
import { setTipStatus, deleteTip } from '../actions';
import { STATUSES } from '../statuses';

export const dynamic = 'force-dynamic';

export default async function TipPage({ params }) {
  const session = await requireRole('editor');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tip = await withDb(async (client) => (await client.query(
    `SELECT id, name, anonymous, email, subject_of_tip, tip_summary, status,
            legacy_airtable_id, created_at::text AS created_at, updated_at::text AS updated_at
     FROM tips WHERE id = $1`, [id])).rows[0]);
  if (!tip) notFound();
  const statuses = STATUSES.includes(tip.status) ? STATUSES : [...STATUSES, tip.status];

  return (
    <div>
      <p><Link href="/tips">← All tips</Link></p>
      <h1>{tip.subject_of_tip || '(no subject)'}</h1>
      <table>
        <tbody>
          <tr><th>Received</th><td>{tip.created_at}{tip.legacy_airtable_id ? ' (imported from Airtable)' : ''}</td></tr>
          <tr><th>From</th><td>{tip.anonymous ? 'Anonymous (name withheld by the tipster)' : (tip.name || '—')}</td></tr>
          <tr><th>Email</th><td>{tip.email || '(none)'}</td></tr>
          <tr><th>Status</th><td>{tip.status}{tip.updated_at !== tip.created_at ? <span className="hint"> · updated {tip.updated_at}</span> : null}</td></tr>
        </tbody>
      </table>
      <h2>Tip</h2>
      <blockquote style={{ whiteSpace: 'pre-wrap', margin: '8px 0', padding: '8px 12px', borderLeft: '3px solid #c8a84b', background: '#fdf6e3' }}>
        {tip.tip_summary}
      </blockquote>

      <h2>Status</h2>
      <ActionForm action={setTipStatus} className="inline">
        <input type="hidden" name="id" value={tip.id} />
        <select name="status" defaultValue={tip.status}>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select>{' '}
        <button type="submit">Update status</button>
      </ActionForm>

      {session.role === 'owner' && (
        <>
          <h2>Delete</h2>
          <p className="hint">Removes the tip permanently. The audit log keeps only the fact of deletion, not the contents.</p>
          <ActionForm action={deleteTip} className="inline">
            <input type="hidden" name="id" value={tip.id} />
            <button type="submit" className="danger">Delete this tip</button>
          </ActionForm>
        </>
      )}
    </div>
  );
}
