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
// frozen audience filters at send time (packages/db/audience.js), each one
// gets its own signed unsubscribe link, and the per-recipient delivery row
// makes any resume idempotent.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { withConnection } from '@uccsite/db';
import { audienceQuery, normalizeFilters } from '@uccsite/db/audience';
import { claimForSending, dueNewsletters, deliveryCounts, finishNewsletter } from '@uccsite/db/newsletters';
import { fromHeader } from '@uccsite/newsletter/render';
import { sendNewsletter } from './send.js';

const { DSQL_ENDPOINT, PUBLIC_ORIGIN, SES_CONFIGURATION_SET, SECRET_ARN_TOKEN_SECRET, AWS_LAMBDA_FUNCTION_NAME } = process.env;
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
    const recipients = recipientsOverride || await withConnection(db, async (client) => {
      const { sql, params } = audienceQuery(normalizeFilters(newsletter.audience), { columns: 'a.email', orderBy: 'a.email' });
      return [...new Set((await client.query(sql, params)).rows.map((r) => r.email).filter(Boolean))];
    });
    console.log(`[newsletter] ${id} recipients=${recipients.length}${recipientsOverride ? ' (override)' : ''}`);
    result = await withConnection(db, (client) => sendNewsletter({
      client, newsletter, recipients, secret, origin: PUBLIC_ORIGIN,
      from: fromHeader(newsletter.fromName), configurationSet: SES_CONFIGURATION_SET || undefined,
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
