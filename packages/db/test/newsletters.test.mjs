import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nl = require('../newsletters.js');
const { CONTENT_ACTION_RE } = require('../publish-requests.js');

// A recording client: every query returns a canned result and is captured.
function fakeClient(results = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return results.shift() || { rows: [], rowCount: 0 }; },
  };
}

test('newsletter actions are not site content (never block or count for a site publish)', () => {
  for (const a of ['newsletter.create', 'newsletter.save', 'newsletter.request', 'newsletter.approve', 'newsletter.decline', 'newsletter.test', 'newsletter.delete']) {
    assert.equal(CONTENT_ACTION_RE.test(a), false, a);
  }
});

test('rowToNewsletter parses JSON columns defensively and includes the body only when selected', () => {
  const n = nl.rowToNewsletter({ id: 'x', status: 'draft', blocks: '[{"type":"divider"}]', theme: 'not json', audience: null, sent_count: null });
  assert.deepEqual(n.blocks, [{ type: 'divider' }]);
  assert.deepEqual(n.theme, {});
  assert.deepEqual(n.audience, {});
  assert.equal(n.sentCount, null);
  assert.equal('html' in n, false);
  assert.equal(nl.rowToNewsletter({ id: 'x', html: '<p>', text: null }).html, '<p>');
});

test('state transitions are conditional updates on the current status', async () => {
  const c = fakeClient([{ rowCount: 1 }, { rowCount: 1 }, { rowCount: 0 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }]);
  assert.equal(await nl.saveNewsletter(c, { id: 'a', subject: 's', preheader: '', headline: '', fromName: 'J', blocks: [], theme: {}, audience: {}, expectedUpdatedAt: 't1' }), true);
  assert.match(c.calls[0].sql, /WHERE id = \$1 AND status = 'draft' AND updated_at::text = \$9/);
  assert.equal(await nl.requestSend(c, { id: 'a', requestedBy: 'j@x', requestedByUser: 'j', note: 'n', scheduledFor: null, html: '<h>', text: 't', recipients: 3 }), true);
  assert.match(c.calls[1].sql, /SET status = 'pending'.*WHERE id = \$1 AND status = 'draft'/);
  assert.equal(await nl.reviewSend(c, { id: 'a', approve: true, reviewedBy: 'c@x', note: '' }), false);
  assert.match(c.calls[2].sql, /WHERE id = \$1 AND status = 'pending'/);
  assert.equal(c.calls[2].params[1], 'approved');
  await nl.reviewSend(c, { id: 'a', approve: false, reviewedBy: 'c@x', note: 'fix it' });
  assert.equal(c.calls[3].params[1], 'draft');
  assert.equal(await nl.cancelScheduled(c, { id: 'a', by: 'j@x', note: '' }), true);
  assert.match(c.calls[4].sql, /status = 'approved' AND send_started_at IS NULL/);
  assert.equal(await nl.retryFailed(c, { id: 'a' }), true);
  assert.match(c.calls[5].sql, /WHERE id = \$1 AND status = 'failed'/);
});

test('saveNewsletter stores the draft send time when given, leaves it alone when undefined', async () => {
  const base = { id: 'a', subject: 's', preheader: '', headline: '', fromName: 'J', blocks: [], theme: {}, audience: {}, expectedUpdatedAt: 't1' };
  let c = fakeClient([{ rowCount: 1 }]);
  await nl.saveNewsletter(c, { ...base, scheduledFor: '2026-10-12T15:00:00.000Z' });
  assert.match(c.calls[0].sql, /scheduled_for = CASE WHEN \$12 THEN \$13::timestamptz ELSE scheduled_for END/);
  assert.equal(c.calls[0].params[11], true); assert.equal(c.calls[0].params[12], '2026-10-12T15:00:00.000Z');
  c = fakeClient([{ rowCount: 1 }]);
  await nl.saveNewsletter(c, { ...base, scheduledFor: null });
  assert.equal(c.calls[0].params[11], true); assert.equal(c.calls[0].params[12], null, 'empty = on approval');
  c = fakeClient([{ rowCount: 1 }]);
  await nl.saveNewsletter(c, base);
  assert.equal(c.calls[0].params[11], false, 'undefined = column untouched');
});

test('saveNewsletter sets the kind when given (the "Automatic email" tick box), keeps it otherwise', async () => {
  const c = fakeClient([{ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }]);
  const base = { id: 'a', subject: 's', preheader: '', headline: '', fromName: 'J', blocks: [], theme: {}, audience: {}, expectedUpdatedAt: 't1' };
  await nl.saveNewsletter(c, { ...base, kind: 'transactional' });
  assert.match(c.calls[0].sql, /kind = COALESCE\(\$11, kind\)/);
  assert.equal(c.calls[0].params[10], 'transactional');
  await nl.saveNewsletter(c, base);
  assert.equal(c.calls[1].params[10], null);
  await nl.saveNewsletter(c, { ...base, kind: 'bogus' });
  assert.equal(c.calls[2].params[10], null);
});

test('claimForSending is the approved→sending mutex; resume widens it to sending', async () => {
  const c = fakeClient([{ rows: [{ id: 'a', status: 'sending', html: '<h>', text: 't' }] }, { rows: [] }]);
  const won = await nl.claimForSending(c, 'a');
  assert.equal(won.html, '<h>');
  assert.match(c.calls[0].sql, /status = 'approved' AND \(scheduled_for IS NULL OR scheduled_for <= now\(\)\)/);
  assert.ok(!/OR status = 'sending'/.test(c.calls[0].sql));
  assert.equal(await nl.claimForSending(c, 'a', { resume: true }), null);
  assert.match(c.calls[1].sql, /OR status = 'sending'/);
});

