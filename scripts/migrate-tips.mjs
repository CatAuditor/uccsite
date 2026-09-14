#!/usr/bin/env node
// migrate-tips.mjs — one-time (re-runnable) import of the Airtable tipline
// base into an environment's DSQL `tips` table
// (docs/migration/airtable-retirement-plan.md).
//
// Reads every record from the Airtable REST API with a READ-SCOPED personal
// access token passed as the AIRTABLE_TOKEN env var (never stored in Secrets
// Manager), maps the fields 1:1, carries createdTime as created_at, stores
// the Airtable record id in legacy_airtable_id, and inserts in batches via
// insertChunked. Idempotent: ON CONFLICT (legacy_airtable_id) DO NOTHING, so
// the same command runs before the cutover flip, again after propagation
// (delta), and again after any rollback.
//
// CONFIDENTIAL DATA: this script prints COUNTS ONLY — never a field value,
// never an Airtable error body (they echo field values).
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; $env:AIRTABLE_TOKEN='pat…'
//   node scripts/migrate-tips.mjs --env staging [--dry-run]
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection, insertChunked } = require('../packages/db');

const AIRTABLE_URL = 'https://api.airtable.com/v0/appgd3KnYil6zQgHp/tblRLdlEgvV1KqqiL';

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const dryRun = args.includes('--dry-run');

const token = process.env.AIRTABLE_TOKEN;
if (!token) {
  console.error('AIRTABLE_TOKEN is not set (a data.records:read token for the Tip Intake base).');
  process.exit(1);
}

async function fetchAll() {
  const records = [];
  let offset;
  do {
    const url = new URL(AIRTABLE_URL);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status} (body withheld)`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

const str = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n);

function toRow(rec) {
  const f = rec.fields || {};
  const anonymous = f.anonymous === true || f.anonymous === 1;
  return {
    id: randomUUID(),
    legacy_airtable_id: rec.id,
    name: anonymous ? 'Anonymous' : (str(f.name, 200) || null),
    anonymous: anonymous ? 1 : 0,
    email: str(f.email, 200).toLowerCase(),        // '' when Airtable had none (NOT NULL)
    subject_of_tip: str(f.subject_of_tip, 200) || null,
    tip_summary: str(f.tip_summary, 100000),
    status: str(f.status, 40) || 'New',
    created_at: rec.createdTime,
  };
}

async function main() {
  console.log('Reading Airtable…');
  const records = await fetchAll();
  const rows = records.map(toRow);
  const empty = rows.filter(r => !r.tip_summary).length;
  const noEmail = rows.filter(r => !r.email).length;
  console.log(`Airtable: ${records.length} records (${empty} with an empty tip_summary, ${noEmail} without an email)`);
  const usable = rows.filter(r => r.tip_summary);
  if (dryRun) { console.log(`Dry run — ${usable.length} would be inserted; nothing written.`); return; }

  const { region, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
  await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
    const cols = ['id', 'legacy_airtable_id', 'name', 'anonymous', 'email', 'subject_of_tip', 'tip_summary', 'status', 'created_at'];
    const sql = `INSERT INTO tips (${cols.join(', ')}) VALUES /*VALUES*/ ON CONFLICT (legacy_airtable_id) DO NOTHING`;
    const inserted = await insertChunked(client, sql, usable, (r) => cols.map(c => r[c]));
    const total = (await client.query('SELECT count(*)::int AS n FROM tips')).rows[0].n;
    const imported = (await client.query('SELECT count(*)::int AS n FROM tips WHERE legacy_airtable_id IS NOT NULL')).rows[0].n;
    console.log(`tips: ${inserted} inserted, ${usable.length - inserted} already present; table now ${total} rows (${imported} imported)`);
    if (imported !== usable.length) {
      console.warn(`WARNING: ${usable.length} usable Airtable records but ${imported} imported rows in DSQL — investigate before retiring the base.`);
    }
  });
  console.log('Import complete.');
}

main().catch((err) => { console.error(`FAILED: ${err.message}`); process.exit(1); });
