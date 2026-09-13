// Sends a periodical email to all subscribers + opted-in members via Mailgun.
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; node --env-file=.env scripts/send-periodical.js --subject "Subject line" --html path/to/email.html [--text path/to/email.txt] [--dry-run] [--test you@example.com] [--resume sent.log] [--env staging|prod]
//
// Requires in .env (gitignored):
//   MAILGUN_API_KEY  — Mailgun private API key
//   TOKEN_SECRET     — same secret the API uses; signs per-recipient unsubscribe links
// plus AWS credentials (profile uccsite) — recipients are read from the
// environment's DSQL database (was: wrangler d1 execute against D1).
//
// Every send is appended to sent-<timestamp>.log. If a run aborts, re-run with
// --resume <that log> to skip addresses already sent.

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');

const MAILGUN_DOMAIN = 'utahciviccompact.org';
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
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function getRecipients(envName = 'prod') {
  const stackName = { staging: 'UccStaging', prod: 'UccProd' }[envName];
  if (!stackName) throw new Error(`Unknown env ${envName}`);
  const region = 'us-west-2';
  const cfn = new CloudFormationClient({ region });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const endpoint = (res.Stacks[0].Outputs || []).find((o) => o.OutputKey === 'DsqlEndpoint')?.OutputValue;
  if (!endpoint) throw new Error(`Stack ${stackName} has no DsqlEndpoint output`);

  // Same recipient set as always: subscribers UNION opted-in members.
  const rows = await withConnection({ endpoint, region }, (client) => client.query(
    `SELECT DISTINCT email FROM (
       SELECT email FROM subscribers
       UNION
       SELECT email FROM members WHERE newsletter_opt_in = 1
     ) AS all_recipients ORDER BY email`,
  ));
  return rows.rows.map((row) => row.email);
}

// Mirrors signToken() in functions/api/_lib.js (purpose 'unsubscribe').
function unsubscribeUrl(secret, email) {
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ p: 'unsubscribe', e: email, x: Math.floor(Date.now() / 1000) + UNSUB_TTL_SECONDS }));
  const sig = createHmac('sha256', secret).update(payload).digest();
  return `${SITE_URL}/api/unsubscribe?token=${encodeURIComponent(`${b64url(payload)}.${b64url(sig)}`)}`;
}

async function sendOne(apiKey, secret, to, subject, html, text) {
  const unsub = unsubscribeUrl(secret, to);
  const form = new FormData();
  form.set('from', FROM_ADDRESS);
  form.set('to', to);
  form.set('subject', subject);
  if (html) form.set('html', html.replaceAll('{{unsubscribe_url}}', unsub));
  if (text) form.set('text', text.replaceAll('{{unsubscribe_url}}', unsub));
  form.set('h:List-Unsubscribe', `<${unsub}>`);
  form.set('h:List-Unsubscribe-Post', 'List-Unsubscribe=One-Click');

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Mailgun ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.subject) throw new Error('--subject is required');
  if (!args.htmlFile && !args.textFile) throw new Error('--html <file> or --text <file> is required');

  const apiKey = process.env.MAILGUN_API_KEY;
  const secret = process.env.TOKEN_SECRET;
  if (!args.dryRun) {
    if (!apiKey) throw new Error('MAILGUN_API_KEY is not set. Run with: node --env-file=.env scripts/send-periodical.js ...');
    if (!secret) throw new Error('TOKEN_SECRET is not set (needed to sign unsubscribe links).');
  }

  const html = args.htmlFile ? readFileSync(args.htmlFile, 'utf-8') : undefined;
  const text = args.textFile ? readFileSync(args.textFile, 'utf-8') : undefined;
  if (html && !html.includes('{{unsubscribe_url}}')) {
    throw new Error('HTML body must include an unsubscribe link: use {{unsubscribe_url}} as the href.');
  }

  const alreadySent = new Set(
    args.resume && existsSync(args.resume) ? readFileSync(args.resume, 'utf-8').split('\n').filter(Boolean) : []
  );
  const recipients = (args.test ? [args.test] : await getRecipients(args.env || 'prod')).filter((e) => !alreadySent.has(e));

  console.log(`Subject: ${args.subject}`);
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
      await sendOne(apiKey, secret, email, args.subject, html, text);
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
