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
// Row ids are DERIVED from the Airtable record id (sha1 -> uuid), so every run
// mints the same uuid for the same record: restore-operational's
// ON CONFLICT (id) cannot collide on legacy_airtable_id after a re-import.
// Tips an owner deleted in the admin are NOT re-imported: deleteTip records
// the legacy id (only that, no contents) in audit_log and this script skips
// those ids.
//
// CONFIDENTIAL DATA: this script prints COUNTS ONLY — never a field value,
// never an Airtable error body (they echo field values).
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; $env:AIRTABLE_TOKEN='pat…'
//   node scripts/migrate-tips.mjs --env staging [--dry-run]
import { createHash } from 'node:crypto';
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

// Stable uuid per Airtable record (v5-shaped: sha1 with version/variant bits set).
function tipUuid(recordId) {
  const h = createHash('sha1').update(`uccsite-tip:${recordId}`).digest('hex').slice(0, 32).split('');
  h[12] = '5';
  h[16] = '89ab'[parseInt(h[16], 16) & 3];
  const x = h.join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

async function fetchPage(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after') || 30) * 1000;
      console.log(`Airtable 429; waiting ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Airtable ${res.status} (body withheld)`);
    return res.json();
  }
}

async function fetchAll() {
  const records = [];
  let offset;
  do {
    const url = new URL(AIRTABLE_URL);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const data = await fetchPage(url);
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
    id: tipUuid(rec.id),
    legacy_airtable_id: rec.id,
    name: anonymous ? 'Anonymous' : (str(f.name, 200) || null),
    anonymous: anonymous ? 1 : 0,
    email: str(f.email, 200).toLowerCase(),        // '' when Airtable had none (NOT NULL)
    subject_of_tip: str(f.subject_of_tip, 200) || null,
    tip_summary: str(f.tip_summary, 100000),
    status: str(f.status, 40) || 'New',
    created_at: rec.createdTime,
    updated_at: rec.createdTime,   // untouched by staff yet — must equal created_at
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
    // Owner-deleted imports stay deleted (tombstone = the legacy id in audit_log).
    const deleted = new Set();
    for (const { diff } of (await client.query(`SELECT diff FROM audit_log WHERE action = 'tip.delete' AND diff IS NOT NULL`)).rows) {
      try { const lid = JSON.parse(diff)?.legacy_airtable_id; if (lid) deleted.add(lid); } catch {}
    }
    const toInsert = usable.filter(r => !deleted.has(r.legacy_airtable_id));
    const skippedDeleted = usable.length - toInsert.length;
    const cols = ['id', 'legacy_airtable_id', 'name', 'anonymous', 'email', 'subject_of_tip', 'tip_summary', 'status', 'created_at', 'updated_at'];
    const sql = `INSERT INTO tips (${cols.join(', ')}) VALUES /*VALUES*/ ON CONFLICT (legacy_airtable_id) DO NOTHING`;
    const inserted = await insertChunked(client, sql, toInsert, (r) => cols.map(c => r[c]));
    const total = (await client.query('SELECT count(*)::int AS n FROM tips')).rows[0].n;
    const imported = (await client.query('SELECT count(*)::int AS n FROM tips WHERE legacy_airtable_id IS NOT NULL')).rows[0].n;
    console.log(`tips: ${inserted} inserted, ${toInsert.length - inserted} already present, ${skippedDeleted} skipped (deleted by an owner); table now ${total} rows (${imported} imported)`);
    if (imported !== toInsert.length) {
      console.warn(`WARNING: expected ${toInsert.length} imported rows in DSQL but found ${imported}; investigate before retiring the base.`);
    }
  });
  console.log('Import complete.');
}

main().catch((err) => { console.error(`FAILED: ${err.message}`); process.exit(1); });
