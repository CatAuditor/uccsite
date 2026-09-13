#!/usr/bin/env node
// migrate-d1.mjs — one-time bulk migration of the operational tables from the
// live D1 database (ucc-members) into an environment's DSQL cluster
// (build-spec-aws.md §18 step 6).
//
// Reads via `wrangler d1 execute --remote --json` (needs CLOUDFLARE_API_TOKEN
// or a wrangler login), transforms integer ids to UUIDs while preserving
// member_id joins, carries created_at, stores the old id in legacy_id, and
// inserts in chunks (DSQL caps DML at 3,000 rows/transaction). Idempotent:
// every insert is ON CONFLICT DO NOTHING keyed on the original UNIQUEs, and
// re-runs skip rows whose legacy_id already landed.
//
// Verification: prints per-table D1 vs DSQL counts and the donations SUM —
// the SUM must match the pre-migration figure exactly (spec §19 Phase 5).
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; node scripts/migrate-d1.mjs --env staging [--dry-run]
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const require = createRequire(import.meta.url);
const { withConnection, withRetry } = require('../packages/db');

const STACKS = { staging: 'UccStaging', prod: 'UccProd' };
const args = process.argv.slice(2);
const envName = args[args.indexOf('--env') + 1] || 'staging';
const dryRun = args.includes('--dry-run');
const stackName = STACKS[envName];
if (!stackName) { console.error(`Unknown env ${envName}`); process.exit(2); }

const CHUNK = 500;

function d1(sql) {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const out = execFileSync(cmd,
    ['wrangler', 'd1', 'execute', 'ucc-members', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  const [{ results }] = JSON.parse(out);
  return results;
}

async function main() {
  console.log('Reading D1…');
  const members = d1('SELECT * FROM members ORDER BY id');
  const subscriptions = d1('SELECT * FROM subscriptions ORDER BY id');
  const donations = d1('SELECT * FROM donations ORDER BY id');
  const subscribers = d1('SELECT * FROM subscribers ORDER BY id');
  const processedEvents = d1('SELECT * FROM processed_events ORDER BY id');
  const d1TotalCents = donations.reduce((s, d) => s + (d.amount_cents || 0), 0);

  console.log(`D1: members=${members.length} subscriptions=${subscriptions.length} donations=${donations.length} subscribers=${subscribers.length} processed_events=${processedEvents.length} donations SUM=${d1TotalCents}`);
  if (dryRun) { console.log('Dry run — nothing written.'); return; }

  const region = 'us-west-2';
  const cfn = new CloudFormationClient({ region });
  const stacks = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const endpoint = (stacks.Stacks[0].Outputs || []).find(o => o.OutputKey === 'DsqlEndpoint')?.OutputValue;
  if (!endpoint) throw new Error('No DsqlEndpoint output');

  // Old integer member id -> new UUID (stable across re-runs via legacy_id lookup).
  const memberUuid = new Map(members.map(m => [m.id, randomUUID()]));

  await withConnection({ endpoint, region }, async (client) => {
    // Re-run safety: adopt UUIDs of already-migrated members.
    const existing = await client.query('SELECT id, legacy_id FROM members WHERE legacy_id IS NOT NULL');
    for (const row of existing.rows) memberUuid.set(row.legacy_id, row.id);

    const insert = async (label, rows, sql, toParams) => {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        await withRetry(async () => {
          await client.query('BEGIN');
          try {
            for (const row of slice) {
              const res = await client.query(sql, toParams(row));
              inserted += res.rowCount;
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }
        });
      }
      console.log(`${label}: ${inserted} inserted (${rows.length - inserted} already present/skipped)`);
    };

    await insert('members', members,
      `INSERT INTO members (id, legacy_id, stripe_customer_id, email, first_name, last_name, zip, newsletter_opt_in, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (stripe_customer_id) DO NOTHING`,
      m => [memberUuid.get(m.id), m.id, m.stripe_customer_id, m.email, m.first_name, m.last_name, m.zip, m.newsletter_opt_in ?? 0, m.created_at]);

    await insert('subscriptions', subscriptions,
      `INSERT INTO subscriptions (id, legacy_id, member_id, stripe_subscription_id, stripe_price_id, amount_cents, status, current_period_end, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (stripe_subscription_id) DO NOTHING`,
      s => [randomUUID(), s.id, memberUuid.get(s.member_id) ?? null, s.stripe_subscription_id, s.stripe_price_id, s.amount_cents, s.status, s.current_period_end, s.created_at, s.updated_at ?? s.created_at]);

    await insert('donations', donations,
      `INSERT INTO donations (id, legacy_id, member_id, stripe_payment_intent_id, amount_cents, public, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
      d => [randomUUID(), d.id, memberUuid.get(d.member_id) ?? null, d.stripe_payment_intent_id, d.amount_cents, d.public ?? 1, d.created_at]);

    await insert('subscribers', subscribers,
      `INSERT INTO subscribers (id, legacy_id, email, first_name, last_name, address, zip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO NOTHING`,
      s => [randomUUID(), s.id, s.email, s.first_name, s.last_name, s.address, s.zip, s.created_at]);

    await insert('processed_events', processedEvents,
      `INSERT INTO processed_events (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      e => [e.id, e.created_at]);

    // ── Verify ──────────────────────────────────────────────────────────────
    const counts = {};
    for (const t of ['members', 'subscriptions', 'donations', 'subscribers', 'processed_events']) {
      counts[t] = (await client.query(`SELECT COUNT(*)::int AS c FROM ${t}`)).rows[0].c;
    }
    const sum = (await client.query('SELECT COALESCE(SUM(amount_cents), 0)::bigint AS s FROM donations')).rows[0].s;
    console.log(`DSQL: ${JSON.stringify(counts)} donations SUM=${sum}`);
    const expected = { members: members.length, subscriptions: subscriptions.length, donations: donations.length, subscribers: subscribers.length, processed_events: processedEvents.length };
    let ok = Number(sum) === d1TotalCents;
    for (const [t, n] of Object.entries(expected)) {
      if (counts[t] < n) { console.error(`MISMATCH ${t}: DSQL ${counts[t]} < D1 ${n}`); ok = false; }
    }
    if (!ok) { console.error('VERIFICATION FAILED'); process.exit(1); }
    console.log('Verification passed: counts covered and donations SUM matches exactly.');
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
