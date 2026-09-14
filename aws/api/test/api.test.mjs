// Phase 5 port tests. The critical property: BYTE COMPATIBILITY with the
// Cloudflare implementation — tokens signed by functions/api/_lib.js (the
// live stack) must verify in aws/api/lib.js and vice versa, under the SAME
// TOKEN_SECRET. The webhook signature verifier is tested against vectors
// signed the way Stripe signs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
// The ORIGINAL Cloudflare implementation (ESM) — ground truth for tokens.
import { signToken as cfSign, verifyToken as cfVerify } from '../../../functions/api/_lib.js';

const require = createRequire(import.meta.url);
const lib = require('../lib.js');
const { handleWebhook, verifyStripeSignature } = require('../webhook.js');
const routes = require('../routes.js');

const SECRET = 'test-token-secret-carried-over-unchanged';

// ── Token byte-compatibility ────────────────────────────────────────────────

test('token signed by the Cloudflare lib verifies in the Lambda lib', async () => {
  const token = await cfSign(SECRET, 'unsubscribe', 'a@b.co', 3600);
  assert.equal(await lib.verifyToken(SECRET, 'unsubscribe', token), 'a@b.co');
});

test('token signed by the Lambda lib verifies in the Cloudflare lib', async () => {
  const token = await lib.signToken(SECRET, 'portal', 'x@y.z', 900);
  assert.equal(await cfVerify(SECRET, 'portal', token), 'x@y.z');
});

test('purpose binding and expiry still enforced', async () => {
  const token = await lib.signToken(SECRET, 'unsubscribe', 'a@b.co', 3600);
  assert.equal(await lib.verifyToken(SECRET, 'portal', token), null);
  const expired = await lib.signToken(SECRET, 'unsubscribe', 'a@b.co', -10);
  assert.equal(await lib.verifyToken(SECRET, 'unsubscribe', expired), null);
  assert.equal(await lib.verifyToken('wrong-secret', 'unsubscribe', token), null);
});

// ── Stripe webhook signature verification ───────────────────────────────────

const WH_SECRET = 'whsec_testsecret';
function stripeSig(payload, { secret = WH_SECRET, ts = Math.floor(Date.now() / 1000), extraV1 } = {}) {
  const mac = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  let header = `t=${ts},v1=${mac}`;
  if (extraV1) header = `t=${ts},v1=${extraV1},v1=${mac}`;
  return header;
}

test('valid signature verifies and parses', async () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'ping' });
  const event = await verifyStripeSignature(payload, stripeSig(payload), WH_SECRET);
  assert.equal(event.id, 'evt_1');
});

test('rotation: any matching v1 among several passes', async () => {
  const payload = JSON.stringify({ id: 'evt_2' });
  const header = stripeSig(payload, { extraV1: 'deadbeef'.repeat(8) });
  const event = await verifyStripeSignature(payload, header, WH_SECRET);
  assert.equal(event.id, 'evt_2');
});

test('wrong secret, tampered payload, stale and future timestamps all fail', async () => {
  const payload = JSON.stringify({ id: 'evt_3' });
  await assert.rejects(() => verifyStripeSignature(payload, stripeSig(payload, { secret: 'whsec_other' }), WH_SECRET));
  await assert.rejects(() => verifyStripeSignature(payload + ' ', stripeSig(payload), WH_SECRET));
  await assert.rejects(() => verifyStripeSignature(payload, stripeSig(payload, { ts: Math.floor(Date.now() / 1000) - 400 }), WH_SECRET));
  await assert.rejects(() => verifyStripeSignature(payload, stripeSig(payload, { ts: Math.floor(Date.now() / 1000) + 400 }), WH_SECRET));
  await assert.rejects(() => verifyStripeSignature(payload, 'garbage', WH_SECRET));
});

// ── Fake db ─────────────────────────────────────────────────────────────────

