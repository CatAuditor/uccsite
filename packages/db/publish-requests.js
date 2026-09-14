'use strict';
// Two-person publishing. Every edit is a draft in the database; the live
// site only changes through a publish request that a DIFFERENT admin
// approves. The publish Lambda is invoked by the approval, never by the
// requester. One request can be pending at a time; a decline carries notes
// back to the requester; the requester can withdraw.
//
// status: pending → approved (publish invoked) | declined | withdrawn
const DDL = [
  `CREATE TABLE IF NOT EXISTS publish_requests (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT NOT NULL,
    requested_by_user TEXT,
    request_note TEXT,
    changes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    reviewed_by TEXT,
    review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    publish_trigger TEXT
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_publish_requests_created ON publish_requests(created_at)`,
  // One-row gate every request transaction writes (bumpGate): DSQL only
  // detects write-write conflicts, so two "is anything pending? no → insert"
  // transactions racing would otherwise both commit a pending row.
  `CREATE TABLE IF NOT EXISTS publish_request_gate (id TEXT PRIMARY KEY, n BIGINT NOT NULL DEFAULT 0)`,
  `INSERT INTO publish_request_gate (id, n) VALUES ('singleton', 0) ON CONFLICT (id) DO NOTHING`,
];

const COLS = `id, status, requested_by, requested_by_user, request_note, changes, created_at::text AS created_at,
  reviewed_by, review_note, reviewed_at::text AS reviewed_at, publish_trigger`;

const rowToRequest = (r) => ({
  id: r.id, status: r.status, requestedBy: r.requested_by, requestedByUser: r.requested_by_user || '', requestNote: r.request_note || '',
  changes: (() => { try { return r.changes ? JSON.parse(r.changes) : []; } catch { return []; } })(),
  createdAt: r.created_at, reviewedBy: r.reviewed_by || '', reviewNote: r.review_note || '',
  reviewedAt: r.reviewed_at || '', publishTrigger: r.publish_trigger || '',
});

// Content-affecting audit actions (what a reviewer needs to see). Account,
// user and publish bookkeeping rows are noise here.
// Matches every content action name the admin records (lib/collection-save.js
// `${key}.save`, documents/actions.js, media, redirects, revisions `.restore`).
const CONTENT_ACTION_RE = /^(settings|homepage|team|statements|issues|blog|blog-[a-z]+|projects|coverage|coverage-[a-z]+|document|media|redirect|style_rule|foreign_class)\./;

// changesSince(client, sinceIso|null) → [{ actor, action, entityType, entityId, at }]
async function changesSince(client, sinceIso) {
  const res = sinceIso
    ? await client.query(`SELECT actor, action, entity_type, entity_id, at::text AS at FROM audit_log WHERE at > $1 ORDER BY at`, [sinceIso])
    : await client.query(`SELECT actor, action, entity_type, entity_id, at::text AS at FROM audit_log ORDER BY at`);
  return res.rows.filter(r => CONTENT_ACTION_RE.test(r.action))
    .map(r => ({ actor: r.actor, action: r.action, entityType: r.entity_type || '', entityId: r.entity_id || '', at: r.at }));
}

// lastLiveAt(client) → when the live site's content was last read from the
// database: the STARTED_AT of the newest succeeded/noop run (the Lambda
// snapshots the DB right after it starts, so a save committed while that
// run rendered is not live and must still count as unpublished).
async function lastLiveAt(client) {
  const res = await client.query(
    `SELECT started_at::text AS s FROM publish_runs WHERE status IN ('succeeded', 'noop') ORDER BY started_at DESC LIMIT 1`);
  return res.rows[0]?.s || null;
}

// bumpGate(client) — call inside the request transaction before inserting.
async function bumpGate(client) {
  await client.query(`UPDATE publish_request_gate SET n = n + 1 WHERE id = 'singleton'`);
}

// runsFor(client, triggers) → { [trigger_source]: status } for the publish
// runs an approval started (trigger carries the request id, so it's unique).
async function runsFor(client, triggers) {
  const list = triggers.filter(Boolean);
  if (!list.length) return {};
  const res = await client.query(
    `SELECT trigger_source, status FROM publish_runs WHERE trigger_source IN (${list.map((_, i) => `$${i + 1}`).join(', ')})
     ORDER BY started_at`, list);
  return Object.fromEntries(res.rows.map(r => [r.trigger_source, r.status]));
}

// reopen(client, id) — an approved request whose Lambda invoke failed goes
// back to pending so a reviewer can try again (nothing was published).
async function reopen(client, id) {
  const res = await client.query(
    `UPDATE publish_requests SET status = 'pending', reviewed_by = NULL, review_note = NULL, reviewed_at = NULL, publish_trigger = NULL
     WHERE id = $1 AND status = 'approved'`, [id]);
  return res.rowCount === 1;
}

async function pendingRequest(client) {
  const res = await client.query(`SELECT ${COLS} FROM publish_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`);
  return res.rows[0] ? rowToRequest(res.rows[0]) : null;
}

async function listRequests(client, limit = 20) {
  const res = await client.query(`SELECT ${COLS} FROM publish_requests ORDER BY created_at DESC LIMIT $1`, [limit]);
  return res.rows.map(rowToRequest);
}

// requestedBy = verified email (display); requestedByUser = cognito:username
// (the stable identity the "different admin" check compares).
async function createRequest(client, { requestedBy, requestedByUser, requestNote, changes }) {
  const res = await client.query(
    `INSERT INTO publish_requests (id, status, requested_by, requested_by_user, request_note, changes)
     VALUES (gen_random_uuid(), 'pending', $1, $2, $3, $4) RETURNING id`,
    [requestedBy, requestedByUser, requestNote || null, JSON.stringify(changes || [])]);
  return res.rows[0].id;
}

// review(client, { id, status: 'approved'|'declined'|'withdrawn', reviewedBy, reviewNote, publishTrigger })
// → true when the row was still pending (conditional update = no double review).
async function review(client, { id, status, reviewedBy, reviewNote, publishTrigger }) {
  const res = await client.query(
    `UPDATE publish_requests SET status = $2, reviewed_by = $3, review_note = $4, reviewed_at = now(), publish_trigger = $5
     WHERE id = $1 AND status = 'pending'`,
    [id, status, reviewedBy, reviewNote || null, publishTrigger || null]);
  return res.rowCount === 1;
}

module.exports = { DDL, CONTENT_ACTION_RE, changesSince, lastLiveAt, bumpGate, runsFor, reopen, pendingRequest, listRequests, createRequest, review, rowToRequest };
