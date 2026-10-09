// Outgoing emails — everything the site sends, in two kinds
// (docs/systems/newsletters.md, docs/systems/email.md "Attached emails"):
//   Newsletters       composed here, two-person send to the mailing list
//   Automatic emails  composed here too, ATTACHED to a trigger (petition
//                     signed, donation received) and sent by the API to the
//                     person who acted; one per trigger, else the built-in
// Viewer+ can read; editors compose.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { describeFilters, normalizeFilters } from '@uccsite/db/audience';
import { listNewsletters, openCounts } from '@uccsite/db/newsletters';
import { formatZoned } from '@uccsite/newsletter/schedule';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { createNewsletter, duplicateNewsletter } from '../../lib/newsletters';
import { createTransactional, listSlots } from '../../lib/transactional';
import { runAction } from '../../lib/actions';
import ActionForm from '../action-form';
import { STATUS_LABEL } from './status';

export const dynamic = 'force-dynamic';

const when = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

export default async function MailPage() {
  const session = await requireSession();
  const { rows, opens } = await withDb(async (client) => { const rows = await listNewsletters(client); return { rows, opens: await openCounts(client, rows.filter((r) => r.status === 'sent').map((r) => r.id)) }; });
  const slots = await listSlots();
  const newsletters = rows.filter((n) => n.kind !== 'transactional');
  const automatic = rows.filter((n) => n.kind === 'transactional');
  const attachedTo = new Map(slots.filter((s) => s.attachment).map((s) => [s.attachment.newsletterId, s]));
  const canAct = session.role !== 'viewer';

  async function duplicate(prev, formData) {
    'use server';
    let newId;
    const res = await runAction(async () => { newId = await duplicateNewsletter(String(formData.get('id'))); });
    if (res.error) return res;
    redirect(`/mail/${newId}`);
  }
  async function create(prev, formData) {
    'use server';
    let id;
    const res = await runAction(async () => { id = await createNewsletter(String(formData.get('subject') || '')); });
    if (res.error) return res;
    redirect(`/mail/${id}`);
  }
  async function createAutomatic(prev, formData) {
    'use server';
    let id;
    const res = await runAction(async () => { id = await createTransactional(String(formData.get('subject') || '')); });
    if (res.error) return res;
    redirect(`/mail/${id}`);
  }

  const copyButton = (n) => canAct && (
    <ActionForm action={duplicate} className="inline">
      <input type="hidden" name="id" value={n.id} />
      <button type="submit" className="linkish" title="Start a new draft from this one">Copy</button>
    </ActionForm>
  );

  return (
    <div>
      <h1>Outgoing emails</h1>
      <p className="notice">
        Two kinds of email leave the site. <strong>Newsletters</strong> go to the <Link href="/subscribers">mailing list</Link> after a
        <strong> different</strong> admin approves the send (owners can approve their own). <strong>Automatic emails</strong> go to one
        person right after they do something — sign the petition, donate. Write them here; choose which one goes out on the
        Petition page (after signing) or the Appeals page (after a donation); without a choice, a built-in email goes out. Every email is sent as &ldquo;<em>Your name</em> from Utah Civic Compact&rdquo; &lt;hello@utahciviccompact.org&gt;.
      </p>

      <h2>Automatic emails</h2>
      <table>
        <thead><tr><th>Sent when</th><th>Email that goes out</th><th>Attached</th></tr></thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.key}>
              <td><strong>{s.label}</strong><br /><span className="hint">{s.when}</span></td>
              <td>{s.attachment
                ? <Link href={`/mail/${s.attachment.newsletterId}`}>{s.attachment.currentSubject || s.attachment.subject || '(no subject)'}</Link>
                : <span className="hint">Built-in email</span>}
                {' '}<span className="hint">· choose on {s.key === 'petition-thanks' ? <Link href="/petition">Petition</Link> : <Link href="/appeals">Appeals</Link>}</span></td>
              <td>{s.attachment ? `${when(s.attachment.attachedAt)} · ${s.attachment.attachedBy}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canAct && (
        <ActionForm action={createAutomatic} className="inline">
          <label htmlFor="auto-subject">New automatic email — subject line</label>
          <input id="auto-subject" name="subject" placeholder="Thank you for signing" maxLength={200} required />
          <button type="submit">Start writing</button>
        </ActionForm>
      )}
      {automatic.length > 0 && (
        <table>
          <thead><tr><th>Subject</th><th>Attached to</th><th>From</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {automatic.map((n) => (
              <tr key={n.id}>
                <td><Link href={`/mail/${n.id}`}>{n.subject || '(no subject)'}</Link></td>
                <td className={attachedTo.has(n.id) ? 'status-succeeded' : ''}>{attachedTo.has(n.id) ? attachedTo.get(n.id).label : 'not attached'}</td>
                <td>{n.fromName}</td>
                <td>{when(n.createdAt)} · {n.createdBy}</td>
                <td>{copyButton(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Newsletters</h2>
      {canAct && (
        <ActionForm action={create} className="inline">
          <label htmlFor="subject">New newsletter — subject line</label>
          <input id="subject" name="subject" placeholder="Latest from the Compact" maxLength={200} required />
          <button type="submit">Start writing</button>
        </ActionForm>
      )}

      <table>
        <thead><tr><th>Subject</th><th>Status</th><th>From</th><th>Audience</th><th>Created</th><th>Sent / scheduled</th><th>Opens</th><th></th></tr></thead>
        <tbody>
          {newsletters.map((n) => (
            <tr key={n.id}>
              <td><Link href={`/mail/${n.id}`}>{n.subject || '(no subject)'}</Link></td>
              <td className={`status-${n.status === 'sent' ? 'succeeded' : n.status === 'approved' ? 'approved' : n.status}`}>
                {STATUS_LABEL[n.status] || n.status}
                {n.status === 'sent' && n.failedCount ? ` (${n.failedCount} failed)` : ''}
              </td>
              <td>{n.fromName}</td>
              <td>{describeFilters(normalizeFilters(n.audience))}{n.recipients != null ? ` · ${n.recipients}` : ''}</td>
              <td>{when(n.createdAt)} · {n.createdBy}</td>
              <td>{n.sentAt ? `${formatZoned(n.sentAt)} · ${n.sentCount ?? 0} sent` : n.scheduledFor && ['pending', 'approved'].includes(n.status) ? formatZoned(n.scheduledFor) : ''}</td>
              <td title="Per issue, never per person; inflated by Apple Mail image pre-loading">{n.status === 'sent' ? `~${opens.get(n.id) || 0}` : ''}</td>
              <td>{copyButton(n)}</td>
            </tr>
          ))}
          {!newsletters.length && <tr><td colSpan="8">No newsletters yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
