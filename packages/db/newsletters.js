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
// html/text/web_html are FROZEN at request time: what the reviewer approves
// is what goes out, even if the blocks are edited afterwards (they can't be:
// a non-draft row refuses saves). newsletter_deliveries is the per-recipient
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
  // 2026-10-05 additions (existing clusters: ADD COLUMN):
  //   publish_to_site  1 = a web copy goes to /newsletters/<slug> after the send (NULL = 1)
  //   slug, web_html   the archive page (slug fixed at request time; web_html = blocks rendered for the site)
  //   archived_at      set by the Lambda when the send finished and publish_to_site — the publish pipeline lists these
  //   requested_blocks the blocks as of the latest request; prior_blocks = the request before (reviewer diff)
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS publish_to_site INTEGER`,
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS slug TEXT`,
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS web_html TEXT`,
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS requested_blocks TEXT`,
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS prior_blocks TEXT`,
  // 2026-10-09 (docs/systems/email.md "Attached emails"): kind = 'newsletter'
  // (NULL = newsletter, the default) | 'transactional' — an automatic email
  // composed with the same blocks, never sent to the audience; instead it is
  // ATTACHED to a trigger. transactional_emails = one row per trigger: the
  // frozen subject/html/text the API Lambda sends (api role: SELECT only).
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS kind TEXT`,
  `CREATE TABLE IF NOT EXISTS transactional_emails (
    trigger TEXT PRIMARY KEY,
    newsletter_id UUID NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text TEXT,
    attached_by TEXT,
    attached_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS newsletter_deliveries (
    newsletter_id UUID NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sending',
    message_id TEXT,
    error TEXT,
    at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (newsletter_id, email)
  )`,
  // The org's default look for NEW drafts ("Use this look as the default").
  `CREATE TABLE IF NOT EXISTS newsletter_defaults (id TEXT PRIMARY KEY, theme TEXT, updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT now())`,
  `INSERT INTO newsletter_defaults (id, theme) VALUES ('singleton', '{}') ON CONFLICT (id) DO NOTHING`,
];

const STATUSES = ['draft', 'pending', 'approved', 'sending', 'sent', 'failed'];
const KINDS = ['newsletter', 'transactional'];

// The triggers an automatic email can be attached to (aws/api/routes.js
// transactionalTemplate reads by key). placeholders: {name} tokens the API
// fills in (text, HTML-escaped; `receipt` is raw markup); required: tokens
// the attach refuses without (the receipt carries the 501(c)(4) line).
const TRIGGERS = [
  { key: 'petition-thanks', label: 'Petition signed — thank-you', when: 'the first time an address signs the live petition',
    placeholders: ['first_name', 'headline', 'project_name'], required: [] },
  { key: 'donation-thanks', label: 'Donation received — thank-you and receipt', when: 'after every completed checkout (one-time, or the first monthly charge)',
    placeholders: ['first_name', 'amount', 'type', 'date', 'receipt'], required: ['receipt'] },
];
const triggerOf = (key) => TRIGGERS.find((t) => t.key === key) || null;
const STALE_DELIVERY_MINUTES = 10;

const COLS = `id, status, kind, subject, preheader, headline, from_name, blocks, theme, audience, created_by,
  created_at::text AS created_at, updated_at::text AS updated_at,
  requested_by, requested_by_user, request_note, requested_at::text AS requested_at, scheduled_for::text AS scheduled_for, recipients,
  reviewed_by, review_note, reviewed_at::text AS reviewed_at,
  send_started_at::text AS send_started_at, sent_at::text AS sent_at, sent_count, failed_count, error,
  publish_to_site, slug, archived_at::text AS archived_at, requested_blocks, prior_blocks`;

const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

const rowToNewsletter = (r) => ({
  id: r.id, status: r.status, kind: r.kind === 'transactional' ? 'transactional' : 'newsletter', subject: r.subject || '', preheader: r.preheader || '', headline: r.headline || '',
  fromName: r.from_name || '', blocks: parseJson(r.blocks, []), theme: parseJson(r.theme, {}), audience: parseJson(r.audience, {}),
  createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at,
  requestedBy: r.requested_by || '', requestedByUser: r.requested_by_user || '', requestNote: r.request_note || '',
  requestedAt: r.requested_at || '', scheduledFor: r.scheduled_for || '', recipients: r.recipients ?? null,
  reviewedBy: r.reviewed_by || '', reviewNote: r.review_note || '', reviewedAt: r.reviewed_at || '',
  sendStartedAt: r.send_started_at || '', sentAt: r.sent_at || '', sentCount: r.sent_count ?? null, failedCount: r.failed_count ?? null,
  error: r.error || '',
  publishToSite: r.publish_to_site == null ? true : Boolean(r.publish_to_site), slug: r.slug || '', archivedAt: r.archived_at || '',
  requestedBlocks: parseJson(r.requested_blocks, null), priorBlocks: parseJson(r.prior_blocks, null),
  ...(r.html !== undefined ? { html: r.html || '', text: r.text || '', webHtml: r.web_html || '' } : {}),
});

