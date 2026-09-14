#!/usr/bin/env node
// restore-operational.mjs — load one dated operational export (§14.3) back
// into an environment's DSQL tables. Built in the same phase as the export:
// a backup nobody has restored is a hypothesis (build-spec-aws.md §14.4).
//
// Idempotent via ON CONFLICT (id) DO NOTHING: exported rows carry their
// primary keys (member_id references must survive the round trip), and a
// re-run over a partial restore skips exactly the rows already present.
// (Arbitrating on the business keys instead would PK-collide on rows whose
// business key is NULL — e.g. legacy members without a stripe_customer_id.)
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; node scripts/restore-operational.mjs --env staging --date 2026-09-13
import { createRequire } from 'node:module';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection, insertChunked } = require('../packages/db');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const date = argValue(args, '--date', new Date().toISOString().slice(0, 10));

const { region, outputs } = await resolveEnv(envName, ['DsqlEndpoint', 'OperationalExportBucketName']);
const s3 = new S3Client({ region });

async function readJson(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: outputs.OperationalExportBucketName, Key: key }));
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const manifest = await readJson(`${date}/manifest.json`);
console.log(`Restoring export ${date}: ${JSON.stringify(manifest.counts)}`);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  // members first — subscriptions/donations reference members.id.
  for (const table of ['members', 'subscriptions', 'donations', 'subscribers', 'tips']) {
    const rows = await readJson(`${date}/${table}.json`);
    if (!rows.length) { console.log(`${table}: empty`); continue; }
    const cols = Object.keys(rows[0]);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES /*VALUES*/ ON CONFLICT (id) DO NOTHING`;
    const inserted = await insertChunked(client, sql, rows, (row) => cols.map(c => row[c]));
    const count = (await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`)).rows[0].c;
    console.log(`${table}: ${inserted} inserted, table now ${count} rows (export had ${rows.length})`);
  }
});
console.log('Restore complete.');
