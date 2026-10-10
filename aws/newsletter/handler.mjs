// NewsletterSendFn (docs/systems/newsletters.md). Invoked three ways:
//   { id }                 — the admin's approval (send now) → claim + send
//   { id, resume: true }   — self re-invoke when a long send ran out of time
//   { tick: true }         — EventBridge every minute: start every approved
//                            newsletter whose scheduled time has arrived,
//                            and re-kick a 'sending' row that stalled
//   { id, recipientsOverride: [...] } — operator smoke test (scripts/
//                            newsletter-smoke.mjs): the audience query is
//                            skipped and only these addresses are mailed
// Everything else (what the mail says, who approved it) was decided in the
// admin; this only moves approved rows to sent. Recipients are read from the
// frozen audience at send time (filters, or a saved list — packages/db/lists.js), each one
// gets its own signed unsubscribe link, and the per-recipient delivery row
// makes any resume idempotent.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { withConnection } from '@uccsite/db';
import { audienceFor } from '@uccsite/db/lists';
import { claimForSending, dueNewsletters, deliveryCounts, finishNewsletter, authorReplyTo } from '@uccsite/db/newsletters';
import { fromHeader } from '@uccsite/newsletter/render';
import { sendNewsletter } from './send.js';

const { DSQL_ENDPOINT, PUBLIC_ORIGIN, SES_CONFIGURATION_SET, SECRET_ARN_TOKEN_SECRET, AWS_LAMBDA_FUNCTION_NAME, PUBLISH_FUNCTION_NAME } = process.env;
const region = process.env.AWS_REGION;
const STALL_MINUTES = 20;

const ses = new SESv2Client({ region, requestHandler: { requestTimeout: 10000 } });
const lambda = new LambdaClient({ region });
let secretCache = null;

async function tokenSecret() {
  if (secretCache) return secretCache;
  const res = await new SecretsManagerClient({ region }).send(new GetSecretValueCommand({ SecretId: SECRET_ARN_TOKEN_SECRET }));
  if (!res.SecretString || res.SecretString === 'REPLACE_ME') throw new Error('TOKEN_SECRET is unset — cannot sign unsubscribe links');
  secretCache = res.SecretString;
  return secretCache;
}

