// Dashboard: two-person publishing + run history (spec §7 Draft/Publishing…/
// Live/Failed). Nobody can publish alone: a writer REQUESTS a publish, a
// different editor/owner APPROVES it (that invokes the PublishFn Lambda) or
// DECLINES it with a note. All the rules live in lib/publish.js.
import { revalidatePath } from 'next/cache';
import { requireSession } from '../lib/auth';
import { withDb, latestPublishRuns, IN_FLIGHT_GRACE_MS } from '../lib/data';
import { publishState, requestPublish, approvePublish, declinePublish, withdrawPublish } from '../lib/publish';
import { runAction } from '../lib/actions';
import Refresher from './refresher';
import { when } from '../lib/when.mjs';
import ActionForm from './action-form';

export const dynamic = 'force-dynamic';

// Matches the drift reconciler's grace: a 'publishing' row older than this is
// an abandoned run (crashed Lambda) — shown as stalled, and no longer blocks.
function isFreshPublishing(run) {
  return run?.status === 'publishing'
    && Date.now() - new Date(run.started_at).getTime() < IN_FLIGHT_GRACE_MS;
}

const STATUS_LABEL = { pending: 'Waiting for review', declined: 'Declined', withdrawn: 'Withdrawn' };
const RUN_LABEL = { succeeded: 'Approved — live', noop: 'Approved — nothing to change', publishing: 'Approved — publishing…', starting: 'Approved — starting…', 'never started': 'Approved — publish never started (ask a developer)', failed: 'Approved — publish FAILED', refused: 'Approved — publish refused (another was running)' };
const RUN_CLASS = { noop: 'succeeded', starting: 'publishing', 'never started': 'failed' };
// An approved request is only as good as the run it started.
const requestLabel = (r) => (r.status === 'approved' ? RUN_LABEL[r.runStatus] || `Approved — publish ${r.runStatus}` : STATUS_LABEL[r.status] || r.status);
const requestClass = (r) => (r.status === 'approved' ? `status-${RUN_CLASS[r.runStatus] || r.runStatus}` : `status-${r.status}`);

function ChangeList({ changes }) {
  if (!changes.length) return <p className="hint">No saves recorded.</p>;
  return (
    <ul className="changes">
      {changes.map((c, i) => (
        <li key={i}><code>{c.action}</code>{c.entityId ? ` ${c.entityId}` : ''} — {c.actor}, {when(c.at)}</li>
      ))}
    </ul>
  );
}

