// Newsletters — compose, request, review, send (docs/systems/newsletters.md).
// The two-person rule from lib/publish.js applied to email: a writer
// REQUESTS a send (now, or at a Mountain-time schedule), a DIFFERENT
// editor/owner approves — or an owner approves their own. The approval is
// the ONLY place the NewsletterSendFn Lambda is invoked from the admin
// ("send now"); scheduled sends are started by the Lambda's own minute tick.
// Every action is audited `newsletter.<verb>` — a prefix the site-publish
// change list ignores, so writing a newsletter never counts as an
// unpublished site save.
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { audienceQuery, normalizeFilters, describeFilters } from '@uccsite/db/audience';
import * as db from '@uccsite/db/newsletters';
import { renderEmail, normalizeBlocks, normalizeTheme, fromHeader, rawBlock, UNSUBSCRIBE_TOKEN } from '@uccsite/newsletter/render';
import { renderWebBody, archiveSlug } from '@uccsite/newsletter/web';
import { parseSchedule, formatZoned } from '@uccsite/newsletter/schedule';
import { requireRole } from './auth';
import { withDb, withWriteTx, recordChange } from './data';
import { notifyNewsletterRequested } from './notify';
import { PUBLISH_REVIEWERS } from './notify-recipients.mjs';
import { config } from './config';

const UUID_RE = /^[0-9a-f-]{36}$/;
const assertId = (id) => { if (!UUID_RE.test(String(id))) throw new Error('Bad newsletter id'); return String(id); };
const NOTE_MAX = 2000;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// authorNameFor(client, email) → the team member's name for an admin's
// email, else the address's local part made readable ("jarom.gillins" →
// "Jarom Gillins"). This is what the From display name carries.
export async function authorNameFor(client, email) {
  const r = (await client.query(`SELECT name FROM team_members WHERE lower(email) = lower($1) AND name <> '' LIMIT 1`, [email])).rows[0];
  if (r?.name) return r.name;
  return String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1)).join(' ');
}

export async function teamNames(client) {
  return (await client.query(`SELECT name FROM team_members WHERE name <> '' ORDER BY sort_order`)).rows.map((r) => r.name);
}

// audienceCount(client, audience) → how many people the saved filters reach.
export async function audienceCount(client, audience) {
  const { sql, params } = audienceQuery(normalizeFilters(audience), { columns: 'count(*)::int AS n', orderBy: null });
  return (await client.query(sql, params)).rows[0].n;
}

export async function petitionSlugs(client) {
  return (await client.query('SELECT DISTINCT petition FROM petition_signatures ORDER BY petition')).rows.map((r) => r.petition);
}

// blockDiff(before, after) → { added, removed, changed } counts + a short
// list of lines for the reviewer ("what changed since the last request").
export function blockDiff(before, after) {
  const key = (b) => JSON.stringify(b);
  const label = (b) => b.type === 'text' ? `Text: ${b.markdown.slice(0, 60)}${b.markdown.length > 60 ? '…' : ''}`
    : b.type === 'heading' ? `Heading: ${b.text}` : b.type === 'button' ? `Button: ${b.label}` : b.type === 'image' ? `Image: ${b.alt || b.url}`
    : b.type === 'quote' ? `Quote: ${b.text.slice(0, 60)}` : b.type === 'raw' ? `Raw HTML (${b.html.length} characters)` : 'Divider';
  const a = normalizeBlocks(before || []); const b = normalizeBlocks(after || []);
  const aKeys = new Set(a.map(key)); const bKeys = new Set(b.map(key));
  const removed = a.filter((x) => !bKeys.has(key(x))).map(label);
  const added = b.filter((x) => !aKeys.has(key(x))).map(label);
  return { added, removed, same: a.length === b.length && added.length === 0 && removed.length === 0 };
}

