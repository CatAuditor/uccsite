// Sends a periodical email to all subscribers + opted-in members via Amazon SES.
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; node --env-file=.env scripts/send-periodical.js --subject "Subject line" --html path/to/email.html [--text path/to/email.txt] [--dry-run] [--test you@example.com] [--resume sent.log] [--env staging|prod]
//     [--audience utah|outside|unknown|all] [--donors-only] [--petition <slug>] [--history never|reached]
//
// Audience ("who is this email going to"): the SAME filters as the admin's
// Mailing list page (packages/db/audience.js), so the count the dashboard
// shows is exactly who receives the send. Default: everyone — subscribers
// plus opted-in members, as before.
//
// Requires in .env (gitignored):
//   TOKEN_SECRET     — same secret the API uses; signs per-recipient unsubscribe links
// plus AWS credentials (profile uccsite): recipients are read from the
// environment's DSQL database and mail goes out through SES
// (docs/systems/email.md) — no provider API key any more. The sending
// identity + configuration set live in the prod stack and are shared by
// both environments, so an --env staging run still sends real mail from
// hello@utahciviccompact.org; use --test success@simulator.amazonses.com.
//
// Every send is appended to sent-<timestamp>.log. If a run aborts, re-run with
// --resume <that log> to skip addresses already sent.

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { resolveEnv, REGION } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { audienceQuery, describeFilters } = require('../packages/db/audience');

const SES_CONFIGURATION_SET = 'ucc-prod';
const FROM_ADDRESS = 'Utah Civic Compact <hello@utahciviccompact.org>';
const SITE_URL = 'https://utahciviccompact.org';
const UNSUB_TTL_SECONDS = 60 * 60 * 24 * 365;

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--subject') args.subject = argv[++i];
    else if (arg === '--html') args.htmlFile = argv[++i];
    else if (arg === '--text') args.textFile = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--test') args.test = argv[++i];
    else if (arg === '--resume') args.resume = argv[++i];
    else if (arg === '--env') args.env = argv[++i];
    else if (arg === '--audience') args.residency = argv[++i];
    else if (arg === '--donors-only') args.donors = true;
    else if (arg === '--petition') args.petition = argv[++i];
    else if (arg === '--history') args.history = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

// Recipients + the origin unsubscribe links point at, both from the target
// environment's stack — a staging test send must NOT carry prod unsubscribe
// URLs (clicking one would act on the production tables).
async function resolveRecipients(envName = 'prod', filters = {}) {
  const { region, outputs } = await resolveEnv(envName, ['DsqlEndpoint', 'PublicOrigin']);
  if (filters.residency && !['utah', 'outside', 'unknown', 'all'].includes(filters.residency)) {
    throw new Error('--audience must be utah, outside, unknown or all');
  }
  if (filters.petition && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(filters.petition)) throw new Error('--petition must be a campaign slug');
  if (filters.history && !['never', 'reached'].includes(filters.history)) throw new Error('--history must be never or reached');

  // Subscribers UNION opted-in members, narrowed by the audience filters.
  const { sql, params } = audienceQuery(filters, { columns: 'a.email', orderBy: 'a.email' });
  const rows = await withConnection({ endpoint: outputs.DsqlEndpoint, region }, (client) => client.query(sql, params));
  return { recipients: [...new Set(rows.rows.map((row) => row.email))], origin: outputs.PublicOrigin };
}

// Mirrors signToken() in packages/tokens (purpose 'unsubscribe') — the
// cross-verification test in aws/api/test pins the byte format.
function unsubscribeUrl(secret, email, origin = SITE_URL) {
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ p: 'unsubscribe', e: email, x: Math.floor(Date.now() / 1000) + UNSUB_TTL_SECONDS }));
  const sig = createHmac('sha256', secret).update(payload).digest();
  return `${origin}/api/unsubscribe?token=${encodeURIComponent(`${b64url(payload)}.${b64url(sig)}`)}`;
}

const ses = new SESv2Client({ region: REGION });

async function sendOne(secret, to, subject, html, text, origin) {
  const unsub = unsubscribeUrl(secret, to, origin);
  const body = {};
  if (html) body.Html = { Data: html.replaceAll('{{unsubscribe_url}}', unsub), Charset: 'UTF-8' };
  if (text) body.Text = { Data: text.replaceAll('{{unsubscribe_url}}', unsub), Charset: 'UTF-8' };
  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_ADDRESS,
    Destination: { ToAddresses: [to] },
    ConfigurationSetName: SES_CONFIGURATION_SET,
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: body,
        Headers: [
          { Name: 'List-Unsubscribe', Value: `<${unsub}>` },
          { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
        ],
      },
    },
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.subject) throw new Error('--subject is required');
  if (!args.htmlFile && !args.textFile) throw new Error('--html <file> or --text <file> is required');

  const secret = process.env.TOKEN_SECRET;
  if (!args.dryRun && !secret) {
    throw new Error('TOKEN_SECRET is not set (needed to sign unsubscribe links). Run with: node --env-file=.env scripts/send-periodical.js ...');
  }

  const html = args.htmlFile ? readFileSync(args.htmlFile, 'utf-8') : undefined;
  const text = args.textFile ? readFileSync(args.textFile, 'utf-8') : undefined;
  if (html && !html.includes('{{unsubscribe_url}}')) {
    throw new Error('HTML body must include an unsubscribe link: use {{unsubscribe_url}} as the href.');
  }

  const alreadySent = new Set(
    args.resume && existsSync(args.resume) ? readFileSync(args.resume, 'utf-8').split('\n').filter(Boolean) : []
  );
  const filters = { residency: args.residency, donors: args.donors, petition: args.petition };
  const resolved = await resolveRecipients(args.env || 'prod', filters);
  const origin = resolved.origin;
  const recipients = (args.test ? [args.test] : resolved.recipients).filter((e) => !alreadySent.has(e));

  console.log(`Subject: ${args.subject}`);
  console.log(`Audience: ${describeFilters(filters)}`);
  console.log(`Recipients: ${recipients.length}${alreadySent.size ? ` (skipping ${alreadySent.size} already sent)` : ''}`);
  recipients.forEach((email) => console.log(`  - ${email}`));

  if (args.dryRun) {
    console.log('\nDry run — no emails sent.');
    return;
  }

  const log = args.resume || `sent-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  const failures = [];
  for (const email of recipients) {
    try {
      await sendOne(secret, email, args.subject, html, text, origin);
      appendFileSync(log, email + '\n');
      console.log(`Sent to ${email}`);
    } catch (err) {
      failures.push(email);
      console.error(`FAILED ${email}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nDone. Sent ${recipients.length - failures.length}/${recipients.length}. Log: ${log}`);
  if (failures.length) {
    console.error(`Failed (${failures.length}):\n  ${failures.join('\n  ')}\nRe-run with --resume ${log} to retry.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