export default async function Dashboard() {
  const session = await requireSession();
  const runs = await withDb((client) => latestPublishRuns(client));
  const { pending, liveAt, unpublished, sinceRequest, seenThrough, requests, busy } = await publishState();
  const canAct = session.role !== 'viewer';
  const isRequester = pending && (pending.requestedByUser === session.username || pending.requestedBy === session.email);
  // Owners may approve their own request (lib/publish.js); editors still need a second admin.
  const canReview = pending && canAct && (!isRequester || session.role === 'owner');

  async function request(prev, formData) {
    'use server';
    return runAction(async () => {
      const { needsReview, notified } = await requestPublish(String(formData.get('note') || '').trim().slice(0, 2000));
      revalidatePath('/');
      return {
        ok: true,
        message: needsReview
          ? `Publish requested — ${notified ? 'the other admins have been emailed to review it' : 'another admin or an owner has to approve it'} before anything goes live.`
          : 'Publish requested — approve it below.',
      };
    });
  }
  async function decide(prev, formData) {
    'use server';
    return runAction(async () => {
      const id = String(formData.get('id'));
      const note = String(formData.get('note') || '').trim().slice(0, 2000);
      const decision = String(formData.get('decision'));
      const seen = String(formData.get('seenThrough') || '');
      let message;
      if (decision === 'approve') { await approvePublish(id, note, seen); message = 'Approved — publish started.'; }
      else if (decision === 'decline') { await declinePublish(id, note); message = 'Declined; the writer will see your note here.'; }
      else if (decision === 'withdraw') { await withdrawPublish(id); message = 'Request withdrawn.'; }
      else throw new Error('Unknown decision');
      revalidatePath('/');
      return { ok: true, message };
    });
  }

  return (
    <div>
      <h1>Publish &amp; Status</h1>
      <Refresher active={Boolean(busy)} />
      <p className="notice">
        Saves are drafts. The site only changes when an admin <strong>requests</strong> a publish and a
        <strong> different</strong> admin approves it — or an <strong>owner</strong> approves their own.
        Last live: {liveAt ? when(liveAt) : 'never'}.
      </p>

      {pending ? (
        <section className="request pending">
          <h2>Publish request waiting for review</h2>
          <p><strong>{pending.requestedBy}</strong> asked to publish at {when(pending.createdAt)}.</p>
          {pending.requestNote && <blockquote>{pending.requestNote}</blockquote>}
          <h3>What it publishes ({pending.changes.length} saves since the site last went live)</h3>
          <ChangeList changes={pending.changes} />
          {sinceRequest.length > 0 && (
            <>
              <h3>Also saved after the request ({sinceRequest.length}) — a publish takes the whole database, so these go live too</h3>
              <ChangeList changes={sinceRequest} />
            </>
          )}
          {!canAct ? (
            <p className="notice">Viewer role — read-only.</p>
          ) : !canReview ? (
            <ActionForm action={decide}>
              <input type="hidden" name="id" value={pending.id} />
              <p>This is your request. Another editor or an owner has to approve it; you can take it back.</p>
              <button type="submit" name="decision" value="withdraw" className="secondary">Withdraw request</button>
            </ActionForm>
          ) : (
            <ActionForm action={decide}>
              <input type="hidden" name="id" value={pending.id} />
              <input type="hidden" name="seenThrough" value={seenThrough || ''} />
              {isRequester && <p className="notice">This is your own request. As an owner you can publish it yourself — check the list above first.</p>}
              <label htmlFor="review-note">Notes to the writer (required to decline)</label>
              <textarea id="review-note" name="note" placeholder="What's wrong, or what you checked." />
              <button type="submit" name="decision" value="approve" disabled={Boolean(busy)}>
                {busy ? 'Publishing…' : 'Approve & publish'}
              </button>{' '}
              {!isRequester && <button type="submit" name="decision" value="decline" className="secondary">Decline with notes</button>}
              {session.role === 'owner' && <>{' '}<button type="submit" name="decision" value="withdraw" className="secondary">Withdraw (owner)</button></>}
            </ActionForm>
          )}
        </section>
      ) : busy ? (
        <section className="request pending">
          <h2>Publishing now…</h2>
          <p>
            {busy.kind === 'starting' ? `Approved by ${busy.by} at ${when(busy.since)}; the publish is starting.` : `A publish started at ${when(busy.since)}.`}
            {' '}Saves made before it started go live with it. This page refreshes itself; anything still listed as unpublished afterwards needs a new request.
          </p>
          <h3>Not yet live ({unpublished.length})</h3>
          <ChangeList changes={unpublished} />
        </section>
      ) : (
        <section className="request">
          <h2>Unpublished saves ({unpublished.length})</h2>
          <ChangeList changes={unpublished} />
          {canAct ? (
            <ActionForm action={request}>
              <label htmlFor="request-note">Note for the reviewer (optional)</label>
              <textarea id="request-note" name="note" placeholder="What changed and where to look." />
              <button type="submit" disabled={!unpublished.length}>Request publish</button>
            </ActionForm>
          ) : (
            <p className="notice">Viewer role — read-only.</p>
          )}
        </section>
      )}

      <h2>Recent publish requests</h2>
      <table>
        <thead><tr><th>Requested</th><th>By</th><th>Status</th><th>Reviewed by</th><th>Notes</th></tr></thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td>{when(r.createdAt)}</td>
              <td>{r.requestedBy}</td>
              <td className={requestClass(r)}>{requestLabel(r)}</td>
              <td>{r.reviewedBy}{r.reviewedAt ? ` (${when(r.reviewedAt)})` : ''}</td>
              <td>{[r.requestNote && `Writer: ${r.requestNote}`, r.reviewNote && `Reviewer: ${r.reviewNote}`].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
          {!requests.length && <tr><td colSpan="5">No publish requests yet.</td></tr>}
        </tbody>
      </table>

      <h2>Recent publish runs</h2>
      <table>
        <thead>
          <tr><th>Started</th><th>Trigger</th><th>Status</th><th>Changed</th><th>Error</th></tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{when(run.started_at, { seconds: true })}</td>
              <td>{run.trigger_source}</td>
              <td className={`status-${run.status}`}>
                {run.status === 'succeeded' ? `Live (${when(run.finished_at)})`
                  : run.status === 'publishing' ? (isFreshPublishing(run) ? 'Publishing…' : 'Stalled (abandoned)')
                  : run.status === 'refused' ? 'Refused (another publish was running)'
                  : run.status}
              </td>
              <td>{run.changed}</td>
              <td>{run.error || ''}</td>
            </tr>
          ))}
          {!runs.length && <tr><td colSpan="5">No publishes yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
