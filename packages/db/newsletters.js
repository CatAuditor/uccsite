'use strict';
// Newsletters (docs/systems/newsletters.md): composed in the admin, sent by
// the NewsletterSendFn Lambda under the SAME two-person rule as a site
// publish — a writer REQUESTS the send (now, or at a Mountain-time
// schedule), a different editor/owner (or an owner for their own) APPROVES.
//
// status: draft → pending → approved → sending → sent | failed
//   decline / withdraw / cancel-before-start → back to draft (notes kept)
//   failed → retry → approved (deliveries are idempotent, so a resume never
//   mails anyone twice)
//
// html/text are FROZEN at request time: what the reviewer approves is what
// goes out, even if the blocks are edited afterwards (they can't be: a
// non-draft row refuses saves). newsletter_deliveries is the per-recipient
// ledger — the primary key is what makes a Lambda resume safe.
const DDL = [
  `CREATE TABLE IF NOT EXISTS newsletters (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft',
    subject TEXT,
    preheader TEXT,
    headline TEXT,
    from_name TEXT,
    blocks TEXT,
    theme TEXT,
    audience TEXT,
    html TEXT,
    text TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    requested_by TEXT,
    requested_by_user TEXT,
    request_note TEXT,
    requested_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ,
    recipients INTEGER,
    reviewed_by TEXT,
    review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    send_started_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    sent_count INTEGER,
    failed_count INTEGER,
    error TEXT
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_newsletters_status_created ON newsletters(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS newsletter_deliveries (
    newsletter_id UUID NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sending',
    message_id TEXT,
    error TEXT,
    at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (newsletter_id, email)
  )`,
];

const STATUSES = ['draft', 'pending', 'approved', 'sending', 'sent', 'failed'];

const COLS = `id, status, subject, preheader, headline, from_name, blocks, theme, audience, created_by,
  created_at::text AS created_at, updated_at::text AS updated_at,
  requested_by, requested_by_user, request_note, requested_at::text AS requested_at, scheduled_for::text AS scheduled_for, recipients,
  reviewed_by, review_note, reviewed_at::text AS reviewed_at,
  send_started_at::text AS send_started_at, sent_at::text AS sent_at, sent_count, failed_count, error`;

const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

const rowToNewsletter = (r) => ({
  id: r.id, status: r.status, subject: r.subject || '', preheader: r.preheader || '', headline: r.headline || '',
  fromName: r.from_name || '', blocks: parseJson(r.blocks, []), theme: parseJson(r.theme, {}), audience: parseJson(r.audience, {}),
  createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at,
  requestedBy: r.requested_by || '', requestedByUser: r.requested_by_user || '', requestNote: r.request_note || '',
  requestedAt: r.requested_at || '', scheduledFor: r.scheduled_for || '', recipients: r.recipients ?? null,
  reviewedBy: r.reviewed_by || '', reviewNote: r.review_note || '', reviewedAt: r.reviewed_at || '',
  sendStartedAt: r.send_started_at || '', sentAt: r.sent_at || '', sentCount: r.sent_count ?? null, failedCount: r.failed_count ?? null,
  error: r.error || '',
  ...(r.html !== undefined ? { html: r.html || '', text: r.text || '' } : {}),
});

async function listNewsletters(client, limit = 50) {
  const res = await client.query(`SELECT ${COLS} FROM newsletters ORDER BY created_at DESC LIMIT $1`, [limit]);
  return res.rows.map(rowToNewsletter);
}

// getNewsletter(client, id, { body }) → newsletter | null (body: include the frozen html/text)
async function getNewsletter(client, id, { body = false } = {}) {
  const res = await client.query(`SELECT ${COLS}${body ? ', html, text' : ''} FROM newsletters WHERE id = $1`, [id]);
  return res.rows[0] ? rowToNewsletter(res.rows[0]) : null;
}

async function pendingNewsletters(client) {
  const res = await client.query(`SELECT ${COLS} FROM newsletters WHERE status IN ('pending', 'approved', 'sending') ORDER BY created_at`);
  return res.rows.map(rowToNewsletter);
}

async function createNewsletter(client, { createdBy, fromName, subject, theme }) {
  const res = await client.query(
    `INSERT INTO newsletters (id, status, subject, from_name, blocks, theme, audience, created_by)
     VALUES (gen_random_uuid(), 'draft', $1, $2, '[]', $3, '{}', $4) RETURNING id`,
    [subject || '', fromName || '', JSON.stringify(theme || {}), createdBy]);
  return res.rows[0].id;
}

// saveNewsletter(client, { id, ..., expectedUpdatedAt }) → true when the row
// was still a draft AND unchanged since the form was rendered (lost-update
// guard, same idea as lib/data.js stamps); false otherwise.
async function saveNewsletter(client, { id, subject, preheader, headline, fromName, blocks, theme, audience, expectedUpdatedAt }) {
  const res = await client.query(
    `UPDATE newsletters SET subject = $2, preheader = $3, headline = $4, from_name = $5, blocks = $6, theme = $7, audience = $8, updated_at = now()
     WHERE id = $1 AND status = 'draft' AND updated_at::text = $9`,
    [id, subject, preheader, headline, fromName, JSON.stringify(blocks), JSON.stringify(theme), JSON.stringify(audience), expectedUpdatedAt]);
  return res.rowCount === 1;
}

