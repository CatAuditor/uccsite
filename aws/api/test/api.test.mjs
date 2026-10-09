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

test('subscribe dispatches the welcome-email job (not inline)', async () => {
  const db = fakeDb();
  const invocations = [];
  const res = await routes.subscribe({
    ...baseCtx(db, { body: { email: 'a@b.co', firstName: 'Q' } }),
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
    selfInvoke: async () => { throw new Error('throttled'); },
  });
  assert.equal(res.statusCode, 200);
});

test('portal POST still 202s if the self-invoke fails (constant response)', async () => {
  const db = fakeDb();
  const res = await routes.createPortalSessionPost({
    ...baseCtx(db, { body: { email: 'a@b.co' } }),
    secrets: { TOKEN_SECRET: SECRET },
    selfInvoke: async () => { throw new Error('throttled'); },
  });
  assert.equal(res.statusCode, 202);
});

// ── SES send path ───────────────────────────────────────────────────────────

function fakeSes(behavior = async () => ({ MessageId: 'msg-1' })) {
  const sent = [];
  routes._setSesClient({ async send(cmd) { sent.push(cmd.input); return behavior(cmd.input); } });
  return sent;
}

test('welcome-email job sends one SES message from hello@ with one-click unsubscribe headers', async () => {
  const sent = fakeSes();
  process.env.SES_CONFIGURATION_SET = 'ucc-test';
  try {
    await routes.welcomeEmailJob({ secrets: { TOKEN_SECRET: SECRET }, email: 'a@b.co', firstName: 'Q', origin: 'https://x.test' });
  } finally { delete process.env.SES_CONFIGURATION_SET; routes._setSesClient(null); }
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.FromEmailAddress, 'Utah Civic Compact <hello@utahciviccompact.org>');
  assert.deepEqual(m.Destination.ToAddresses, ['a@b.co']);
  assert.equal(m.ConfigurationSetName, 'ucc-test');
  assert.match(m.Content.Simple.Body.Html.Data, /Hi Q,/);
  const headers = Object.fromEntries(m.Content.Simple.Headers.map(h => [h.Name, h.Value]));
  assert.match(headers['List-Unsubscribe'], /^<https:\/\/x\.test\/api\/unsubscribe\?token=/);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('SES failure is logged by error class, never the recipient, and never throws', async () => {
  fakeSes(async () => { const e = new Error('Email address is not verified. a@b.co'); e.name = 'MessageRejected'; throw e; });
  try {
    const { lines } = await spyConsole(() => routes.portalLinkJob({
      db: fakeDb({ 'SELECT stripe_customer_id': { rows: [{ stripe_customer_id: 'cus_1' }], rowCount: 1 } }),
      secrets: { TOKEN_SECRET: SECRET }, email: 'a@b.co', origin: 'https://x.test',
    }));
    assert.ok(lines.some(l => l.includes('SES error: MessageRejected')));
  } finally { routes._setSesClient(null); }
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

test('unsubscribe: GET only shows the button (scanners prefetch links); POST soft-unsubscribes; bad token 400', async () => {
  const db = fakeDb();
  const secrets = { TOKEN_SECRET: SECRET };
  const token = await cfSign(SECRET, 'unsubscribe', 'gone@x.y', 3600); // signed by the OLD stack
  let res = await routes.unsubscribe({ event: httpEvent({ method: 'GET', query: { token } }), db, secrets });
  assert.equal(res.statusCode, 200);
  assert.equal(db.calls.length, 0);
  assert.ok(res.body.includes(`<form method="post" action="/api/unsubscribe?token=${encodeURIComponent(token)}">`));
  assert.ok(res.body.includes('gone@x.y'));

  // RFC 8058 one-click: what Gmail/Yahoo POST, body List-Unsubscribe=One-Click.
  res = await routes.unsubscribe({ event: { ...httpEvent({ method: 'POST', query: { token } }), body: 'List-Unsubscribe=One-Click' }, db, secrets });
  assert.equal(res.statusCode, 200);
  assert.ok(db.calls.some(c => c.text.startsWith('UPDATE subscribers SET unsubscribed_at') && c.text.includes("'self'") && c.params[0] === 'gone@x.y'));
  assert.ok(db.calls.some(c => c.text.includes('UPDATE members SET newsletter_opt_in = 0')));

  for (const method of ['GET', 'POST']) {
    res = await routes.unsubscribe({ event: httpEvent({ method, query: { token: 'junk' } }), db, secrets });
    assert.equal(res.statusCode, 400);
  }
});

test('welcome email without TOKEN_SECRET carries no one-click headers', async () => {
  const sent = fakeSes();
  try {
    await routes.welcomeEmailJob({ secrets: {}, email: 'a@b.co', origin: 'https://x.test' });
  } finally { routes._setSesClient(null); }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].Content.Simple.Headers, undefined);
});

test('portal POST 503s without secrets; with secrets always 202 + constant self-invoke', async () => {
  const db = fakeDb();
  let res = await routes.createPortalSessionPost(baseCtx(db, { body: { email: 'a@b.co' } }));
  assert.equal(res.statusCode, 503);
  const invocations = [];
  res = await routes.createPortalSessionPost({
    ...baseCtx(db, { body: { email: 'a@b.co' } }),
    secrets: { TOKEN_SECRET: SECRET },
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

// ── Petition ────────────────────────────────────────────────────────────────

const signer = { petition: 'udot-alpr-permits', firstName: 'Ada', lastName: 'Lovelace', email: 'Ada@Example.org', zip: '84101' };

test('petition: valid signature upserts the signature AND the subscriber (lowercased email)', async () => {
  const db = fakeDb();
  const res = await routes.petitionSign(baseCtx(db, { body: { ...signer, address: '1 Main St', phone: '' } }));
  assert.equal(res.statusCode, 200);
  const sig = db.calls.find(c => c.text.includes('INSERT INTO petition_signatures'));
  assert.deepEqual(sig.params, ['udot-alpr-permits', 'Ada', 'Lovelace', 'ada@example.org', '84101', '1 Main St', null]);
  assert.match(sig.text, /ON CONFLICT \(petition, email\) DO UPDATE/);
  const sub = db.calls.find(c => c.text.includes('INSERT INTO subscribers'));
  assert.equal(sub.params[0], 'ada@example.org');
  assert.match(sub.text, /COALESCE\(subscribers\.first_name, excluded\.first_name\)/); // never clobbers join-form details
});

test('petition: required fields and slug pattern are enforced before any write', async () => {
  for (const bad of [
    { ...signer, petition: 'Not A Slug!' },
    { ...signer, firstName: '' },
    { ...signer, lastName: '' },
    { ...signer, zip: '8410' },
    { ...signer, zip: 'abcde' },
    { ...signer, email: 'nope' },
  ]) {
    const db = fakeDb();
    const res = await routes.petitionSign(baseCtx(db, { body: bad }));
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
    assert.ok(!db.calls.some(c => c.text.startsWith('INSERT INTO petition_signatures')));
  }
  const db = fakeDb();
  assert.equal((await routes.petitionSign(baseCtx(db, { body: undefined }))).statusCode, 400);
});

test('petition: ZIP+4 accepted; insert failure 500s with the error name only', async () => {
  let db = fakeDb();
  assert.equal((await routes.petitionSign(baseCtx(db, { body: { ...signer, zip: '84101-1234' } }))).statusCode, 200);
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    db = fakeDb({ 'INSERT INTO petition_signatures': () => { const e = new Error('duplicate key value ada@example.org'); e.name = 'error'; throw e; } });
    const res = await routes.petitionSign(baseCtx(db, { body: signer }));
    assert.equal(res.statusCode, 500);
  } finally { console.error = orig; }
  assert.ok(logged.some(l => l.includes('petition insert failed: error')));
  assert.ok(!logged.some(l => l.includes('ada@example.org')));
});

test('checkout carries an optional sanitized source into Stripe metadata', async () => {
  const db = fakeDb();
  let captured;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = String(init.body);
    return { ok: true, status: 200, json: async () => ({ url: 'https://stripe.test/cs' }) };
  };
  try {
    const res = await routes.createCheckoutSession({
      ...baseCtx(db, { body: { type: 'onetime', amountCents: 2500, source: 'petition:udot alpr<script>' } }),
      secrets: { STRIPE_SECRET_KEY: 'sk_test' },
    });
    assert.equal(res.statusCode, 200);
  } finally { globalThis.fetch = origFetch; }
  assert.match(captured, /metadata%5Bsource%5D=petition%3Audotalprscript/);
});

test('petition count: Utah-only SQL, cached per slug until a Utah signature lands, bad slug 400', async () => {
  let n = 0;
  const db = fakeDb({ 'SELECT count(*)::int AS n FROM petition_signatures': () => ({ rows: [{ n: ++n * 7 }], rowCount: 1 }) });
  const ev = (slug) => ({ ...httpEvent({ method: 'GET', path: '/api/petition/count' }), queryStringParameters: { petition: slug } });
  let res = await routes.petitionCount({ event: ev('count-test-a'), db });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { petition: 'count-test-a', count: 7 });
  assert.equal(res.headers['Cache-Control'], 'no-store', 'never browser-cached — freshness is event-driven');
  const q = db.calls.find(c => c.text.includes('FROM petition_signatures'));
  assert.match(q.text, /zip LIKE '84%'/);
  assert.deepEqual(q.params, ['count-test-a']);
  res = await routes.petitionCount({ event: ev('count-test-a'), db });
  assert.equal(JSON.parse(res.body).count, 7, 'second call served from cache');
  // An out-of-state signature leaves the cache alone; a Utah one clears it.
  await routes.petitionSign(baseCtx(db, { body: { ...signer, petition: 'count-test-a', zip: '94101', email: 'o@x.co' } }));
  res = await routes.petitionCount({ event: ev('count-test-a'), db });
  assert.equal(JSON.parse(res.body).count, 7, 'outside-Utah signature does not invalidate');
  await routes.petitionSign(baseCtx(db, { body: { ...signer, petition: 'count-test-a', zip: '84321', email: 'u@x.co' } }));
  res = await routes.petitionCount({ event: ev('count-test-a'), db });
  assert.equal(JSON.parse(res.body).count, 14, 'Utah signature invalidates → recount');
  res = await routes.petitionCount({ event: ev('count-test-b'), db });
  assert.equal(JSON.parse(res.body).count, 21, 'different slug queries again');
  res = await routes.petitionCount({ event: ev('Nope!'), db });
  assert.equal(res.statusCode, 400);
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

// ── Double opt-in (docs/systems/newsletters.md "Confirmed subscribers") ────
test('confirm: a valid confirm token sets confirmed_at once; bad/expired tokens 400', async () => {
  const db = fakeDb();
  const token = await lib.signToken(SECRET, 'confirm', 'a@b.co', 3600);
  let res = await routes.confirmSubscription({ event: httpEvent({ method: 'GET', path: '/api/confirm', query: { token } }), db, secrets: { TOKEN_SECRET: SECRET } });
  assert.equal(res.statusCode, 200);
  const upd = db.calls.find(c => c.text.includes('UPDATE subscribers SET confirmed_at = COALESCE(confirmed_at, now())'));
  assert.deepEqual(upd.params, ['a@b.co']);
  assert.ok(res.body.includes('Confirmed'));
  // an UNSUBSCRIBE token must not confirm (purpose is checked)
  const wrong = await lib.signToken(SECRET, 'unsubscribe', 'a@b.co', 3600);
  res = await routes.confirmSubscription({ event: httpEvent({ method: 'GET', path: '/api/confirm', query: { token: wrong } }), db, secrets: { TOKEN_SECRET: SECRET } });
  assert.equal(res.statusCode, 400);
  res = await routes.confirmSubscription({ event: httpEvent({ method: 'GET', path: '/api/confirm', query: { token: 'garbage' } }), db, secrets: { TOKEN_SECRET: SECRET } });
  assert.equal(res.statusCode, 400);
});

test('petition signers are confirmed at insert; join-form signups are not', async () => {
  const db = fakeDb();
  await routes.petitionSign(baseCtx(db, { body: { petition: 'udot-alpr-permits', firstName: 'A', lastName: 'B', email: 'a@b.co', zip: '84101' } }));
  const sub = db.calls.find(c => c.text.includes('INSERT INTO subscribers'));
  assert.ok(sub.text.includes('confirmed_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())'));
  assert.ok(sub.text.includes('confirmed_at = COALESCE(subscribers.confirmed_at, now())'));
  const db2 = fakeDb();
  await routes.subscribe(baseCtx(db2, { body: { email: 'a@b.co' } }));
  const join = db2.calls.find(c => c.text.includes('INSERT INTO subscribers'));
  assert.ok(!join.text.includes('confirmed_at'));
});

test('open pixel: one anonymous row per hit, gif either way, bad ids ignored', async () => {
  const db = fakeDb();
  const id = '11111111-2222-3333-4444-555555555555';
  let res = await routes.newsletterOpen({ event: httpEvent({ method: 'GET', path: '/api/open', query: { c: id } }), db });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/gif');
  assert.equal(res.isBase64Encoded, true);
  const ins = db.calls.find(c => c.text.includes('INSERT INTO newsletter_opens'));
  assert.deepEqual(ins.params, [id]);
  assert.equal(ins.text.includes('ip'), false);
  res = await routes.newsletterOpen({ event: httpEvent({ method: 'GET', path: '/api/open', query: { c: "x' OR 1=1" } }), db });
  assert.equal(res.statusCode, 200);
  assert.equal(db.calls.filter(c => c.text.includes('INSERT INTO newsletter_opens')).length, 1);
});

test('subscribe CORS: preflight 204 + allow-origin only for the officials lookup origin', async () => {
  const LOOKUP = 'https://lookup.utahciviccompact.org';
  const pre = lib.withLookupCors(httpEvent({ method: 'OPTIONS', headers: { origin: LOOKUP } }), routes.subscribePreflight());
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['Access-Control-Allow-Origin'], LOOKUP);
  assert.equal(pre.headers['Access-Control-Allow-Methods'], 'POST');
  assert.equal(pre.headers['Access-Control-Allow-Headers'], 'Content-Type');
  assert.equal(pre.headers['Access-Control-Max-Age'], '86400');
  assert.equal(pre.headers.Vary, 'Origin');

  const ok = lib.withLookupCors(httpEvent({ headers: { origin: LOOKUP } }), lib.json({ ok: true }));
  assert.equal(ok.headers['Access-Control-Allow-Origin'], LOOKUP);
  assert.equal(ok.headers['Content-Type'], 'application/json');

  for (const origin of [undefined, 'https://evil.example', 'https://utahciviccompact.org']) {
    const res = lib.withLookupCors(httpEvent({ headers: { origin } }), lib.json({ ok: true }));
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(res.headers.Vary, 'Origin');
  }
});