test('deliveries: the primary key is the idempotency key', async () => {
  const c = fakeClient([{ rowCount: 1 }, { rowCount: 0 }, { rowCount: 1 }, { rows: [{ status: 'sent', n: 2, suppressed: 0 }, { status: 'failed', n: 1, suppressed: 1 }] }]);
  assert.equal(await nl.beginDelivery(c, 'a', 'x@y'), true);
  assert.match(c.calls[0].sql, /ON CONFLICT \(newsletter_id, email\) DO UPDATE SET status = 'sending', at = now\(\) WHERE newsletter_deliveries.status = 'sending' AND newsletter_deliveries.at < now\(\) - interval '10 minutes'/);
  assert.equal(await nl.beginDelivery(c, 'a', 'x@y'), false);
  await nl.finishDelivery(c, 'a', 'x@y', { status: 'failed', error: 'e'.repeat(900) });
  assert.equal(c.calls[2].params[4].length, 500);
  assert.deepEqual(await nl.deliveryCounts(c, 'a'), { sent: 2, failed: 1, sending: 0, suppressed: 1 });
});

test('deleteNewsletter refuses in-flight rows', async () => {
  const c = fakeClient([{ rowCount: 5 }, { rowCount: 2 }, { rowCount: 0 }]);
  assert.equal(await nl.deleteNewsletter(c, 'a'), false);
  assert.match(c.calls[1].sql, /DELETE FROM newsletter_opens/);
  assert.match(c.calls[2].sql, /status NOT IN \('pending', 'approved', 'sending'\)/);
});

test('attached emails: kind in the row, triggers carry their placeholders, attach upserts per trigger, delete clears the attachment first', async () => {
  assert.equal(nl.rowToNewsletter({ id: 'x', status: 'draft', kind: 'transactional' }).kind, 'transactional');
  assert.equal(nl.rowToNewsletter({ id: 'x', status: 'draft', kind: null }).kind, 'newsletter');
  assert.deepEqual(nl.TRIGGERS.map((t) => t.key), ['petition-thanks', 'donation-thanks']);
  assert.deepEqual(nl.triggerOf('donation-thanks').required, ['receipt']);
  assert.equal(nl.triggerOf('nope'), null);
  // per-petition trigger keys (docs/systems/petition.md): the bare key is no slot
  assert.equal(nl.petitionTrigger('UDOT'), 'petition-thanks:udot');
  assert.deepEqual([nl.triggerOf('petition-thanks:udot').slug, nl.triggerOf('petition-thanks:udot').placeholders], ['udot', ['first_name', 'headline', 'project_name']]);
  assert.match(nl.triggerOf('petition-thanks:udot').label, /\(udot\)/);
  assert.equal(nl.triggerOf('petition-thanks'), null);
  assert.equal(nl.triggerOf('petition-thanks:Not A Slug'), null);
  const c = fakeClient([{ rows: [], rowCount: 1 }]);
  await nl.attachTransactional(c, { trigger: 'petition-thanks:udot', newsletterId: 'n1', subject: 'S', html: '<p>', text: 't', attachedBy: 'a@b.co' });
  assert.match(c.calls[0].sql, /INSERT INTO transactional_emails .* ON CONFLICT \(trigger\) DO UPDATE/);
  assert.deepEqual(c.calls[0].params.slice(0, 2), ['petition-thanks:udot', 'n1']);
  await assert.rejects(() => nl.attachTransactional(c, { trigger: 'petition-thanks', newsletterId: 'n1', subject: 'S', html: '<p>' }), /Unknown trigger/);
  await assert.rejects(() => nl.attachTransactional(c, { trigger: 'bogus', newsletterId: 'n1', subject: 'S', html: '<p>' }), /Unknown trigger/);
  const d = fakeClient([{ rows: [], rowCount: 0 }, { rows: [], rowCount: 0 }, { rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
  assert.equal(await nl.deleteNewsletter(d, 'n1'), true);
  assert.match(d.calls[3].sql, /DELETE FROM transactional_emails WHERE newsletter_id/);
  const e = fakeClient([{ rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }]);
  assert.equal(await nl.deleteNewsletter(e, 'n2'), false);
  assert.equal(e.calls.length, 3); // an in-flight row keeps its attachment (none exists for newsletters anyway)
  assert.equal(CONTENT_ACTION_RE.test('newsletter.attach'), false);
});

test('authorReplyTo: the org mailbox of the named team member; nothing for a blank name, a missing card or an outside address', async () => {
  const { authorReplyTo } = require('../newsletters.js');
  assert.equal(await authorReplyTo(fakeClient(), ''), null);
  const c = fakeClient([{ rows: [{ email: 'Jarom@UtahCivicCompact.org' }] }]);
  assert.equal(await authorReplyTo(c, 'Jarom Gillins'), 'jarom@utahciviccompact.org');
  assert.deepEqual(c.calls[0].params, ['Jarom Gillins']);
  assert.equal(await authorReplyTo(fakeClient([{ rows: [] }]), 'Nobody'), null);
  assert.equal(await authorReplyTo(fakeClient([{ rows: [{ email: 'someone@gmail.com' }] }]), 'Jarom Gillins'), null);
});
