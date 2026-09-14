// Two-person publishing (docs/systems/admin.md "Publishing"). The ONLY
// place the admin invokes the PublishFn Lambda is approvePublish below, and
// it refuses when the approver is the requester. Saves stay drafts in the
// database until a request is approved by a second admin.
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  pendingRequest, listRequests, createRequest, review, changesSince, lastLiveAt,
} from '@uccsite/db/publish-requests';
import { requireRole } from './auth';
import { withDb, withWriteTx, recordChange, inFlightPublish } from './data';
import { config } from './config';

// publishState() → what the dashboard renders.
export async function publishState() {
  return withDb(async (client) => {
    const pending = await pendingRequest(client);
    const liveAt = await lastLiveAt(client);
    return {
      pending,
      liveAt,
      // Drafts not yet on the live site (content audit rows since the last
      // successful publish); when a request is pending, the ones made after
      // it were not part of what the requester asked to publish.
      unpublished: await changesSince(client, liveAt),
      sinceRequest: pending ? await changesSince(client, pending.createdAt) : [],
      requests: await listRequests(client, 10),
      inFlight: await inFlightPublish(client),
    };
  });
}

export async function requestPublish(note) {
  const s = await requireRole('editor');
  return withWriteTx(async (client) => {
    const open = await pendingRequest(client);
    if (open) throw new Error(`A publish request from ${open.requestedBy} is already waiting for review.`);
    const changes = await changesSince(client, await lastLiveAt(client));
    if (!changes.length) throw new Error('Nothing to publish — no saves since the site last went live.');
    const id = await createRequest(client, {
      requestedBy: s.email, requestedByUser: s.username, requestNote: note, changes,
    });
    await recordChange(client, { actor: s.email, action: 'publish.request', entityType: 'publish_request', entityId: id, diff: { changes: changes.length } });
    return id;
  });
}

// approvePublish(id, note): a DIFFERENT editor/owner than the requester.
// Marks the request approved, then invokes the Lambda. The conditional
// update in review() means two approvers racing can't both publish.
export async function approvePublish(id, note) {
  const s = await requireRole('editor');
  const inFlightRun = await withDb(inFlightPublish);
  if (inFlightRun) {
    console.warn(`[admin] ${s.email} approve not sent: run ${inFlightRun.id} in flight`);
    throw new Error('A publish is already running — wait for it to finish, then approve.');
  }
  const trigger = `approve:${s.email}`;
  await withWriteTx(async (client) => {
    const open = await pendingRequest(client);
    if (!open || open.id !== id) throw new Error('That request is no longer pending.');
    if (open.requestedByUser === s.username || open.requestedBy === s.email) {
      console.warn(`[admin] ${s.email} tried to approve their own publish request ${id}`);
      throw new Error('You requested this publish — a different admin has to approve it.');
    }
    if (!(await review(client, { id, status: 'approved', reviewedBy: s.email, reviewNote: note, publishTrigger: trigger }))) {
      throw new Error('That request was just reviewed by someone else.');
    }
    await recordChange(client, { actor: s.email, action: 'publish.approve', entityType: 'publish_request', entityId: id, diff: { requestedBy: open.requestedBy, note: note || '' } });
  });
  const lambda = new LambdaClient({ region: config.region });
  await lambda.send(new InvokeCommand({
    FunctionName: config.publishFunctionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({ trigger })),
  }));
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
