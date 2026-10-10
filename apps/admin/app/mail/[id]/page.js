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
import { formatZoned, ZONE_LABEL, toLocalInput } from '@uccsite/newsletter/schedule';
import { FILTER_KEYS, UUID_RE } from '@uccsite/db/audience';
import { requireSession } from '../../../lib/auth';
import {
  newsletterPage, saveNewsletter, requestSend, approveSend, declineSend, withdrawSend, cancelSend, retrySend, sendTest, deleteNewsletter,
  duplicateNewsletter, saveDefaults, rescheduleSend,
} from '../../../lib/newsletters';
import { transactionalState, TRIGGERS } from '../../../lib/transactional';
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
  const { newsletter: n, names, count, audience, lists, petitions, deliveries, defaults, diff, opens } = page;
  // Automatic email (docs/systems/email.md "Attached emails"): no audience, no
  // send request — it is ATTACHED to a trigger and the API sends it.
  const isTx = n.kind === 'transactional';
  const tx = isTx ? await transactionalState(id) : null;
  const canAct = session.role !== 'viewer';
  const isDraft = n.status === 'draft';
  const isRequester = n.requestedByUser === session.username || n.requestedBy === session.email;
  const canReview = n.status === 'pending' && canAct && (!isRequester || session.role === 'owner');
  const path = `/mail/${n.id}`;

  // One form for a draft: Save, the test buttons and Request send all submit
  // the composer, so what is on screen is saved BEFORE it is tested or
  // requested (`then` = the clicked button). Tests and requests read the
  // saved row — a separate form would send the last save, not the screen.
  async function save(prev, formData) {
    'use server';
    const then = String(formData.get('then') || '');
    if (then === 'test' || then === 'test-all') {
      return runAction(async () => {
        await saveNewsletter(id, formData);
        revalidatePath(path);
        const to = await sendTest(id, { all: then === 'test-all' });
        return { ok: true, message: `Saved, and test sent to ${to.join(', ')} (subject starts with TEST:).` };
      });
    }
    if (then === 'request') return request(prev, formData);
    return runAction(async () => {
      await saveNewsletter(id, formData);
      revalidatePath(path); revalidatePath('/mail'); revalidatePath('/petition'); revalidatePath('/appeals');
      return { ok: true, message: 'Saved. The preview on the right is what goes out.' };
    });
  }
  async function request(prev, formData) {
    'use server';
    return runAction(async () => {
      // "Send to" in the request block overrides the Audience box: 'all' =
      // everyone on the mailing list (every filter cleared), a list id = that
      // saved list, 'keep' = whatever the Audience box says. Applied to the
      // form before the save, so the stored audience is what gets requested.
      const sendTo = String(formData.get('sendTo') || 'keep');
      if (sendTo === 'all') { for (const k of FILTER_KEYS) formData.set(k, ''); }
      else if (UUID_RE.test(sendTo)) formData.set('list', sendTo.toLowerCase());
      await saveNewsletter(id, formData);
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
  async function test(prev, formData) {
    'use server';
    return runAction(async () => {
      const to = await sendTest(id, { all: String(formData?.get('all') || '') === '1' });
      return { ok: true, message: `Test sent to ${to.join(', ')} (subject starts with TEST:).` };
    });
  }
  async function duplicate() {
    'use server';
    let newId;
    const res = await runAction(async () => { newId = await duplicateNewsletter(id); });
    if (res.error) return res;
    redirect(`/mail/${newId}`);
  }
  async function makeDefault() {
    'use server';
    return runAction(async () => { await saveDefaults(id); revalidatePath(path); return { ok: true, message: 'This look is now the default for new newsletters.' }; });
  }
  async function reschedule(prev, formData) {
    'use server';
    return runAction(async () => {
      const label = await rescheduleSend(id, String(formData.get('schedule') || ''));
      revalidatePath(path); revalidatePath('/mail'); revalidatePath('/');
      return { ok: true, message: label ? `Now scheduled for ${label}.` : 'Now sends as soon as it is approved.' };
    });
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
      <p className="hint"><Link href="/mail">← Outgoing emails</Link>{isTx ? ' · automatic email' : ' · newsletter'}</p>
      <h1>{n.subject || '(no subject)'}{' '}
        {isTx
          ? <span className={`chip ${tx.attached ? 'status-succeeded' : 'status-draft'}`}>{tx.attached ? `Attached — ${tx.attached.label}` : 'Not attached'}</span>
          : <span className={`chip ${statusClass(n.status)}`}>{STATUS_LABEL[n.status]}</span>}
      </h1>
      <Refresher active={n.status === 'sending'} />

      {!isTx && n.status !== 'draft' && (
        <section className={`request ${n.status === 'pending' ? 'pending' : ''}`}>
          {n.status === 'pending' && <h2>Send request waiting for review</h2>}
          {n.status === 'approved' && <h2>Approved — scheduled for {formatZoned(n.scheduledFor)}</h2>}
          {n.status === 'sending' && <h2>Sending…</h2>}
          {n.status === 'sent' && <h2>Sent {formatZoned(n.sentAt)}</h2>}
          {n.status === 'failed' && <h2>Send failed</h2>}
          <p>
            <strong>{n.requestedBy}</strong> asked at {when(n.requestedAt)} to send to <strong>{n.recipients}</strong> people
            ({audience.description}), {n.scheduledFor ? `at ${formatZoned(n.scheduledFor)}` : 'as soon as approved'}.
            {n.reviewedBy && n.status !== 'pending' ? ` Approved by ${n.reviewedBy} at ${when(n.reviewedAt)}.` : ''}
          </p>
          {n.requestNote && <blockquote>{n.requestNote}</blockquote>}
          {diff && !diff.same && (
            <div className="notice">
              <strong>Changed since the last request:</strong>
              <ul>
                {diff.added.map((l, i) => <li key={`a${i}`}>+ {l}</li>)}
                {diff.removed.map((l, i) => <li key={`r${i}`}>− {l}</li>)}
              </ul>
            </div>
          )}
          {diff && diff.same && <p className="hint">Same content as the previous request (only the note, time or audience changed).</p>}
          {deliveries && (
            <p><strong>{deliveries.sent}</strong> delivered to SES{deliveries.failed ? `, ${deliveries.failed} failed` : ''}{deliveries.suppressed ? `, ${deliveries.suppressed} suppressed (bounced or complained — skipped next time)` : ''}{deliveries.sending ? `, ${deliveries.sending} unknown (interrupted mid-send)` : ''}{n.status === 'sending' ? ' — this page refreshes itself.' : '.'}</p>
          )}
          {n.status === 'sent' && (
            <p>
              <strong>About {opens} open{opens === 1 ? '' : 's'}</strong>{n.sentCount ? ` (~${Math.min(999, Math.round((opens / n.sentCount) * 100))}% of ${n.sentCount} sent)` : ''}.
              <span className="hint"> Counted per issue, never per person. Apple Mail pre-loads images (counts as opened), other clients block them (never counted) — a rough signal, not a measurement.</span>
            </p>
          )}
          {n.status === 'sent' && n.publishToSite && n.slug && (
            <p className="hint">Web copy: <a href={`${config.publicOrigin}/newsletters/${n.slug}`} target="_blank" rel="noopener">/newsletters/{n.slug}</a>{n.archivedAt ? '' : ' (goes live with the next site publish)'}.</p>
          )}
          {n.status === 'pending' && canAct && (isRequester || session.role === 'owner') && (
            <ActionForm action={reschedule} className="inline">
              <label htmlFor="reschedule">Change the send time ({ZONE_LABEL}; empty = on approval)</label>
              <input type="datetime-local" id="reschedule" name="schedule" defaultValue={n.scheduledFor ? toLocalInput(n.scheduledFor) : ''} />
              <button type="submit" className="secondary">Update time</button>
            </ActionForm>
          )}
          {session.role === 'owner' && ['sent', 'failed'].includes(n.status) && (
            <details className="ledger">
              <summary>Per-recipient delivery (owner)</summary>
              <form action={`/mail/${n.id}/ledger`} method="post" className="inline"><button type="submit" className="secondary">Download CSV</button></form>
              <p className="hint">Audited like the mailing-list export.</p>
            </details>
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
        <Composer newsletter={n} names={names} count={count} audience={audience} lists={lists} petitions={petitions} readOnly={!canAct || !isDraft} publicOrigin={config.publicOrigin} />
        {canAct && isDraft && (
          <label className="mail-check"><input type="checkbox" name="automatic" value="1" defaultChecked={isTx} /> Automatic email — sent by the site to one person after they act (choose it on the <Link href="/petition">Petition</Link> or <Link href="/appeals">Appeals</Link> page), not to the mailing list. Takes effect on Save.</label>
        )}
        {canAct && isDraft && (
          <div className="item-tools">
            <button type="submit">Save</button>{' '}
            <button type="submit" name="then" value="test-all" className="secondary" title="Saves, then emails it to all four admins with TEST: in the subject">Save &amp; test send (all admins)</button>{' '}
            <button type="submit" name="then" value="test" className="secondary" title="Saves, then emails it to you only">Save &amp; send me a test ({session.email})</button>
          </div>
        )}
        {canAct && isDraft && !isTx && (
          <div className="request-send">
            <h2>Request the send</h2>
            <p className="hint">
              Saves first. Audience now: <strong>{count ?? 0}</strong> people ({audience.description}).
              Leave the time empty to send as soon as someone approves; set one to schedule it ({ZONE_LABEL}, at least 5 minutes from now).
            </p>
            <label htmlFor="sendTo">Send to</label>
            <select id="sendTo" name="sendTo" defaultValue="keep">
              <option value="keep">What the Audience box above says ({audience.description})</option>
              <option value="all">All — everyone on the mailing list</option>
              {lists.map((l) => <option key={l.id} value={l.id}>Saved list: {l.name}{l.mode === 'frozen' ? ` (frozen ${String(l.frozenAt || '').slice(0, 10)}, ${l.frozenCount ?? 0})` : ' (dynamic)'}</option>)}
            </select>
            <div className="hint">Choosing All or a list here replaces the Audience box&rsquo;s choice when you request; the recipient count the reviewer sees is for that choice.</div>
            <label htmlFor="schedule">Send at ({ZONE_LABEL}) — optional</label>
            <input type="datetime-local" id="schedule" name="schedule" defaultValue={n.scheduledFor ? toLocalInput(n.scheduledFor) : ''} />
            <label htmlFor="request-note">Note for the reviewer (optional)</label>
            <textarea id="request-note" name="note" placeholder="What this email is and anything to double-check." />
            <button type="submit" name="then" value="request">Save &amp; request send</button>
          </div>
        )}
      </ActionForm>

      {isTx && (
        <section className="request-send">
          <h2>Where it is used</h2>
          {tx.attached ? (
            <p>
              This is the live email for <strong>{tx.attached.label}</strong> (chosen {when(tx.attached.attachedAt)} by {tx.attached.attachedBy || 'an admin'}; it goes out {tx.attached.when}).
              The copy that goes out was frozen when it was chosen — after editing, save here, then pick it again on the {tx.attached.trigger.startsWith('petition-thanks:') ? <Link href="/petitions">petition&apos;s page under Petitions</Link> : <Link href="/appeals">Appeals</Link>} page to send the new version.
            </p>
          ) : (
            <p>Not in use yet. Choose it on a petition&apos;s page under <Link href="/petitions">Petitions</Link> (thank-you after signing that petition) or the <Link href="/appeals">Appeals</Link> page (thank-you after a donation). The <em>Audience</em> fieldset above is ignored for automatic emails — each one goes to the person who just acted.</p>
          )}
          <p className="hint">
            Placeholders, filled in for each recipient:{' '}
            {TRIGGERS.map((t) => <span key={t.key}><strong>{t.label}</strong>: {t.placeholders.map((p) => `{${p}}`).join(' ')}{t.required.length ? ` (${t.required.map((p) => `{${p}}`).join(' ')} is required — it carries the amount, date and the not-tax-deductible line)` : ''}. </span>)}
            The Unsubscribe link in the footer is filled in automatically.
          </p>
        </section>
      )}

      {canAct && (
        <div className="mail-tools">
          {!isDraft && (
            <ActionForm action={test} className="inline">
              <button type="submit" name="all" value="1" title="Emails the frozen version to all four admins with TEST: in the subject">Test send (all admins)</button>{' '}
              <button type="submit" className="secondary" title="Emails the frozen version to you only">Send me a test ({session.email})</button>
            </ActionForm>
          )}
          <div className="mail-row">
            <ActionForm action={duplicate} className="inline">
              <button type="submit" className="secondary">Copy as a new draft</button>
            </ActionForm>
            <ActionForm action={makeDefault} className="inline">
              <button type="submit" className="secondary" title={defaults.updatedBy ? `Current default set by ${defaults.updatedBy}` : 'No default saved yet — new drafts use the built-in look'}>Use this look as the default</button>
            </ActionForm>
          </div>
          {session.role === 'owner' && !['pending', 'approved', 'sending'].includes(n.status) && (
            <ActionForm action={remove} className="inline">
              <button type="submit" className="danger">Delete this email</button>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
