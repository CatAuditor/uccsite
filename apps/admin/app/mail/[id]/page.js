// Newsletter editor + review (docs/systems/newsletters.md). Left: the
// composer (subject, from, audience, blocks, theme); right: a phone-sized
// preview with light/dark toggles — both in the Composer client component.
// Below: the two-person send flow, mirroring Publish & Status: request
// (with an optional Mountain-time schedule) → a different admin approves or
// declines with a note → the Lambda sends. All rules live in
// lib/newsletters.js; this file only renders state and wires actions.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { describeFilters, normalizeFilters } from '@uccsite/db/audience';
import { formatZoned, ZONE_LABEL, toLocalInput } from '@uccsite/newsletter/schedule';
import { requireSession } from '../../../lib/auth';
import {
  newsletterPage, saveNewsletter, requestSend, approveSend, declineSend, withdrawSend, cancelSend, retrySend, sendTest, deleteNewsletter,
} from '../../../lib/newsletters';
import { runAction } from '../../../lib/actions';
import { config } from '../../../lib/config';
import ActionForm from '../../action-form';
import Refresher from '../../refresher';
import Composer from './composer';
import { STATUS_LABEL, statusClass } from '../status';

export const dynamic = 'force-dynamic';

const when = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

export default async function NewsletterPage({ params }) {
  const session = await requireSession();
  const { id } = await params;
  const page = await newsletterPage(id);
  if (!page) notFound();
  const { newsletter: n, names, count, petitions, deliveries } = page;
  const canAct = session.role !== 'viewer';
  const isDraft = n.status === 'draft';
  const isRequester = n.requestedByUser === session.username || n.requestedBy === session.email;
  const canReview = n.status === 'pending' && canAct && (!isRequester || session.role === 'owner');
  const path = `/mail/${n.id}`;

  async function save(prev, formData) {
    'use server';
    return runAction(async () => {
      await saveNewsletter(id, formData);
      revalidatePath(path);
      return { ok: true, message: 'Saved. The preview on the right is what goes out.' };
    });
  }
  async function request(prev, formData) {
    'use server';
    return runAction(async () => {
      const { needsReview, notified, scheduledFor } = await requestSend(id, String(formData.get('note') || ''), String(formData.get('schedule') || ''));
      revalidatePath(path); revalidatePath('/mail'); revalidatePath('/');
      const timing = scheduledFor ? `scheduled for ${scheduledFor}` : 'to go out on approval';
      return {
        ok: true,
        message: needsReview
          ? `Send requested (${timing}) — ${notified ? 'the other admins have been emailed to review it' : 'another admin or an owner has to approve it'}.`
          : `Send requested (${timing}) — approve it below.`,
      };
    });
  }
  async function decide(prev, formData) {
    'use server';
    return runAction(async () => {
      const note = String(formData.get('note') || '');
      const decision = String(formData.get('decision'));
      let message;
      if (decision === 'approve') { const { scheduled } = await approveSend(id, note); message = scheduled ? `Approved — it goes out ${scheduled}.` : 'Approved — sending now.'; }
      else if (decision === 'decline') { await declineSend(id, note); message = 'Declined; the writer sees your note here and can edit again.'; }
      else if (decision === 'withdraw') { await withdrawSend(id); message = 'Request withdrawn — back to draft.'; }
      else if (decision === 'cancel') { await cancelSend(id); message = 'Cancelled — back to draft.'; }
      else if (decision === 'retry') { await retrySend(id); message = 'Retrying — recipients already sent to are skipped.'; }
      else throw new Error('Unknown decision');
      revalidatePath(path); revalidatePath('/mail'); revalidatePath('/');
      return { ok: true, message };
    });
  }
  async function test() {
    'use server';
    return runAction(async () => ({ ok: true, message: `Test sent to ${await sendTest(id)} (subject starts with [TEST]).` }));
  }
  async function remove() {
    'use server';
    const res = await runAction(() => deleteNewsletter(id));
    if (res.error) return res;
    revalidatePath('/mail');
    redirect('/mail');
  }

  return (
    <div className="mail-page">
      <p className="hint"><Link href="/mail">← Newsletters</Link></p>
      <h1>{n.subject || '(no subject)'} <span className={`chip ${statusClass(n.status)}`}>{STATUS_LABEL[n.status]}</span></h1>
      <Refresher active={n.status === 'sending'} />

      {n.status !== 'draft' && (
        <section className={`request ${n.status === 'pending' ? 'pending' : ''}`}>
          {n.status === 'pending' && <h2>Send request waiting for review</h2>}
          {n.status === 'approved' && <h2>Approved — scheduled for {formatZoned(n.scheduledFor)}</h2>}
          {n.status === 'sending' && <h2>Sending…</h2>}
          {n.status === 'sent' && <h2>Sent {formatZoned(n.sentAt)}</h2>}
          {n.status === 'failed' && <h2>Send failed</h2>}
          <p>
            <strong>{n.requestedBy}</strong> asked at {when(n.requestedAt)} to send to <strong>{n.recipients}</strong> people
            ({describeFilters(normalizeFilters(n.audience))}), {n.scheduledFor ? `at ${formatZoned(n.scheduledFor)}` : 'as soon as approved'}.
            {n.reviewedBy && n.status !== 'pending' ? ` Approved by ${n.reviewedBy} at ${when(n.reviewedAt)}.` : ''}
          </p>
          {n.requestNote && <blockquote>{n.requestNote}</blockquote>}
          {deliveries && (
            <p><strong>{deliveries.sent}</strong> delivered to SES{deliveries.failed ? `, ${deliveries.failed} failed` : ''}{deliveries.sending ? `, ${deliveries.sending} unknown (interrupted mid-send)` : ''}{n.status === 'sending' ? ' — this page refreshes itself.' : '.'}</p>
          )}
          {n.error && <div className="error">{n.error}</div>}
          <p className="hint">The email body and audience were frozen when the send was requested; what the preview shows is exactly what goes out.</p>

          {!canAct ? <p className="notice">Viewer role — read-only.</p>
            : n.status === 'pending' && !canReview ? (
              <ActionForm action={decide}>
                <p>This is your request. Another editor or an owner has to approve it; you can take it back and keep editing.</p>
                <button type="submit" name="decision" value="withdraw" className="secondary">Withdraw request</button>
              </ActionForm>
            ) : n.status === 'pending' ? (
              <ActionForm action={decide}>
                {isRequester && <p className="notice">This is your own request. As an owner you can approve it yourself — read the preview first.</p>}
                <label htmlFor="review-note">Notes to the writer (required to decline)</label>
                <textarea id="review-note" name="note" placeholder="What's wrong, or what you checked." />
                <button type="submit" name="decision" value="approve">{n.scheduledFor ? 'Approve (sends on schedule)' : 'Approve & send now'}</button>{' '}
                <button type="submit" name="decision" value="decline" className="secondary">Decline with notes</button>
                {session.role === 'owner' && !isRequester && <>{' '}<button type="submit" name="decision" value="withdraw" className="secondary">Withdraw (owner)</button></>}
              </ActionForm>
            ) : n.status === 'approved' ? (
              <ActionForm action={decide}>
                <button type="submit" name="decision" value="cancel" className="secondary">Cancel the scheduled send</button>
              </ActionForm>
            ) : n.status === 'failed' ? (
              <ActionForm action={decide}>
                <button type="submit" name="decision" value="retry">Retry (skips anyone already sent to)</button>
              </ActionForm>
            ) : null}
        </section>
      )}

      {n.status === 'draft' && n.reviewNote && (
        <div className="notice"><strong>Last review by {n.reviewedBy}</strong> ({when(n.reviewedAt)}): {n.reviewNote}</div>
      )}

      <ActionForm action={save} className="editor">
        <input type="hidden" name="updatedAt" value={n.updatedAt} />
        <Composer newsletter={n} names={names} count={count} petitions={petitions} readOnly={!canAct || !isDraft} publicOrigin={config.publicOrigin} />
        {canAct && isDraft && (
          <div className="item-tools">
            <button type="submit">Save</button>
          </div>
        )}
      </ActionForm>

      {canAct && (
        <div className="mail-tools">
          <ActionForm action={test} className="inline">
            <button type="submit" className="secondary" title="Emails the saved version to you only">Send me a test ({session.email})</button>
          </ActionForm>
          {isDraft && (
            <ActionForm action={request} className="request-send">
              <h2>Request the send</h2>
              <p className="hint">
                Saves first. Audience: <strong>{count}</strong> people ({describeFilters(normalizeFilters(n.audience))}).
                Leave the time empty to send as soon as someone approves; set one to schedule it ({ZONE_LABEL}, at least 5 minutes from now).
              </p>
              <label htmlFor="schedule">Send at ({ZONE_LABEL}) — optional</label>
              <input type="datetime-local" id="schedule" name="schedule" defaultValue={n.scheduledFor ? toLocalInput(n.scheduledFor) : ''} />
              <label htmlFor="request-note">Note for the reviewer (optional)</label>
              <textarea id="request-note" name="note" placeholder="What this email is and anything to double-check." />
              <button type="submit">Request send</button>
            </ActionForm>
          )}
          {session.role === 'owner' && !['pending', 'approved', 'sending'].includes(n.status) && (
            <ActionForm action={remove} className="inline">
              <button type="submit" className="danger">Delete this newsletter</button>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