async function listNewsletters(client, limit = 50) {
  const res = await client.query(`SELECT ${COLS} FROM newsletters ORDER BY created_at DESC LIMIT $1`, [limit]);
  return res.rows.map(rowToNewsletter);
}

// getNewsletter(client, id, { body }) → newsletter | null (body: include the frozen html/text/web_html)
async function getNewsletter(client, id, { body = false } = {}) {
  const res = await client.query(`SELECT ${COLS}${body ? ', html, text, web_html' : ''} FROM newsletters WHERE id = $1`, [id]);
  return res.rows[0] ? rowToNewsletter(res.rows[0]) : null;
}

async function pendingNewsletters(client) {
  const res = await client.query(`SELECT ${COLS} FROM newsletters WHERE status IN ('pending', 'approved', 'sending') ORDER BY created_at`);
  return res.rows.map(rowToNewsletter);
}

async function createNewsletter(client, { createdBy, fromName, subject, theme, kind = 'newsletter' }) {
  const res = await client.query(
    `INSERT INTO newsletters (id, status, kind, subject, from_name, blocks, theme, audience, created_by)
     VALUES (gen_random_uuid(), 'draft', $5, $1, $2, '[]', $3, '{}', $4) RETURNING id`,
    [subject || '', fromName || '', JSON.stringify(theme || {}), createdBy, KINDS.includes(kind) ? kind : 'newsletter']);
  return res.rows[0].id;
}

// duplicateNewsletter(client, { id, createdBy, fromName, subject }) → new draft id
// copying the content, look, audience and publish flag of an existing row.
async function duplicateNewsletter(client, { id, createdBy, fromName, subject }) {
  const res = await client.query(
    `INSERT INTO newsletters (id, status, kind, subject, preheader, headline, from_name, blocks, theme, audience, publish_to_site, created_by)
     SELECT gen_random_uuid(), 'draft', kind, $2, preheader, headline, $3, blocks, theme, audience, publish_to_site, $4 FROM newsletters WHERE id = $1
     RETURNING id`,
    [id, subject, fromName, createdBy]);
  return res.rows[0]?.id || null;
}

// saveNewsletter(client, { id, ..., expectedUpdatedAt }) → true when the row
// was still a draft AND unchanged since the form was rendered (lost-update
// guard, same idea as lib/data.js stamps); false otherwise.
async function saveNewsletter(client, { id, subject, preheader, headline, fromName, blocks, theme, audience, publishToSite = true, expectedUpdatedAt }) {
  const res = await client.query(
    `UPDATE newsletters SET subject = $2, preheader = $3, headline = $4, from_name = $5, blocks = $6, theme = $7, audience = $8, publish_to_site = $10, updated_at = now()
     WHERE id = $1 AND status = 'draft' AND updated_at::text = $9`,
    [id, subject, preheader, headline, fromName, JSON.stringify(blocks), JSON.stringify(theme), JSON.stringify(audience), expectedUpdatedAt, publishToSite ? 1 : 0]);
  return res.rowCount === 1;
}

// requestSend(client, {...}) → true when the draft became pending. Freezes
// html/text/web_html, the slug, the recipient count the requester saw, and
// the blocks (requested_blocks; the previous request's move to prior_blocks
// so a reviewer can see what changed on a re-request).
async function requestSend(client, { id, requestedBy, requestedByUser, note, scheduledFor, html, text, webHtml, slug, recipients, blocks }) {
  const res = await client.query(
    `UPDATE newsletters SET status = 'pending', requested_by = $2, requested_by_user = $3, request_note = $4, requested_at = now(),
       scheduled_for = $5, html = $6, text = $7, recipients = $8, web_html = $9, slug = COALESCE(slug, $10),
       prior_blocks = requested_blocks, requested_blocks = $11,
       reviewed_by = NULL, review_note = NULL, reviewed_at = NULL,
       send_started_at = NULL, sent_at = NULL, sent_count = NULL, failed_count = NULL, error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'draft'`,
    [id, requestedBy, requestedByUser, note || null, scheduledFor || null, html, text, recipients, webHtml || null, slug || null, JSON.stringify(blocks || [])]);
  return res.rowCount === 1;
}