// newsletterPage(id) → everything /mail/[id] renders.
export async function newsletterPage(id) {
  await requireRole('viewer');
  return withDb(async (client) => {
    const newsletter = await db.getNewsletter(client, assertId(id));
    if (!newsletter) return null;
    // Sequential: the shared read client is one pg connection (concurrent
    // query() calls on it are deprecated and serialise anyway).
    const names = await teamNames(client);
    const count = await audienceCount(client, newsletter.audience);
    const petitions = await petitionSlugs(client);
    const deliveries = ['sending', 'sent', 'failed'].includes(newsletter.status) ? await db.deliveryCounts(client, newsletter.id) : null;
    const opens = deliveries ? (await db.openCounts(client, [newsletter.id])).get(newsletter.id) || 0 : 0;
    const defaults = await db.getDefaults(client);
    const diff = newsletter.status === 'pending' && newsletter.priorBlocks ? blockDiff(newsletter.priorBlocks, newsletter.requestedBlocks || newsletter.blocks) : null;
    return { newsletter, names, count, petitions, deliveries, defaults, diff, opens };
  });
}

export async function createNewsletter(subject) {
  const s = await requireRole('editor');
  return withWriteTx(async (client) => {
    const fromName = await authorNameFor(client, s.email);
    const { theme } = await db.getDefaults(client);
    const id = await db.createNewsletter(client, { createdBy: s.email, fromName, subject: clip(subject, 200), theme });
    await recordChange(client, { actor: s.email, action: 'newsletter.create', entityType: 'newsletter', entityId: id, diff: { subject: clip(subject, 200) } });
    return id;
  });
}

// duplicateNewsletter(id) → the new draft's id (content, look, audience copied).
export async function duplicateNewsletter(id) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  return withWriteTx(async (client) => {
    const src = await db.getNewsletter(client, nid);
    if (!src) throw new Error('That newsletter no longer exists.');
    const fromName = await authorNameFor(client, s.email);
    const newId = await db.duplicateNewsletter(client, { id: nid, createdBy: s.email, fromName, subject: clip(`${src.subject} (copy)`, 200) });
    await recordChange(client, { actor: s.email, action: 'newsletter.duplicate', entityType: 'newsletter', entityId: newId, diff: { from: nid } });
    return newId;
  });
}

// saveDefaults(id): this newsletter's look becomes the default for new drafts.
export async function saveDefaults(id) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  await withWriteTx(async (client) => {
    const n = await db.getNewsletter(client, nid);
    if (!n) throw new Error('That newsletter no longer exists.');
    await db.setDefaults(client, { theme: normalizeTheme(n.theme), updatedBy: s.email });
    await recordChange(client, { actor: s.email, action: 'newsletter.defaults', entityType: 'newsletter', entityId: nid, diff: normalizeTheme(n.theme) });
  });
}

// saveNewsletter(id, formData) — drafts only; the stamp refuses a save over
// someone else's (or over a request that landed meanwhile).
export async function saveNewsletter(id, formData) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  let blocks; let theme;
  try { blocks = normalizeBlocks(JSON.parse(String(formData.get('blocks') || '[]'))); } catch (err) { throw new Error(`Blocks could not be read: ${err.message}`); }
  try { theme = normalizeTheme(JSON.parse(String(formData.get('theme') || '{}'))); } catch { throw new Error('Theme could not be read'); }
  const audience = normalizeFilters({ residency: formData.get('residency'), donors: formData.get('donors'), petition: formData.get('petition') });
  const fields = {
    subject: clip(formData.get('subject'), 200), preheader: clip(formData.get('preheader'), 200), headline: clip(formData.get('headline'), 200),
    fromName: clip(formData.get('fromName'), 60), blocks, theme, audience, publishToSite: formData.get('publishToSite') === '1',
  };
  await withWriteTx(async (client) => {
    const ok = await db.saveNewsletter(client, { id: nid, ...fields, expectedUpdatedAt: String(formData.get('updatedAt') || '') });
    if (!ok) {
      const row = await db.getNewsletter(client, nid);
      if (!row) throw new Error('This newsletter no longer exists.');
      if (row.status !== 'draft') throw new Error(`This newsletter is ${row.status} — it can only be edited as a draft (withdraw or cancel the request first).`);
      throw new Error('Someone else saved this newsletter since you opened it — reload to see their version.');
    }
    await recordChange(client, { actor: s.email, action: 'newsletter.save', entityType: 'newsletter', entityId: nid, snapshot: { ...fields }, diff: { subject: fields.subject, blocks: blocks.length, audience: describeFilters(audience), publishToSite: fields.publishToSite } });
  });
  return fields;
}

