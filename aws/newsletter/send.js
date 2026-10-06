'use strict';
// The send loop, with every dependency injected so it is unit-testable
// (test/send.test.mjs). handler.mjs wires the real DSQL client, SES and
// Lambda clients around it.
//
// sendNewsletter({ client, send, newsletter, recipients, secret, origin, timeLeftMs, log })
//   → { sent, failed, skipped, done }
// For each recipient: beginDelivery (the per-recipient idempotency row —
// false = already attempted by an earlier invocation, skip), one SES send
// (retried with backoff on throttling / transient errors), finishDelivery.
// Stops early (done: false) when the Lambda is about to run out of time so
// the caller can re-invoke itself and resume.
const { signToken } = require('@uccsite/tokens');
const { beginDelivery, finishDelivery } = require('@uccsite/db/newsletters');

const UNSUB_TTL_SECONDS = 60 * 60 * 24 * 365;
const UNSUBSCRIBE_TOKEN = '{{unsubscribe_url}}';
const GAP_MS = 100;              // 10/s, under the 14/s account quota
const RESERVE_MS = 90 * 1000;    // stop this early and hand over
const LIST_ID = 'Utah Civic Compact newsletter <newsletter.utahciviccompact.org>';

// Transient SES failures worth a second try (throttling, 5xx, network).
// Anything else (MessageRejected, AccountSuppressed, bad address) is final.
const RETRYABLE = new Set(['TooManyRequestsException', 'Throttling', 'ThrottlingException', 'LimitExceededException',
  'InternalFailure', 'ServiceUnavailable', 'ServiceUnavailableException', 'TimeoutError', 'NetworkingError', 'ECONNRESET', 'ETIMEDOUT']);
const BACKOFF_MS = [500, 2000, 5000];
function isRetryable(err) {
  if (!err) return false;
  if (RETRYABLE.has(err.name) || RETRYABLE.has(err.code)) return true;
  const status = err.$metadata?.httpStatusCode;
  return status === 429 || (status >= 500 && status < 600);
}

async function unsubscribeUrl(secret, email, origin) {
  const token = await signToken(secret, 'unsubscribe', email, UNSUB_TTL_SECONDS);
  return `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

// buildMessage(newsletter, { to, unsub }) → the SESv2 SendEmail input.
// List-Id + Precedence: bulk mark it as list mail (bulk-sender
// classification; keeps auto-replies and out-of-office off hello@).
function buildMessage(newsletter, { to, unsub, from, configurationSet }) {
  const body = { Html: { Data: newsletter.html.replaceAll(UNSUBSCRIBE_TOKEN, unsub), Charset: 'UTF-8' } };
  if (newsletter.text) body.Text = { Data: newsletter.text.replaceAll(UNSUBSCRIBE_TOKEN, unsub), Charset: 'UTF-8' };
  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
    Content: {
      Simple: {
        Subject: { Data: newsletter.subject, Charset: 'UTF-8' },
        Body: body,
        Headers: [
          { Name: 'List-Unsubscribe', Value: `<${unsub}>` },
          { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          { Name: 'List-Id', Value: LIST_ID },
          { Name: 'Precedence', Value: 'bulk' },
        ],
      },
    },
  };
}

// sendWithRetry(send, input, { sleep, log }) → SES result; throws the last
// error after BACKOFF_MS.length retries of a retryable failure.
async function sendWithRetry(send, input, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {}, label = '' } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send(input);
    } catch (err) {
      if (!isRetryable(err) || attempt >= BACKOFF_MS.length) throw err;
      log(`[newsletter] ${label} ${err?.name || 'error'} — retry ${attempt + 1}/${BACKOFF_MS.length} in ${BACKOFF_MS[attempt]} ms`);
      await sleep(BACKOFF_MS[attempt]);
    }
  }
}

async function sendNewsletter({ client, send, newsletter, recipients, secret, origin, from, configurationSet, timeLeftMs, log = () => {}, gapMs = GAP_MS, sleep }) {
  let sent = 0; let failed = 0; let skipped = 0;
  for (let i = 0; i < recipients.length; i++) {
    if (timeLeftMs() < RESERVE_MS) {
      log(`[newsletter] ${newsletter.id} pausing at ${i}/${recipients.length} (time); will resume`);
      return { sent, failed, skipped, done: false };
    }
    const to = recipients[i];
    if (!(await beginDelivery(client, newsletter.id, to))) { skipped++; continue; }
    try {
      const unsub = await unsubscribeUrl(secret, to, origin);
      const res = await sendWithRetry(send, buildMessage(newsletter, { to, unsub, from, configurationSet }), { sleep, log, label: `${newsletter.id} send #${i}` });
      await finishDelivery(client, newsletter.id, to, { status: 'sent', messageId: res?.MessageId });
      sent++;
    } catch (err) {
      failed++;
      // Recipient is never logged — the delivery row holds it.
      log(`[newsletter] ${newsletter.id} send #${i} failed: ${err?.name || 'Error'} ${err?.message || ''}`);
      await finishDelivery(client, newsletter.id, to, { status: 'failed', error: `${err?.name || 'Error'}: ${err?.message || ''}` });
    }
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  return { sent, failed, skipped, done: true };
}

module.exports = { sendNewsletter, buildMessage, unsubscribeUrl, sendWithRetry, isRetryable, UNSUBSCRIBE_TOKEN, RESERVE_MS, LIST_ID, BACKOFF_MS };