// reschedule(client, { id, scheduledFor }) → true: a PENDING request's time
// changed (null = send on approval).
async function reschedule(client, { id, scheduledFor }) {
  const res = await client.query(
    `UPDATE newsletters SET scheduled_for = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`, [id, scheduledFor || null]);
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

// ── defaults ──────────────────────────────────────────────────────────────
async function getDefaults(client) {
  const r = (await client.query(`SELECT theme, updated_by, updated_at::text AS updated_at FROM newsletter_defaults WHERE id = 'singleton'`)).rows[0];
  return { theme: parseJson(r?.theme, {}), updatedBy: r?.updated_by || '', updatedAt: r?.updated_at || '' };
}
async function setDefaults(client, { theme, updatedBy }) {
  await client.query(
    `INSERT INTO newsletter_defaults (id, theme, updated_by, updated_at) VALUES ('singleton', $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET theme = excluded.theme, updated_by = excluded.updated_by, updated_at = now()`,
    [JSON.stringify(theme || {}), updatedBy]);
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
     ) RETURNING ${COLS}, html, text, web_html`, [id]);
  return res.rows[0] ? rowToNewsletter(res.rows[0]) : null;
}

// dueNewsletters(client) → ids approved and scheduled for now or earlier.
async function dueNewsletters(client) {
  const res = await client.query(
    `SELECT id FROM newsletters WHERE status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for <= now() ORDER BY scheduled_for`);
  return res.rows.map((r) => r.id);
}

// beginDelivery(client, id, email) → true when this recipient should be sent
// to now: no row yet, OR a row stuck in 'sending' for longer than
// STALE_DELIVERY_MINUTES (a crashed run never finished it — the SES call
// may or may not have happened; a second copy is the lesser harm compared
// with silently never sending). The row is the idempotency key otherwise.
async function beginDelivery(client, id, email) {
  const res = await client.query(
    `INSERT INTO newsletter_deliveries (newsletter_id, email, status) VALUES ($1, $2, 'sending')
     ON CONFLICT (newsletter_id, email) DO UPDATE SET status = 'sending', at = now()
       WHERE newsletter_deliveries.status = 'sending' AND newsletter_deliveries.at < now() - interval '${STALE_DELIVERY_MINUTES} minutes'`,
    [id, email]);
  return res.rowCount === 1;
}

async function finishDelivery(client, id, email, { status, messageId, error }) {
  await client.query(
    `UPDATE newsletter_deliveries SET status = $3, message_id = $4, error = $5, at = now() WHERE newsletter_id = $1 AND email = $2`,
    [id, email, status, messageId || null, error ? String(error).slice(0, 500) : null]);
}

// deliveryCounts(client, id) → { sent, failed, sending, suppressed }
// suppressed = recipients whose address has a suppressing SES event (they
// were attempted before the bounce/complaint arrived, or SES rejected them).
async function deliveryCounts(client, id) {
  const res = await client.query(
    `SELECT status, count(*)::int AS n,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events ee WHERE ee.email = d.email AND ee.suppress = 1))::int AS suppressed
     FROM newsletter_deliveries d WHERE newsletter_id = $1 GROUP BY status`, [id]);
  const out = { sent: 0, failed: 0, sending: 0, suppressed: 0 };
  for (const r of res.rows) { out[r.status] = r.n; out.suppressed += r.suppressed; }
  return out;
}

// deliveriesFor(client, id) → the ledger rows (owner view / CSV).
async function deliveriesFor(client, id) {
  const res = await client.query(
    `SELECT email, status, message_id, error, at::text AS at FROM newsletter_deliveries WHERE newsletter_id = $1 ORDER BY at`, [id]);
  return res.rows;
}

async function finishNewsletter(client, id, { status, sent, failed, error }) {
  await client.query(
    `UPDATE newsletters SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
       archived_at = CASE WHEN $2 = 'sent' AND COALESCE(publish_to_site, 1) = 1 AND web_html IS NOT NULL THEN now() ELSE archived_at END,
       sent_count = $3, failed_count = $4, error = $5, updated_at = now() WHERE id = $1 AND status = 'sending'`,
    [id, status, sent, failed, error ? String(error).slice(0, 500) : null]);
}

// listArchive(client) → sent-and-archived newsletters, newest first, with
// the frozen web_html — what the publish pipeline renders to /newsletters/.
async function listArchive(client) {
  const res = await client.query(
    `SELECT id, subject, preheader, headline, slug, web_html, sent_at::text AS sent_at, archived_at::text AS archived_at
     FROM newsletters WHERE archived_at IS NOT NULL AND slug IS NOT NULL ORDER BY sent_at DESC`);
  return res.rows.map((r) => ({ id: r.id, subject: r.subject || '', preheader: r.preheader || '', headline: r.headline || '', slug: r.slug, webHtml: r.web_html || '', sentAt: r.sent_at, archivedAt: r.archived_at }));
}

// openCounts(client, ids) → Map<newsletter_id, hits> (campaign-level pixel hits).
async function openCounts(client, ids) {
  if (!ids.length) return new Map();
  const res = await client.query(`SELECT newsletter_id, count(*)::int AS n FROM newsletter_opens WHERE newsletter_id = ANY($1::uuid[]) GROUP BY newsletter_id`, [ids]);
  return new Map(res.rows.map((r) => [r.newsletter_id, r.n]));
}

// deleteNewsletter(client, id) → true. Only rows that are not in flight.
// ── Attached (automatic) emails ─────────────────────────────────────────────
// attachTransactional: the newsletter's rendered bytes become the live email
// for `trigger` (one per trigger — an upsert replaces whatever was attached).
async function attachTransactional(client, { trigger, newsletterId, subject, html, text, attachedBy }) {
  if (!triggerOf(trigger)) throw new Error(`Unknown trigger: ${trigger}`);
  await client.query(
    `INSERT INTO transactional_emails (trigger, newsletter_id, subject, html, text, attached_by, attached_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (trigger) DO UPDATE SET newsletter_id = excluded.newsletter_id, subject = excluded.subject, html = excluded.html,
       text = excluded.text, attached_by = excluded.attached_by, attached_at = now()`,
    [trigger, newsletterId, subject, html, text || '', attachedBy || null]);
}

async function detachTransactional(client, trigger) {
  const res = await client.query(`DELETE FROM transactional_emails WHERE trigger = $1`, [trigger]);
  return res.rowCount === 1;
}

// listAttachments(client) → [{ trigger, newsletterId, subject (frozen), attachedBy, attachedAt, currentSubject }]
async function listAttachments(client) {
  const res = await client.query(
    `SELECT a.trigger, a.newsletter_id, a.subject, a.attached_by, a.attached_at::text AS attached_at, n.subject AS current_subject
     FROM transactional_emails a LEFT JOIN newsletters n ON n.id = a.newsletter_id ORDER BY a.trigger`);
  return res.rows.map((r) => ({
    trigger: r.trigger, newsletterId: r.newsletter_id, subject: r.subject || '', attachedBy: r.attached_by || '', attachedAt: r.attached_at || '',
    currentSubject: r.current_subject || '',
  }));
}

async function deleteNewsletter(client, id) {
  await client.query(`DELETE FROM newsletter_deliveries WHERE newsletter_id = $1`, [id]);
  await client.query(`DELETE FROM newsletter_opens WHERE newsletter_id = $1`, [id]);
  const res = await client.query(`DELETE FROM newsletters WHERE id = $1 AND status NOT IN ('pending', 'approved', 'sending')`, [id]);
  // A deleted automatic email can no longer be the live one for its trigger.
  if (res.rowCount === 1) await client.query(`DELETE FROM transactional_emails WHERE newsletter_id = $1`, [id]);
  return res.rowCount === 1;
}

module.exports = {
  DDL, STATUSES, KINDS, TRIGGERS, triggerOf, STALE_DELIVERY_MINUTES, rowToNewsletter,
  attachTransactional, detachTransactional, listAttachments, listNewsletters, getNewsletter, pendingNewsletters, createNewsletter, duplicateNewsletter, saveNewsletter,
  requestSend, reschedule, reviewSend, cancelScheduled, retryFailed, getDefaults, setDefaults, claimForSending, dueNewsletters, beginDelivery, finishDelivery,
  deliveryCounts, deliveriesFor, finishNewsletter, listArchive, openCounts, deleteNewsletter,
};
