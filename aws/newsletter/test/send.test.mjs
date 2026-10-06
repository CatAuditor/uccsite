import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sendNewsletter, buildMessage, unsubscribeUrl, RESERVE_MS } = require('../send.js');
const { verifyToken } = require('@uccsite/tokens');

const newsletter = { id: '11111111-1111-1111-1111-111111111111', subject: 'Hi', html: '<a href="{{unsubscribe_url}}">u</a>', text: 'u: {{unsubscribe_url}}' };

// Fake DSQL client that honours the delivery primary key.
function fakeDb(existing = new Set()) {
  const rows = new Map(existing.size ? [...existing].map((e) => [e, { status: 'sent' }]) : []);
  return {
    rows,
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO newsletter_deliveries')) {
        const key = params[1];
        if (rows.has(key)) return { rowCount: 0 };
        rows.set(key, { status: 'sending' });
        return { rowCount: 1 };
      }
      if (sql.includes('UPDATE newsletter_deliveries')) { rows.set(params[1], { status: params[2], messageId: params[3], error: params[4] }); return { rowCount: 1 }; }
      throw new Error(`unexpected sql ${sql}`);
    },
  };
}

const base = (client, send, extra = {}) => ({
  client, send, newsletter, secret: 's3cret', origin: 'https://staging.example', from: '"J from UCC" <hello@utahciviccompact.org>',
  configurationSet: 'ucc-prod', timeLeftMs: () => 10 * 60 * 1000, gapMs: 0, ...extra,
});

test('sends once per recipient with a signed per-recipient unsubscribe link in body, text and headers', async () => {
  const db = fakeDb();
  const sent = [];
  const r = await sendNewsletter(base(db, async (input) => { sent.push(input); return { MessageId: `m${sent.length}` }; }, { recipients: ['a@x.y', 'b@x.y'] }));
  assert.deepEqual(r, { sent: 2, failed: 0, skipped: 0, done: true });
  assert.equal(sent.length, 2);
  const first = sent[0];
  assert.equal(first.FromEmailAddress, '"J from UCC" <hello@utahciviccompact.org>');
  assert.deepEqual(first.Destination.ToAddresses, ['a@x.y']);
  assert.equal(first.ConfigurationSetName, 'ucc-prod');
  const href = /href="([^"]+)"/.exec(first.Content.Simple.Body.Html.Data)[1];
  assert.ok(href.startsWith('https://staging.example/api/unsubscribe?token='));
  const token = decodeURIComponent(href.split('token=')[1]);
  assert.equal(await verifyToken('s3cret', 'unsubscribe', token), 'a@x.y');
  assert.ok(first.Content.Simple.Body.Text.Data.includes(href));
  assert.equal(first.Content.Simple.Headers[0].Value, `<${href}>`);
  assert.equal(first.Content.Simple.Headers[1].Value, 'List-Unsubscribe=One-Click');
  assert.ok(!first.Content.Simple.Body.Html.Data.includes('{{unsubscribe_url}}'));
  assert.equal(db.rows.get('b@x.y').messageId, 'm2');
  // the second recipient got a DIFFERENT token
  assert.notEqual(/href="([^"]+)"/.exec(sent[1].Content.Simple.Body.Html.Data)[1], href);
});

test('a resume skips recipients already attempted and records failures without stopping', async () => {
  const db = fakeDb(new Set(['a@x.y']));
  const r = await sendNewsletter(base(db, async (input) => {
    if (input.Destination.ToAddresses[0] === 'c@x.y') { const e = new Error('Email address is not verified'); e.name = 'MessageRejected'; throw e; }
    return { MessageId: 'ok' };
  }, { recipients: ['a@x.y', 'b@x.y', 'c@x.y'], log: () => {} }));
  assert.deepEqual(r, { sent: 1, failed: 1, skipped: 1, done: true });
  assert.equal(db.rows.get('c@x.y').status, 'failed');
  assert.match(db.rows.get('c@x.y').error, /MessageRejected: Email address is not verified/);
});

test('hands over before the Lambda runs out of time', async () => {
  const db = fakeDb();
  let calls = 0;
  const r = await sendNewsletter(base(db, async () => ({ MessageId: 'ok' }), {
    recipients: ['a@x.y', 'b@x.y', 'c@x.y'],
    timeLeftMs: () => (++calls > 2 ? RESERVE_MS - 1 : RESERVE_MS + 1000), log: () => {},
  }));
  assert.deepEqual(r, { sent: 2, failed: 0, skipped: 0, done: false });
  assert.equal(db.rows.has('c@x.y'), false);
});

test('buildMessage omits the text part and configuration set when absent', () => {
  const m = buildMessage({ subject: 's', html: '<p>', text: '' }, { to: 'a@b.c', unsub: 'u', from: 'f' });
  assert.equal('Text' in m.Content.Simple.Body, false);
  assert.equal('ConfigurationSetName' in m, false);
});

test('unsubscribeUrl encodes the token', async () => {
  const url = await unsubscribeUrl('k', 'a+b@x.y', 'https://o');
  assert.match(url, /^https:\/\/o\/api\/unsubscribe\?token=[A-Za-z0-9_.%-]+$/);
});

test('bulk headers: List-Id and Precedence', () => {
  const m = buildMessage({ subject: 's', html: '<p>', text: '' }, { to: 'a@b.c', unsub: 'u', from: 'f' });
  const names = m.Content.Simple.Headers.map((h) => h.Name);
  assert.deepEqual(names, ['List-Unsubscribe', 'List-Unsubscribe-Post', 'List-Id', 'Precedence']);
  assert.equal(m.Content.Simple.Headers[3].Value, 'bulk');
});

test('throttling is retried with backoff; final errors are not', async () => {
  const { sendWithRetry, BACKOFF_MS } = require('../send.js');
  const waits = [];
  let n = 0;
  const res = await sendWithRetry(async () => { if (n++ < 2) { const e = new Error('slow down'); e.name = 'TooManyRequestsException'; throw e; } return { MessageId: 'ok' }; }, {}, { sleep: async (ms) => waits.push(ms) });
  assert.equal(res.MessageId, 'ok');
  assert.deepEqual(waits, BACKOFF_MS.slice(0, 2));
  let final = 0;
  await assert.rejects(sendWithRetry(async () => { final++; const e = new Error('no'); e.name = 'MessageRejected'; throw e; }, {}, { sleep: async () => {} }), /no/);
  assert.equal(final, 1);
  let always = 0;
  await assert.rejects(sendWithRetry(async () => { always++; const e = new Error('x'); e.$metadata = { httpStatusCode: 503 }; throw e; }, {}, { sleep: async () => {} }), /x/);
  assert.equal(always, BACKOFF_MS.length + 1);
});