// renderFrozen(n, slug, { pixel }) → { html, text, webHtml } — the bytes a
// request freezes. pixel: the campaign-level open counter (real sends only;
// a test send must not count as an open). A raw-HTML email gets no web copy:
// the site CSP (style-src 'self') would strip its inline styles.
function renderFrozen(n, slug, { pixel = false } = {}) {
  const web = n.publishToSite && !rawBlock(n.blocks);
  const viewUrl = web && slug ? `${config.publicOrigin}/newsletters/${slug}` : '';
  const pixelUrl = pixel ? `${config.publicOrigin}/api/open?c=${n.id}` : '';
  const { html, text } = renderEmail(n, { mode: 'auto', viewUrl, siteUrl: config.publicOrigin, campaign: slug || n.id, pixelUrl });
  const webHtml = web ? renderWebBody(n) : '';
  return { html, text, webHtml };
}

// requestSend(id, note, scheduleLocal) → { needsReview, notified, scheduledFor }
// Freezes the rendered html/text/web copy, the slug and the recipient count.
export async function requestSend(id, note, scheduleLocal) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  const { at } = parseSchedule(scheduleLocal);
  const { recipients, subject } = await withWriteTx(async (client) => {
    const n = await db.getNewsletter(client, nid);
    if (!n) throw new Error('This newsletter no longer exists.');
    if (n.status !== 'draft') throw new Error(`This newsletter is already ${n.status}.`);
    if (!n.subject.trim()) throw new Error('Give the email a subject line first.');
    if (!normalizeBlocks(n.blocks).length) throw new Error('The email has no content yet — add at least one block and save.');
    const recipients = await audienceCount(client, n.audience);
    if (!recipients) throw new Error(`Nobody matches the audience (${describeFilters(normalizeFilters(n.audience))}).`);
    const slug = n.slug || archiveSlug(n.subject, at || new Date());
    const { html, text, webHtml } = renderFrozen(n, slug, { pixel: true });
    const ok = await db.requestSend(client, {
      id: nid, requestedBy: s.email, requestedByUser: s.username, note: clip(note, NOTE_MAX), scheduledFor: at ? at.toISOString() : null,
      html, text, webHtml, slug, recipients, blocks: n.blocks,
    });
    if (!ok) throw new Error('This newsletter was just changed by someone else — reload.');
    await recordChange(client, { actor: s.email, action: 'newsletter.request', entityType: 'newsletter', entityId: nid, diff: { recipients, scheduledFor: at ? at.toISOString() : null, audience: describeFilters(normalizeFilters(n.audience)), publishToSite: n.publishToSite, slug } });
    return { recipients, subject: n.subject };
  });
  const needsReview = s.role !== 'owner';
  const notified = await notifyNewsletterRequested({
    requestedBy: s.email, role: s.role, id: nid, subject, note: clip(note, NOTE_MAX), recipients,
    scheduledLabel: at ? formatZoned(at) : '',
  });
  return { needsReview, notified, scheduledFor: at ? formatZoned(at) : '' };
}

const isOwn = (n, s) => n.requestedByUser === s.username || n.requestedBy === s.email;

// rescheduleSend(id, scheduleLocal): the requester or an owner changes a
// PENDING request's time ('' = send on approval). Audited.
export async function rescheduleSend(id, scheduleLocal) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  const { at } = parseSchedule(scheduleLocal);
  await withWriteTx(async (client) => {
    const row = await db.getNewsletter(client, nid);
    if (!row || row.status !== 'pending') throw new Error('Only a pending request can be rescheduled.');
    if (!isOwn(row, s) && s.role !== 'owner') throw new Error('Only the requester (or an owner) can change the time.');
    if (!(await db.reschedule(client, { id: nid, scheduledFor: at ? at.toISOString() : null }))) throw new Error('That request is no longer pending.');
    await recordChange(client, { actor: s.email, action: 'newsletter.reschedule', entityType: 'newsletter', entityId: nid, diff: { from: row.scheduledFor || null, to: at ? at.toISOString() : null } });
  });
  return at ? formatZoned(at) : '';
}

