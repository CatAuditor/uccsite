// Newsletters — every email composed in the admin, newest first, and the
// "new newsletter" form (docs/systems/newsletters.md). Viewer+ can read;
// editors compose. Status is the two-person send rule's state.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { describeFilters, normalizeFilters } from '@uccsite/db/audience';
import { listNewsletters } from '@uccsite/db/newsletters';
import { formatZoned } from '@uccsite/newsletter/schedule';
import { requireSession } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { createNewsletter, duplicateNewsletter } from '../../lib/newsletters';
import { runAction } from '../../lib/actions';
import ActionForm from '../action-form';
import { STATUS_LABEL } from './status';

export const dynamic = 'force-dynamic';

const when = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

export default async function MailPage() {
  const session = await requireSession();
  const rows = await withDb((client) => listNewsletters(client));
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

  return (
    <div>
      <h1>Newsletters</h1>
      <p className="notice">
        Write an email here, see it as a phone would show it (light and dark), send yourself a test, then
        <strong> request the send</strong>. Like a site publish, a <strong>different</strong> admin has to approve it
        (owners can approve their own) before anything goes to the <Link href="/subscribers">mailing list</Link>.
        Every email goes out as &ldquo;<em>Your name</em> from Utah Civic Compact&rdquo; &lt;hello@utahciviccompact.org&gt;.
      </p>

      {canAct && (
        <ActionForm action={create} className="inline">
          <label htmlFor="subject">New newsletter — subject line</label>
          <input id="subject" name="subject" placeholder="Latest from the Compact" maxLength={200} required />
          <button type="submit">Start writing</button>
        </ActionForm>
      )}

      <table>
        <thead><tr><th>Subject</th><th>Status</th><th>From</th><th>Audience</th><th>Created</th><th>Sent / scheduled</th><th></th></tr></thead>
        <tbody>
          {rows.map((n) => (
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
              <td>{canAct && (
                <ActionForm action={duplicate} className="inline">
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" className="linkish" title="Start a new draft from this one">Copy</button>
                </ActionForm>
              )}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="7">No newsletters yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