async function selfInvoke(payload) {
  await lambda.send(new InvokeCommand({ FunctionName: AWS_LAMBDA_FUNCTION_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
}

const db = { endpoint: DSQL_ENDPOINT, region };

async function runOne({ id, resume = false, recipientsOverride }, context) {
  const newsletter = await withConnection(db, (client) => claimForSending(client, id, { resume }));
  if (!newsletter) { console.log(`[newsletter] ${id} not claimable (already sending/sent, cancelled, or not due)`); return { claimed: false }; }
  console.log(`[newsletter] ${id} ${resume ? 'resuming' : 'starting'} subject="${newsletter.subject}" scheduled=${newsletter.scheduledFor || 'now'}`);
  let result;
  try {
    const secret = await tokenSecret();
    // Ad-hoc filters or a saved list (dynamic: re-run now; frozen: its
    // snapshot minus anyone no longer eligible) — packages/db/lists.js.
    let audienceLabel = 'override';
    const recipients = recipientsOverride || await withConnection(db, async (client) => {
      const r = await audienceFor(client, newsletter.audience, { columns: 'a.email, a.first_name, a.last_name', orderBy: 'a.email' });
      if (!r) throw new Error('The saved list this newsletter was going to no longer exists');
      audienceLabel = r.description;
      // One row per address (the names fill {first_name} etc. — send.js).
      const seen = new Map();
      for (const row of (await client.query(r.sql, r.params)).rows) {
        if (row.email && !seen.has(row.email)) seen.set(row.email, { email: row.email, firstName: row.first_name || '', lastName: row.last_name || '' });
      }
      return [...seen.values()];
    });
    console.log(`[newsletter] ${id} recipients=${recipients.length} audience=${audienceLabel}`);
    const replyTo = await withConnection(db, (client) => authorReplyTo(client, newsletter.fromName));
    console.log(`[newsletter] ${id} reply-to=${replyTo || '(none: hello@)'}`);
    result = await withConnection(db, (client) => sendNewsletter({
      client, newsletter, recipients, secret, origin: PUBLIC_ORIGIN,
      from: fromHeader(newsletter.fromName), replyTo, configurationSet: SES_CONFIGURATION_SET || undefined,
      send: (input) => ses.send(new SendEmailCommand(input)),
      timeLeftMs: () => context.getRemainingTimeInMillis(), log: console.log,
    }));
  } catch (err) {
    console.error(`[newsletter] ${id} FAILED: ${err?.name || 'Error'} ${err?.message || ''}`);
    await withConnection(db, async (client) => {
      const counts = await deliveryCounts(client, id);
      await finishNewsletter(client, id, { status: 'failed', sent: counts.sent, failed: counts.failed, error: `${err?.name || 'Error'}: ${err?.message || ''}` });
    });
    return { claimed: true, failed: true };
  }
  if (!result.done) { await selfInvoke({ id, resume: true, ...(recipientsOverride ? { recipientsOverride } : {}) }); return { claimed: true, resumed: true }; }
  const counts = await withConnection(db, async (client) => {
    const c = await deliveryCounts(client, id);
    const allFailed = c.sent === 0 && c.failed > 0;
    await finishNewsletter(client, id, { status: allFailed ? 'failed' : 'sent', sent: c.sent, failed: c.failed, error: allFailed ? 'Every send failed — see the delivery errors' : null });
    return c;
  });
  console.log(`[newsletter] ${id} done sent=${counts.sent} failed=${counts.failed} unknown=${counts.sending} (this run: +${result.sent} sent, ${result.skipped} already done)`);
  // The web copy: finishNewsletter set archived_at when the newsletter is
  // marked "publish to the site"; a site publish renders /newsletters/<slug>
  // so the email's "View in browser" link resolves. Async, no retries (the
  // publish Lambda records its own run); a failure here only delays the
  // archive to the next publish.
  if (PUBLISH_FUNCTION_NAME && counts.sent > 0) {
    const archived = await withConnection(db, async (client) => (await client.query('SELECT archived_at FROM newsletters WHERE id = $1', [id])).rows[0]?.archived_at);
    if (archived) {
      try {
        await lambda.send(new InvokeCommand({ FunctionName: PUBLISH_FUNCTION_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ trigger: `newsletter:${id}` })) }));
        console.log(`[newsletter] ${id} site publish invoked for the web copy`);
      } catch (err) {
        console.error(`[newsletter] ${id} site publish invoke failed: ${err?.name} ${err?.message} — the web copy goes live with the next publish`);
      }
    }
  }
  return { claimed: true, ...counts };
}

async function tick() {
  const { due, stalled } = await withConnection(db, async (client) => ({
    due: await dueNewsletters(client),
    stalled: (await client.query(
      `SELECT id FROM newsletters WHERE status = 'sending' AND updated_at < now() - interval '${STALL_MINUTES} minutes'`)).rows.map((r) => r.id),
  }));
  for (const id of due) { console.log(`[newsletter] tick: ${id} is due`); await selfInvoke({ id }); }
  for (const id of stalled) { console.log(`[newsletter] tick: ${id} stalled, resuming`); await selfInvoke({ id, resume: true }); }
  return { due: due.length, stalled: stalled.length };
}

export async function handler(event = {}, context) {
  if (event.tick) return tick();
  if (!event.id || !/^[0-9a-f-]{36}$/.test(String(event.id))) throw new Error('payload needs { id } or { tick: true }');
  if (event.recipientsOverride && !(Array.isArray(event.recipientsOverride) && event.recipientsOverride.every((e) => typeof e === 'string' && e.includes('@')))) {
    throw new Error('recipientsOverride must be a list of addresses');
  }
  return runOne(event, context);
}