// approveSend(id, note) → { scheduled: label | '' }. "Send now" invokes the
// Lambda here; a scheduled send waits for the Lambda's minute tick.
export async function approveSend(id, note) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  const n = await withWriteTx(async (client) => {
    const row = await db.getNewsletter(client, nid);
    if (!row || row.status !== 'pending') throw new Error('That request is no longer waiting for review.');
    const own = isOwn(row, s);
    if (own && s.role !== 'owner') {
      console.warn(`[admin] ${s.email} tried to approve their own newsletter ${nid}`);
      throw new Error('You requested this send — a different admin (or an owner) has to approve it.');
    }
    if (own) console.log(`[admin] ${s.email} (owner) self-approving newsletter ${nid}`);
    if (!(await db.reviewSend(client, { id: nid, approve: true, reviewedBy: s.email, note: clip(note, NOTE_MAX) }))) {
      throw new Error('That request was just reviewed by someone else.');
    }
    await recordChange(client, { actor: s.email, action: 'newsletter.approve', entityType: 'newsletter', entityId: nid, diff: { requestedBy: row.requestedBy, recipients: row.recipients, scheduledFor: row.scheduledFor || null, selfApproved: own, note: clip(note, NOTE_MAX) } });
    return row;
  });
  if (n.scheduledFor) return { scheduled: formatZoned(n.scheduledFor) };
  await invokeSend(nid, s.email, { reopen: true });
  return { scheduled: '' };
}

async function invokeSend(nid, actor, { reopen }) {
  try {
    await new LambdaClient({ region: config.region }).send(new InvokeCommand({
      FunctionName: config.newsletterFunctionName, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ id: nid })),
    }));
    console.log(`[admin] ${actor} newsletter ${nid} send invoked`);
  } catch (err) {
    console.error(`[admin] ${actor} newsletter ${nid} invoke failed: ${err.message}`);
    await withWriteTx(async (client) => {
      // Nothing was sent. Put the row back so a reviewer can try again.
      if (reopen) await client.query(`UPDATE newsletters SET status = 'pending', reviewed_by = NULL, review_note = NULL, reviewed_at = NULL WHERE id = $1 AND status = 'approved'`, [nid]);
      else await client.query(`UPDATE newsletters SET status = 'failed' WHERE id = $1 AND status = 'approved'`, [nid]);
      await recordChange(client, { actor, action: 'newsletter.invoke_failed', entityType: 'newsletter', entityId: nid, diff: { error: err.message } });
    });
    throw new Error(`The send did not start (${err.name || 'error'}). ${reopen ? 'The request is still pending — try again in a minute.' : 'Try again in a minute.'}`);
  }
}

export async function declineSend(id, note) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  if (!clip(note, NOTE_MAX)) throw new Error('A decline needs a note so the writer knows what to change.');
  await withWriteTx(async (client) => {
    const row = await db.getNewsletter(client, nid);
    if (!row || row.status !== 'pending') throw new Error('That request is no longer waiting for review.');
    if (isOwn(row, s)) throw new Error('You requested this send — withdraw it instead.');
    if (!(await db.reviewSend(client, { id: nid, approve: false, reviewedBy: s.email, note: clip(note, NOTE_MAX) }))) throw new Error('That request was just reviewed by someone else.');
    await recordChange(client, { actor: s.email, action: 'newsletter.decline', entityType: 'newsletter', entityId: nid, diff: { requestedBy: row.requestedBy, note: clip(note, NOTE_MAX) } });
  });
}

export async function withdrawSend(id) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  await withWriteTx(async (client) => {
    const row = await db.getNewsletter(client, nid);
    if (!row || row.status !== 'pending') throw new Error('That request is no longer waiting for review.');
    const mine = isOwn(row, s);
    if (!mine && s.role !== 'owner') throw new Error('Only the requester (or an owner) can withdraw a request.');
    if (!(await db.reviewSend(client, { id: nid, approve: false, reviewedBy: s.email, note: mine ? 'withdrawn' : 'withdrawn by owner' }))) throw new Error('That request was just reviewed by someone else.');
    await recordChange(client, { actor: s.email, action: 'newsletter.withdraw', entityType: 'newsletter', entityId: nid, diff: { requestedBy: row.requestedBy } });
  });
}

