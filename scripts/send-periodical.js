// Sends a periodical email to all subscribers + opted-in members via Mailgun.
//
// Usage:
//   node --env-file=.env scripts/send-periodical.js --subject "Subject line" --html path/to/email.html [--text path/to/email.txt] [--dry-run] [--test you@example.com]
//
// Requires MAILGUN_API_KEY in .env (gitignored).

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MAILGUN_DOMAIN = 'utahciviccompact.org';
const FROM_ADDRESS = 'Utah Civic Compact <hello@utahciviccompact.org>';

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--subject') args.subject = argv[++i];
    else if (arg === '--html') args.htmlFile = argv[++i];
    else if (arg === '--text') args.textFile = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--test') args.test = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function getRecipients() {
  const sql = `SELECT DISTINCT email FROM (
    SELECT email FROM subscribers
    UNION
    SELECT email FROM members WHERE newsletter_opt_in = 1
  ) ORDER BY email`;

  const output = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'ucc-members', '--remote', '--json', '--command', sql],
    { encoding: 'utf-8' }
  );

  const [{ results }] = JSON.parse(output);
  return results.map((row) => row.email);
}

async function sendOne(apiKey, to, subject, html, text) {
  const form = new FormData();
  form.set('from', FROM_ADDRESS);
  form.set('to', to);
  form.set('subject', subject);
  if (html) form.set('html', html);
  if (text) form.set('text', text);

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mailgun error for ${to}: ${res.status} ${errText}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.subject) throw new Error('--subject is required');
  if (!args.htmlFile && !args.textFile) throw new Error('--html <file> or --text <file> is required');

  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey && !args.dryRun) {
    throw new Error('MAILGUN_API_KEY is not set. Run with: node --env-file=.env scripts/send-periodical.js ...');
  }

  const html = args.htmlFile ? readFileSync(args.htmlFile, 'utf-8') : undefined;
  const text = args.textFile ? readFileSync(args.textFile, 'utf-8') : undefined;

  const recipients = args.test ? [args.test] : getRecipients();

  console.log(`Subject: ${args.subject}`);
  console.log(`Recipients: ${recipients.length}`);
  recipients.forEach((email) => console.log(`  - ${email}`));

  if (args.dryRun) {
    console.log('\nDry run — no emails sent.');
    return;
  }

  for (const email of recipients) {
    await sendOne(apiKey, email, args.subject, html, text);
    console.log(`Sent to ${email}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nDone. Sent ${recipients.length} emails.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
