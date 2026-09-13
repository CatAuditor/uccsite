#!/usr/bin/env node
// restore-operational.mjs — load one dated operational export (§14.3) back
// into an environment's DSQL tables. Built in the same phase as the export:
// a backup nobody has restored is a hypothesis (build-spec-aws.md §14.4).
// Idempotent (ON CONFLICT DO NOTHING on the load-bearing UNIQUEs), so it can
// top up a partially-restored database.
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; node scripts/restore-operational.mjs --env staging --date 2026-09-13
import { createRequire } from 'node:module';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const require = createRequire(import.meta.url);
const { withConnection, withRetry } = require('../packages/db');

const STACKS = { staging: 'UccStaging', prod: 'UccProd' };
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const envName = val('--env') || 'staging';
const date = val('--date') || new Date().toISOString().slice(0, 10);
const stackName = STACKS[envName];
if (!stackName) { console.error(`Unknown env ${envName}`); process.exit(2); }

const region = 'us-west-2';
const cfn = new CloudFormationClient({ region });
const s3 = new S3Client({ region });
const outputs = Object.fromEntries(
  ((await cfn.send(new DescribeStacksCommand({ StackName: stackName }))).Stacks[0].Outputs || [])
    .map(o => [o.OutputKey, o.OutputValue]));
const bucket = outputs.OperationalExportBucketName;
const endpoint = outputs.DsqlEndpoint;
if (!bucket || !endpoint) { console.error('Missing stack outputs'); process.exit(1); }

async function readJson(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const CONFLICT_KEY = {
  members: 'stripe_customer_id',
  subscriptions: 'stripe_subscription_id',
  donations: 'stripe_payment_intent_id',
  subscribers: 'email',
};

const manifest = await readJson(`${date}/manifest.json`);
console.log(`Restoring export ${date}: ${JSON.stringify(manifest.counts)}`);

await withConnection({ endpoint, region }, async (client) => {
  for (const table of ['members', 'subscriptions', 'donations', 'subscribers']) {
    const rows = await readJson(`${date}/${table}.json`);
    if (!rows.length) { console.log(`${table}: empty`); continue; }
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
                 ON CONFLICT (${CONFLICT_KEY[table]}) DO NOTHING`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      await withRetry(async () => {
        await client.query('BEGIN');
        try {
          for (const row of slice) {
            const res = await client.query(sql, cols.map(c => row[c]));
            inserted += res.rowCount;
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
    }
    const count = (await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`)).rows[0].c;
    console.log(`${table}: ${inserted} inserted, table now ${count} rows (export had ${rows.length})`);
  }
});
console.log('Restore complete.');
