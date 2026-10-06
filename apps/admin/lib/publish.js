// Two-person publishing (docs/systems/admin.md "Publishing"). The ONLY
// place the admin invokes the PublishFn Lambda is approvePublish below, and
// it refuses when the approver is the requester — unless the approver is an
// OWNER (org decision 2026-10-05: owners may approve their own request; the
// audit row says so). Saves stay drafts in the database until a request is
// approved.
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  pendingRequest, listRequests, createRequest, review, changesSince, lastLiveAt, bumpGate, runsFor, reopen,
} from '@uccsite/db/publish-requests';
import { requireRole } from './auth';
import { withDb, withWriteTx, recordChange, inFlightPublish } from './data';
import { promoteRequestedFiles } from './files';
import { notifyPublishRequested } from './notify';
import { config } from './config';
import { parseDbTime } from './when.mjs';
import { describeChanges } from './change-detail';

// The Lambda writes its 'publishing' row only AFTER rendering and diffing
// the whole site against S3 (30-60 s; a noop run writes a row only at the
// end), so for that long inFlightPublish() sees nothing and the dashboard
// would show the approved saves as "unpublished" with a live Request button
// — people re-requested what was already going live (2026-10-05). An
// approved request with no run row yet, approved inside this window, counts
// as a publish that is STARTING; past it, the run never started.
const STARTING_WINDOW_MS = 10 * 60 * 1000;

// runStatusFor(request, runs) → the run's status, or 'starting' /
// 'never started' for an approval with no run row yet.
function runStatusFor(r, runs) {
  if (r.status !== 'approved') return '';
  if (!r.publishTrigger) return 'never started';
  if (runs[r.publishTrigger]) return runs[r.publishTrigger];
  const t = parseDbTime(r.reviewedAt);
  return t && Date.now() - t.getTime() < STARTING_WINDOW_MS ? 'starting' : 'never started';
}

// recentRequests(client) → the last 10 requests, each with runStatus.
async function recentRequests(client) {
  const requests = await listRequests(client, 10);
  const runs = await runsFor(client, requests.map(r => r.publishTrigger));
  return requests.map(r => ({ ...r, runStatus: runStatusFor(r, runs) }));
}

// busyPublish(client) → the in-flight run, or the request whose publish is
// starting, or null. Both the dashboard and requestPublish gate on it.
async function busyPublish(client) {
  const run = await inFlightPublish(client);
  if (run) return { kind: 'publishing', since: run.started_at };
  const starting = (await recentRequests(client)).find(r => r.runStatus === 'starting');
  return starting ? { kind: 'starting', since: starting.reviewedAt, by: starting.reviewedBy } : null;
}

// publishState() → what the dashboard renders.
export async function publishState() {
  return withDb(async (client) => {
    const pending = await pendingRequest(client);
    const liveAt = await lastLiveAt(client);
    const sinceRequest = pending ? await changesSince(client, pending.createdAt) : [];
    const requests = await recentRequests(client);
    const unpublished = await changesSince(client, liveAt);
    return {
      pending,
      liveAt,
      // Drafts not yet on the live site (content audit rows since the last
      // successful publish); when a request is pending, the ones made after
      // it were not part of what the requester asked to publish.
      unpublished,
      // Plain-English, field-level net effect of publishing everything above
      // (lib/change-detail.js) — the expanding "What will change" list.
      detail: await describeChanges(client, unpublished, liveAt),
      sinceRequest,
      // The newest save the reviewer can see on this render. Approve sends it
      // back; approvePublish refuses if anything was saved after it.
      seenThrough: pending ? (sinceRequest.at(-1)?.at || pending.createdAt) : null,
      // Each approved request labelled by the run its approval started.
      requests,
      // A publish in flight (run row) or starting (approved, no row yet):
      // Approve/Request are refused and the page polls until it settles.
      busy: await busyPublish(client),
    };
  });
}

// requestPublish(note) → { id, needsReview, notified }. needsReview = the requester
// is not an owner (owners approve their own, so nobody is told); notified =
// how many reviewers were emailed (lib/notify.js, after the commit — never
// inside the transaction, and a mail failure never fails the request).
export async function requestPublish(note) {
  const s = await requireRole('editor');
  const { id, changes } = await withWriteTx(async (client) => {
    await bumpGate(client); // two racing requests now conflict; the loser replays and sees the winner
    const open = await pendingRequest(client);
    if (open) {
      const mine = open.requestedByUser === s.username || open.requestedBy === s.email;
      throw new Error(mine
        ? 'Your publish request is already waiting for review — see Publish & Status.'
        : `A publish request from ${open.requestedBy} is already waiting for review.`);
    }
    if (await busyPublish(client)) {
      throw new Error('A publish is running right now. Saves made before it started go live with it; wait for it to finish, then request again if anything is still listed as unpublished.');
    }
    const changes = await changesSince(client, await lastLiveAt(client));
    if (!changes.length) throw new Error('Nothing to publish — no saves since the site last went live.');
    const id = await createRequest(client, {
      requestedBy: s.email, requestedByUser: s.username, requestNote: note, changes,
    });
    await recordChange(client, { actor: s.email, action: 'publish.request', entityType: 'publish_request', entityId: id, diff: { changes: changes.length } });
    return { id, changes };
  });
  const needsReview = s.role !== 'owner';
  const notified = await notifyPublishRequested({ requestedBy: s.email, role: s.role, note, changes });
  return { id, needsReview, notified };
}

