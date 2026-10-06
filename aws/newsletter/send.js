'use strict';
// The send loop, with every dependency injected so it is unit-testable
// (test/send.test.mjs). handler.mjs wires the real DSQL client, SES and
// Lambda clients around it.
//
// sendNewsletter({ client, send, newsletter, recipients, secret, origin, timeLeftMs, log })
//   → { sent, failed, skipped, done }
// For each recipient: beginDelivery (the per-recipient idempotency row —
// false = already attempted by an earlier invocation, skip), one SES send,
// finishDelivery. Stops early (done: false) when the Lambda is about to
// run out of time so the caller can re-invoke itself and resume.
const { signToken } = require('@uccsite/tokens');
const { beginDelivery, finishDelivery } = require('@uccsite/db/newsletters');

const UNSUB_TTL_SECONDS = 60 * 60 * 24 * 365;
const UNSUBSCRIBE_TOKEN = '{{unsubscribe_url}}';
const GAP_MS = 100;              // 10/s, under the 14/s account quota
const RESERVE_MS = 90 * 1000;    // stop this early and hand over

async function unsubscribeUrl(secret, email, origin) {
  const token = await signToken(secret, 'unsubscribe', email, UNSUB_TTL_SECONDS);
  return `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

// buildMessage(newsletter, { to, unsub }) → the SESv2 SendEmail input.
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
        ],
      },
    },
  };
}

async function sendNewsletter({ client, send, newsletter, recipients, secret, origin, from, configurationSet, timeLeftMs, log = () => {}, gapMs = GAP_MS }) {
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
      const res = await send(buildMessage(newsletter, { to, unsub, from, configurationSet }));
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

module.exports = { sendNewsletter, buildMessage, unsubscribeUrl, UNSUBSCRIBE_TOKEN, RESERVE_MS };