// cancelSend(id): an approved, scheduled send that has not started goes back
// to draft. Any editor+ — the Lambda's claim is the race guard (a send that
// has already started cannot be cancelled; it finishes).
export async function cancelSend(id) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  await withWriteTx(async (client) => {
    if (!(await db.cancelScheduled(client, { id: nid, by: s.email, note: 'cancelled before sending' }))) {
      throw new Error('Too late to cancel — the send is not scheduled any more (it may already be going out).');
    }
    await recordChange(client, { actor: s.email, action: 'newsletter.cancel', entityType: 'newsletter', entityId: nid });
  });
}

export async function retrySend(id) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  await withWriteTx(async (client) => {
    if (!(await db.retryFailed(client, { id: nid }))) throw new Error('Only a failed send can be retried.');
    await recordChange(client, { actor: s.email, action: 'newsletter.retry', entityType: 'newsletter', entityId: nid });
  });
  await invokeSend(nid, s.email, { reopen: false });
}

// sendTest(id, { all }) → the addresses mailed. Renders the CURRENT draft (or
// the frozen body of a request — same bytes) to the signed-in admin only,
// or to all four admins (all: true), through the admin's own SES permission.
// The unsubscribe link points at the editor.
export async function sendTest(id, { all = false } = {}) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  const n = await withDb((client) => db.getNewsletter(client, nid));
  if (!n) throw new Error('This newsletter no longer exists.');
  if (!n.subject.trim()) throw new Error('Give the email a subject line first.');
  const to = all ? [...new Set([s.email, ...PUBLISH_REVIEWERS])] : [s.email];
  const { html, text } = renderFrozen(n, n.slug || archiveSlug(n.subject));
  const link = `${config.appOrigin}/mail/${nid}`;
  const client = new SESv2Client({ region: config.region, requestHandler: { requestTimeout: 8000 } });
  try {
    const res = await client.send(new SendEmailCommand({
      FromEmailAddress: fromHeader(n.fromName),
      Destination: { ToAddresses: to },
      ...(config.envName === 'prod' ? { ConfigurationSetName: 'ucc-prod' } : {}),
      Content: { Simple: {
        Subject: { Data: `TEST: ${n.subject}`, Charset: 'UTF-8' },
        Body: { Html: { Data: html.replaceAll(UNSUBSCRIBE_TOKEN, link), Charset: 'UTF-8' }, Text: { Data: text.replaceAll(UNSUBSCRIBE_TOKEN, link), Charset: 'UTF-8' } },
      } },
    }));
    console.log(`[admin] newsletter ${nid} test sent ${res.MessageId} to ${to.length}`);
  } catch (err) {
    console.error(`[admin] newsletter ${nid} test SES error: ${err?.name} ${err?.message}`);
    throw new Error(`The test email could not be sent (${err?.name || 'error'}).`);
  }
  await withWriteTx((client) => recordChange(client, { actor: s.email, action: 'newsletter.test', entityType: 'newsletter', entityId: nid, diff: { to: to.length } }));
  return to;
}

// deliveryLedger(id) → rows for the owner view / CSV (audited by the caller).
export async function deliveryLedger(id) {
  await requireRole('owner');
  return withDb((client) => db.deliveriesFor(client, assertId(id)));
}

export async function deleteNewsletter(id) {
  const s = await requireRole('owner');
  const nid = assertId(id);
  await withWriteTx(async (client) => {
    const row = await db.getNewsletter(client, nid);
    if (!row) throw new Error('Already deleted.');
    if (!(await db.deleteNewsletter(client, nid))) throw new Error('A newsletter that is pending, approved or sending cannot be deleted.');
    await recordChange(client, { actor: s.email, action: 'newsletter.delete', entityType: 'newsletter', entityId: nid, diff: { subject: row.subject, status: row.status } });
  });
}
