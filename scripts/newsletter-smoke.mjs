#!/usr/bin/env node
// newsletter-smoke.mjs — end-to-end check of the NewsletterSendFn Lambda on
// an environment WITHOUT mailing the real audience: inserts an approved
// newsletter row, invokes the Lambda with recipientsOverride (the SES mailbox
// simulator by default), polls the row to 'sent', prints the delivery
// ledger, then deletes both. Exit 1 on any mismatch.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/newsletter-smoke.mjs --env staging [--to success@simulator.amazonses.com]
import { createRequire } from 'node:module';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { renderEmail } from '../packages/newsletter/render.mjs';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const nl = require('../packages/db/newsletters');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const to = argValue(args, '--to', 'success@simulator.amazonses.com');
const { region, outputs } = await resolveEnv(envName, ['DsqlEndpoint', 'NewsletterFunctionName']);
const db = { endpoint: outputs.DsqlEndpoint, region };

const doc = {
  subject: `[smoke] newsletter ${new Date().toISOString()}`, headline: 'Smoke test', preheader: 'ignore me',
  blocks: [{ type: 'text', markdown: 'This is the **newsletter smoke test**. [Site](https://utahciviccompact.org)' }, { type: 'button', label: 'Go', url: 'https://utahciviccompact.org' }],
  theme: {}, audience: {},
};
const { html, text } = renderEmail(doc);

const id = await withConnection(db, async (client) => {
  const nid = await nl.createNewsletter(client, { createdBy: 'smoke', fromName: 'Smoke Test', subject: doc.subject, theme: {} });
  const row = await nl.getNewsletter(client, nid);
  await nl.saveNewsletter(client, { id: nid, ...doc, fromName: 'Smoke Test', expectedUpdatedAt: row.updatedAt });
  await nl.requestSend(client, { id: nid, requestedBy: 'smoke', requestedByUser: 'smoke', note: '', scheduledFor: null, html, text, recipients: 1 });
  await nl.reviewSend(client, { id: nid, approve: true, reviewedBy: 'smoke2', note: '' });
  return nid;
});
console.log(`inserted approved newsletter ${id}`);

const lambda = new LambdaClient({ region });
await lambda.send(new InvokeCommand({ FunctionName: outputs.NewsletterFunctionName, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ id, recipientsOverride: [to] })) }));
console.log(`invoked ${outputs.NewsletterFunctionName}`);

let row; let deliveries;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  ({ row, deliveries } = await withConnection(db, async (client) => ({
    row: await nl.getNewsletter(client, id),
    deliveries: (await client.query('SELECT email, status, message_id, error FROM newsletter_deliveries WHERE newsletter_id = $1', [id])).rows,
  })));
  if (['sent', 'failed'].includes(row.status)) break;
}
console.log(`status=${row.status} sent=${row.sentCount} failed=${row.failedCount} error=${row.error || '-'}`);
for (const d of deliveries) console.log(`  ${d.email} ${d.status} ${d.message_id || ''} ${d.error || ''}`);

await withConnection(db, (client) => nl.deleteNewsletter(client, id));
console.log('cleaned up');
if (row.status !== 'sent' || row.sentCount !== 1 || deliveries.length !== 1 || deliveries[0].status !== 'sent') {
  console.error('SMOKE FAILED');
  process.exit(1);
}
console.log('SMOKE OK');