// approvePublish(id, note, seenThrough): a DIFFERENT editor/owner than the
// requester, or an OWNER approving their own (self-approval is audited as
// such). seenThrough = the newest save the reviewer's page listed; any
// save after it means they are approving something they have not seen, so
// the approval is refused until they reload. Marks the request approved,
// then invokes the Lambda (outside the transaction — a 40001 replay must
// never invoke twice). The conditional update in review() means two
// approvers racing can't both publish.
export async function approvePublish(id, note, seenThrough) {
  const s = await requireRole('editor');
  const busy = await withDb(busyPublish);
  if (busy) {
    console.warn(`[admin] ${s.email} approve not sent: a publish is ${busy.kind} since ${busy.since}`);
    throw new Error('A publish is already running — wait for it to finish, then approve.');
  }
  const trigger = `approve:${id}:${s.email}`;
  await withWriteTx(async (client) => {
    const open = await pendingRequest(client);
    if (!open || open.id !== id) throw new Error('That request is no longer pending.');
    const own = open.requestedByUser === s.username || open.requestedBy === s.email;
    if (own && s.role !== 'owner') {
      console.warn(`[admin] ${s.email} tried to approve their own publish request ${id}`);
      throw new Error('You requested this publish — a different admin (or an owner) has to approve it.');
    }
    if (own) console.log(`[admin] ${s.email} (owner) self-approving publish request ${id}`);
    const unseen = await changesSince(client, seenThrough || open.createdAt);
    if (unseen.length) {
      throw new Error(`${unseen.length} more save(s) landed since you opened this page — reload, review them, then approve.`);
    }
    if (!(await review(client, { id, status: 'approved', reviewedBy: s.email, reviewNote: note, publishTrigger: trigger }))) {
      throw new Error('That request was just reviewed by someone else.');
    }
    await recordChange(client, { actor: s.email, action: 'publish.approve', entityType: 'publish_request', entityId: id, diff: { requestedBy: open.requestedBy, note: note || '', seenThrough: seenThrough || null, selfApproved: own } });
  });
  // Project files the writer asked to publish become public HERE — on a second
  // admin's approval, never on one editor's click
  // (docs/decisions/project-files-two-person-publish.md). Before the invoke:
  // the render selects on public_key, so a file promoted after it would be
  // live but unlisted until the next publish. Outside the tx above: these are
  // S3 copies, which do not belong inside a database transaction.
  try {
    const { promoted, failed } = await withWriteTx((client) => promoteRequestedFiles(client, s.email));
    if (promoted.length || failed.length) {
      await withWriteTx((client) => recordChange(client, {
        actor: s.email, action: 'files.publish_approve', entityType: 'project_files', entityId: id,
        diff: { promoted: promoted.map((p) => p.id), failed },
      }));
    }
    if (failed.length) console.warn(`[admin] ${failed.length} file(s) failed to promote on request ${id}`);
  } catch (err) {
    // The content publish is still correct without them; the requests survive
    // and retry on the next approval. Do not fail the whole publish for this.
    console.error(`[admin] file promotion failed on request ${id}: ${err.message}`);
  }
  try {
    const lambda = new LambdaClient({ region: config.region });
    await lambda.send(new InvokeCommand({
      FunctionName: config.publishFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ trigger })),
    }));
  } catch (err) {
    // Nothing was published. Put the request back so a reviewer can retry,
    // and say so — a green "approved" with no run would mislead the writer.
    console.error(`[admin] ${s.email} publish invoke failed for request ${id}: ${err.message}`);
    await withWriteTx(async (client) => {
      await reopen(client, id);
      await recordChange(client, { actor: s.email, action: 'publish.invoke_failed', entityType: 'publish_request', entityId: id, diff: { error: err.message } });
    });
    throw new Error(`The publish did not start (${err.name || 'error'}). The request is still pending — try again in a minute.`);
  }
}

export async function declinePublish(id, note) {
  const s = await requireRole('editor');
  if (!note?.trim()) throw new Error('A decline needs a note so the writer knows what to change.');
  await withWriteTx(async (client) => {
    const open = await pendingRequest(client);
    if (!open || open.id !== id) throw new Error('That request is no longer pending.');
    if (open.requestedByUser === s.username || open.requestedBy === s.email) {
      throw new Error('You requested this publish — withdraw it instead.');
    }
    if (!(await review(client, { id, status: 'declined', reviewedBy: s.email, reviewNote: note }))) {
      throw new Error('That request was just reviewed by someone else.');
    }
    await recordChange(client, { actor: s.email, action: 'publish.decline', entityType: 'publish_request', entityId: id, diff: { requestedBy: open.requestedBy, note } });
  });
}

// The requester (or an owner clearing a stale request) takes it back.
export async function withdrawPublish(id) {
  const s = await requireRole('editor');
  await withWriteTx(async (client) => {
    const open = await pendingRequest(client);
    if (!open || open.id !== id) throw new Error('That request is no longer pending.');
    const mine = open.requestedByUser === s.username || open.requestedBy === s.email;
    if (!mine && s.role !== 'owner') throw new Error('Only the requester (or an owner) can withdraw a request.');
    if (!(await review(client, { id, status: 'withdrawn', reviewedBy: s.email, reviewNote: mine ? null : 'withdrawn by owner' }))) {
      throw new Error('That request was just reviewed by someone else.');
    }
    await recordChange(client, { actor: s.email, action: 'publish.withdraw', entityType: 'publish_request', entityId: id, diff: { requestedBy: open.requestedBy } });
  });
}