// requestSend(client, {...}) → true when the draft became pending. Freezes
// html/text and the recipient count the requester saw.
async function requestSend(client, { id, requestedBy, requestedByUser, note, scheduledFor, html, text, recipients }) {
  const res = await client.query(
    `UPDATE newsletters SET status = 'pending', requested_by = $2, requested_by_user = $3, request_note = $4, requested_at = now(),
       scheduled_for = $5, html = $6, text = $7, recipients = $8, reviewed_by = NULL, review_note = NULL, reviewed_at = NULL,
       send_started_at = NULL, sent_at = NULL, sent_count = NULL, failed_count = NULL, error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'draft'`,
    [id, requestedBy, requestedByUser, note || null, scheduledFor || null, html, text, recipients]);
  return res.rowCount === 1;
}

// reviewSend(client, { id, approve, reviewedBy, note }) → true when the row was
// still pending. approve=false (decline / withdraw) returns it to draft.
async function reviewSend(client, { id, approve, reviewedBy, note }) {
  const res = await client.query(
    `UPDATE newsletters SET status = $2, reviewed_by = $3, review_note = $4, reviewed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [id, approve ? 'approved' : 'draft', reviewedBy, note || null]);
  return res.rowCount === 1;
}

// cancelScheduled(client, { id, by, note }) → true when an approved send that
// has not started yet went back to draft.
async function cancelScheduled(client, { id, by, note }) {
  const res = await client.query(
    `UPDATE newsletters SET status = 'draft', reviewed_by = $2, review_note = $3, reviewed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'approved' AND send_started_at IS NULL`,
    [id, by, note || null]);
  return res.rowCount === 1;
}

// retryFailed(client, { id }) → true when a failed send is queued again
// (deliveries already recorded are skipped by the Lambda).
async function retryFailed(client, { id }) {
  const res = await client.query(
    `UPDATE newsletters SET status = 'approved', error = NULL, updated_at = now() WHERE id = $1 AND status = 'failed'`, [id]);
  return res.rowCount === 1;
}

// ── Lambda side ───────────────────────────────────────────────────────────
// claimForSending(client, id) → the newsletter WITH body when this call won
// the approved→sending transition (or when resuming an in-flight one), else
// null. The conditional UPDATE is the mutex between the approval's direct
// invoke and the minute tick.
async function claimForSending(client, id, { resume = false } = {}) {
  const res = await client.query(
    `UPDATE newsletters SET status = 'sending', send_started_at = COALESCE(send_started_at, now()), updated_at = now()
     WHERE id = $1 AND (
       (status = 'approved' AND (scheduled_for IS NULL OR scheduled_for <= now()))
       ${resume ? `OR status = 'sending'` : ''}
     ) RETURNING ${COLS}, html, text`, [id]);
  return res.rows[0] ? rowToNewsletter(res.rows[0]) : null;
}

// dueNewsletters(client) → ids approved and scheduled for now or earlier.
async function dueNewsletters(client) {
  const res = await client.query(
    `SELECT id FROM newsletters WHERE status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for <= now() ORDER BY scheduled_for`);
  return res.rows.map((r) => r.id);
}

// beginDelivery(client, id, email) → true when this recipient was not yet
// attempted (the row is the idempotency key for the whole send).
async function beginDelivery(client, id, email) {
  const res = await client.query(
    `INSERT INTO newsletter_deliveries (newsletter_id, email, status) VALUES ($1, $2, 'sending') ON CONFLICT (newsletter_id, email) DO NOTHING`,
    [id, email]);
  return res.rowCount === 1;
}

async function finishDelivery(client, id, email, { status, messageId, error }) {
  await client.query(
    `UPDATE newsletter_deliveries SET status = $3, message_id = $4, error = $5, at = now() WHERE newsletter_id = $1 AND email = $2`,
    [id, email, status, messageId || null, error ? String(error).slice(0, 500) : null]);
}

// deliveryCounts(client, id) → { sent, failed, sending }
async function deliveryCounts(client, id) {
  const res = await client.query(
    `SELECT status, count(*)::int AS n FROM newsletter_deliveries WHERE newsletter_id = $1 GROUP BY status`, [id]);
  const out = { sent: 0, failed: 0, sending: 0 };
  for (const r of res.rows) out[r.status] = r.n;
  return out;
}

async function finishNewsletter(client, id, { status, sent, failed, error }) {
  await client.query(
    `UPDATE newsletters SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
       sent_count = $3, failed_count = $4, error = $5, updated_at = now() WHERE id = $1 AND status = 'sending'`,
    [id, status, sent, failed, error ? String(error).slice(0, 500) : null]);
}

// deleteNewsletter(client, id) → true. Only rows that are not in flight.
async function deleteNewsletter(client, id) {
  await client.query(`DELETE FROM newsletter_deliveries WHERE newsletter_id = $1`, [id]);
  const res = await client.query(`DELETE FROM newsletters WHERE id = $1 AND status NOT IN ('pending', 'approved', 'sending')`, [id]);
  return res.rowCount === 1;
}

module.exports = {
  DDL, STATUSES, rowToNewsletter, listNewsletters, getNewsletter, pendingNewsletters, createNewsletter, saveNewsletter,
  requestSend, reviewSend, cancelScheduled, retryFailed, claimForSending, dueNewsletters, beginDelivery, finishDelivery,
  deliveryCounts, finishNewsletter, deleteNewsletter,
};