function fakeDb(script = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: text.replace(/\s+/g, ' ').trim(), params });
      for (const [pattern, result] of Object.entries(script)) {
        if (text.includes(pattern)) return typeof result === 'function' ? result(params) : result;
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const httpEvent = (overrides = {}) => ({
  headers: { 'x-forwarded-for': 'spoofed, 203.0.113.9', ...(overrides.headers || {}) },
  requestContext: { http: { method: overrides.method || 'POST', path: overrides.path || '/api/subscribe' } },
  queryStringParameters: overrides.query,
});

// ── Webhook flow with fake db ───────────────────────────────────────────────

test('duplicate event short-circuits via ON CONFLICT rowCount 0', async () => {
  const payload = JSON.stringify({ id: 'evt_dup', type: 'invoice.paid', data: { object: {} } });
  const db = fakeDb({ 'INSERT INTO processed_events': { rows: [], rowCount: 0 } });
  const res = await handleWebhook({
    event: { headers: { 'stripe-signature': stripeSig(payload) } },
    db, secrets: { STRIPE_WEBHOOK_SECRET: WH_SECRET }, rawBody: payload,
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /duplicate/);
  assert.equal(db.calls.length, 1); // no handler ran
});

test('handler error deletes the processed_events row and returns 500', async () => {
  const payload = JSON.stringify({ id: 'evt_err', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  const db = fakeDb({
    'INSERT INTO processed_events': { rows: [{ id: 'evt_err' }], rowCount: 1 },
    'UPDATE subscriptions': () => { throw new Error('db down'); },
  });
  const res = await handleWebhook({
    event: { headers: { 'stripe-signature': stripeSig(payload) } },
    db, secrets: { STRIPE_WEBHOOK_SECRET: WH_SECRET }, rawBody: payload,
  });
  assert.equal(res.statusCode, 500);
  assert.ok(db.calls.some(c => c.text.startsWith('DELETE FROM processed_events')));
});

test('bad signature is 401 and touches nothing', async () => {
  const db = fakeDb();
  const res = await handleWebhook({
    event: { headers: { 'stripe-signature': 'garbage' } },
    db, secrets: { STRIPE_WEBHOOK_SECRET: WH_SECRET }, rawBody: '{}',
  });
  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.length, 0);
});

test('checkout.session.completed records member + donation (old shape)', async () => {
  const session = {
    id: 'cs_1', mode: 'payment', customer: 'cus_9', payment_intent: 'pi_9',
    amount_total: 5000, customer_details: { email: 'd@e.f' },
    metadata: { firstName: 'A', publicDonor: '0', newsletterOptIn: '1' },
  };
  const payload = JSON.stringify({ id: 'evt_c', type: 'checkout.session.completed', data: { object: session } });
  const db = fakeDb({
    'INSERT INTO processed_events': { rows: [{}], rowCount: 1 },
    'SELECT id FROM members': { rows: [{ id: 'uuid-1' }], rowCount: 1 },
  });
  const res = await handleWebhook({
    event: { headers: { 'stripe-signature': stripeSig(payload) } },
    db, secrets: { STRIPE_WEBHOOK_SECRET: WH_SECRET }, rawBody: payload,
  });
  assert.equal(res.statusCode, 200);
  const donation = db.calls.find(c => c.text.includes('INSERT INTO donations'));
  assert.deepEqual(donation.params, ['uuid-1', 'pi_9', 5000, 0]); // publicDonor '0' honored
});

test('invoice.paid handles the NEW parent shape too', async () => {
  const invoice = {
    customer: 'cus_9', amount_paid: 700,
    parent: { subscription_details: { subscription: 'sub_5', metadata: { publicDonor: '1' } } },
    payments: { data: [{ payment: { payment_intent: 'pi_new' } }] },
  };
  const payload = JSON.stringify({ id: 'evt_i', type: 'invoice.paid', data: { object: invoice } });
  const db = fakeDb({
    'INSERT INTO processed_events': { rows: [{}], rowCount: 1 },
    'SELECT id FROM members': { rows: [{ id: 'uuid-2' }], rowCount: 1 },
  });
  const res = await handleWebhook({
    event: { headers: { 'stripe-signature': stripeSig(payload) } },
    db, secrets: { STRIPE_WEBHOOK_SECRET: WH_SECRET }, rawBody: payload,
  });
  assert.equal(res.statusCode, 200);
  const donation = db.calls.find(c => c.text.includes('INSERT INTO donations'));
  assert.deepEqual(donation.params, ['uuid-2', 'pi_new', 700, 1]);
  const subUpdate = db.calls.find(c => c.text.includes('UPDATE subscriptions'));
  assert.equal(subUpdate.params[0], 'sub_5');
});

// ── Routes with fake db ─────────────────────────────────────────────────────

const baseCtx = (db, extra = {}) => ({
  event: httpEvent(extra), db, secrets: {}, origin: 'https://staging.example', ...extra,
});

test('subscribe: invalid email 400; valid upserts with lowercased email', async () => {
  const db = fakeDb();
  let res = await routes.subscribe(baseCtx(db, { body: { email: 'nope' } }));
  assert.equal(res.statusCode, 400);
  res = await routes.subscribe(baseCtx(db, { body: { email: 'A@B.co', firstName: 'Q' } }));
  assert.equal(res.statusCode, 200);
  const upsert = db.calls.find(c => c.text.includes('INSERT INTO subscribers'));
  assert.equal(upsert.params[0], 'a@b.co');
});

test('subscribe dispatches the welcome-email job (not inline) when Resend is configured', async () => {
  const db = fakeDb();
  const invocations = [];
  const res = await routes.subscribe({
    ...baseCtx(db, { body: { email: 'a@b.co', firstName: 'Q' } }),
    secrets: { RESEND_API_KEY: 'k' },
    selfInvoke: async (p) => invocations.push(p),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].job, 'welcome-email');
  assert.equal(invocations[0].email, 'a@b.co');
});

test('subscribe still 200s if the welcome-email dispatch fails', async () => {
  const db = fakeDb();
  const res = await routes.subscribe({
    ...baseCtx(db, { body: { email: 'a@b.co' } }),
    secrets: { RESEND_API_KEY: 'k' },
    selfInvoke: async () => { throw new Error('throttled'); },
  });
  assert.equal(res.statusCode, 200);
});

test('portal POST still 202s if the self-invoke fails (constant response)', async () => {
  const db = fakeDb();
  const res = await routes.createPortalSessionPost({
    ...baseCtx(db, { body: { email: 'a@b.co' } }),
    secrets: { TOKEN_SECRET: SECRET, RESEND_API_KEY: 'k' },
    selfInvoke: async () => { throw new Error('throttled'); },
  });
  assert.equal(res.statusCode, 202);
});

test('rate limit trips at the threshold with a 429', async () => {
  const db = fakeDb({ 'SELECT COUNT(*)': { rows: [{ count: 5 }], rowCount: 1 } });
  const res = await routes.subscribe(baseCtx(db, { body: { email: 'a@b.co' } }));
  assert.equal(res.statusCode, 429);
});

test('rate limiter fails OPEN on db error (by design)', async () => {
  const db = {
    async query(text) {
      if (text.includes('rate_limits')) throw new Error('db down');
      return { rows: [], rowCount: 1 };
    },
  };
  const res = await routes.subscribe({ ...baseCtx(db), db, body: { email: 'a@b.co' } });
  assert.equal(res.statusCode, 200); // request allowed through
});

test('rate limiter identity is the LAST X-Forwarded-For entry', async () => {
  const db = fakeDb();
  await routes.subscribe(baseCtx(db, { body: { email: 'a@b.co' } }));
  const insert = db.calls.find(c => c.text.includes('INSERT INTO rate_limits'));
  assert.equal(insert.params[0], '203.0.113.9'); // not the spoofed first entry
});

test('unsubscribe: valid token deletes subscriber and flips opt-in; bad token 400', async () => {
  const db = fakeDb();
  const secrets = { TOKEN_SECRET: SECRET };
  const token = await cfSign(SECRET, 'unsubscribe', 'gone@x.y', 3600); // signed by the OLD stack
  let res = await routes.unsubscribe({ event: httpEvent({ method: 'GET', query: { token } }), db, secrets });
  assert.equal(res.statusCode, 200);
  assert.ok(db.calls.some(c => c.text.startsWith('DELETE FROM subscribers') && c.params[0] === 'gone@x.y'));
  assert.ok(db.calls.some(c => c.text.includes('UPDATE members SET newsletter_opt_in = 0')));
  res = await routes.unsubscribe({ event: httpEvent({ method: 'GET', query: { token: 'junk' } }), db, secrets });
  assert.equal(res.statusCode, 400);
});

test('portal POST 503s without secrets; with secrets always 202 + constant self-invoke', async () => {
  const db = fakeDb();
  let res = await routes.createPortalSessionPost(baseCtx(db, { body: { email: 'a@b.co' } }));
  assert.equal(res.statusCode, 503);
  const invocations = [];
  res = await routes.createPortalSessionPost({
    ...baseCtx(db, { body: { email: 'a@b.co' } }),
    secrets: { TOKEN_SECRET: SECRET, RESEND_API_KEY: 'k' },
    selfInvoke: async (p) => invocations.push(p),
  });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(Object.keys(invocations[0]).sort(), ['email', 'job', 'origin']);
});

// ── Tipline → tips table ────────────────────────────────────────────────────

function spyConsole(fn) {
  const lines = [];
  const orig = { error: console.error, warn: console.warn, log: console.log };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  return fn().finally(() => Object.assign(console, orig)).then(r => ({ result: r, lines }));
}

test('tip inserts a row and returns 200', async () => {
  const db = fakeDb();
  const res = await routes.tip(baseCtx(db, { body: {
    name: 'Pat', email: 'Tipster@Example.org', subject_of_tip: 'ALPR', tip_summary: 'secret tip',
  } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  const ins = db.calls.find(c => c.text.startsWith('INSERT INTO tips'));
  assert.ok(ins, 'insert ran');
  assert.deepEqual(ins.params, ['Pat', 0, 'tipster@example.org', 'ALPR', 'secret tip']);
  assert.ok(ins.text.includes("'New'"));
});

test('tip: anonymous replaces the name with the literal', async () => {
  const db = fakeDb();
  await routes.tip(baseCtx(db, { body: { name: 'Pat', anonymous: true, email: 'a@b.co', tip_summary: 'x' } }));
  const ins = db.calls.find(c => c.text.startsWith('INSERT INTO tips'));
  assert.deepEqual(ins.params.slice(0, 2), ['Anonymous', 1]);
});

test('tip: invalid email / empty summary 400 without touching the table', async () => {
  const db = fakeDb();
  assert.equal((await routes.tip(baseCtx(db, { body: { email: 'nope', tip_summary: 'x' } }))).statusCode, 400);
  assert.equal((await routes.tip(baseCtx(db, { body: { email: 'a@b.co', tip_summary: '   ' } }))).statusCode, 400);
  assert.ok(!db.calls.some(c => c.text.startsWith('INSERT INTO tips')));
});

test('tip: insert failure 500s and logs the error name only — never the body', async () => {
  const err = new Error('duplicate key value violates: secret tip a@b.co');
  err.name = 'DatabaseError';
  const db = fakeDb({ 'INSERT INTO tips': () => { throw err; } });
  const { result: res, lines } = await spyConsole(() =>
    routes.tip(baseCtx(db, { body: { email: 'a@b.co', tip_summary: 'secret tip' } })));
  assert.equal(res.statusCode, 500);
  assert.ok(lines.some(l => l.includes('tip insert failed: DatabaseError')));
  for (const l of lines) {
    assert.ok(!l.includes('secret tip') && !l.includes('a@b.co'), `body leaked into log: ${l}`);
  }
});

test('stats returns recent list only — no total, no goal', async () => {
  const db = fakeDb({
    'FROM donations': { rows: [{ first_name: 'Alex', amount_cents: 5000 }, { first_name: null, amount_cents: 100 }], rowCount: 2 },
  });
  const res = await routes.donationStats({ db });
  const data = JSON.parse(res.body);
  assert.deepEqual(data, { recent: [{ firstName: 'Alex', amountCents: 5000 }, { firstName: 'Anonymous', amountCents: 100 }] });
  assert.ok(!('totalCents' in data) && !('goalCents' in data));
  assert.equal(res.headers['Cache-Control'], 'public, max-age=60');
});

test('checkout validates type and amount bounds', async () => {
  const db = fakeDb();
  for (const body of [
    { type: 'weekly', amountCents: 500 },
    { type: 'onetime', amountCents: 50 },
    { type: 'onetime', amountCents: 20_000_000 },
  ]) {
    const res = await routes.createCheckoutSession(baseCtx(db, { body }));
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});
