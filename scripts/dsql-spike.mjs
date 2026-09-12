#!/usr/bin/env node
// dsql-spike.mjs — Phase 0 feature spike against a scratch Aurora DSQL cluster
// (build-spec-aws.md §1.2 / plan Phase 0.6). Proves the Postgres features the
// API port depends on. Run: $env:AWS_PROFILE='uccsite'; node scripts/dsql-spike.mjs <cluster-endpoint>
// Requires: packages/db deps installed (pg, @aws-sdk/dsql-signer).

import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@smithy/core/checksum';
import { HttpRequest } from '@smithy/core/protocols';
import { formatUrl } from '@aws-sdk/core/util';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import pg from 'pg';

const endpoint = process.argv[2];
if (!endpoint) { console.error('usage: node scripts/dsql-spike.mjs <cluster-endpoint>'); process.exit(2); }
const region = 'us-west-2';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // This machine's clock runs ~10-15s ahead of AWS; a SigV4 signature dated in
  // the future is rejected ("Signature not yet current"). DsqlSigner doesn't
  // expose signingDate, so presign the DbConnectAdmin request directly (same
  // construction as @aws-sdk/dsql-signer/Signer.js) with a 60s-backdated
  // signingDate — the token stays valid expiresIn from that date.
  const signer = new SignatureV4({
    service: 'dsql', region, credentials: defaultProvider(), sha256: Sha256,
  });
  const request = new HttpRequest({
    method: 'GET', protocol: 'https:', hostname: endpoint,
    query: { Action: 'DbConnectAdmin' },
    headers: { host: endpoint },
  });
  const presigned = await signer.presign(request, {
    expiresIn: 900, signingDate: new Date(Date.now() - 60_000),
  });
  const token = formatUrl(presigned).replace('https://', '');
  const client = new pg.Client({
    host: endpoint, port: 5432, user: 'admin', database: 'postgres',
    password: token, ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  record('IAM-token connect from Node (pg + dsql-signer)', true);

  const v = await client.query('SELECT version()');
  record('SELECT version()', true, v.rows[0].version.slice(0, 60));

  // DSQL: one DDL statement per transaction — run each individually (autocommit).
  await client.query('DROP TABLE IF EXISTS spike_child');
  await client.query('DROP TABLE IF EXISTS spike_t');

  try {
    await client.query(`CREATE TABLE spike_t (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      n INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
    record('CREATE TABLE with DEFAULT gen_random_uuid() + DEFAULT now()', true);
  } catch (e) { record('CREATE TABLE with volatile defaults', false, e.message); }

  try {
    const r1 = await client.query(
      `INSERT INTO spike_t (email, n) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id`,
      ['a@example.com', 1]);
    const r2 = await client.query(
      `INSERT INTO spike_t (email, n) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id`,
      ['a@example.com', 2]);
    const ok = r1.rowCount === 1 && r2.rowCount === 0;
    record('ON CONFLICT DO NOTHING RETURNING id (rowCount 1 then 0)', ok, `rowCounts ${r1.rowCount},${r2.rowCount}`);
  } catch (e) { record('ON CONFLICT DO NOTHING RETURNING', false, e.message); }

  try {
    const r = await client.query(
      `INSERT INTO spike_t (email, n) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET n = COALESCE(excluded.n, spike_t.n) RETURNING n`,
      ['a@example.com', 42]);
    record('ON CONFLICT DO UPDATE ... excluded.* (COALESCE upsert)', r.rows[0].n === 42, `n=${r.rows[0].n}`);
  } catch (e) { record('ON CONFLICT DO UPDATE excluded.*', false, e.message); }

  try {
    const r = await client.query(`SELECT id, created_at FROM spike_t WHERE email = 'a@example.com'`);
    const ok = !!r.rows[0].id && !!r.rows[0].created_at;
    record('gen_random_uuid()/now() defaults populated', ok, `id=${String(r.rows[0].id).slice(0, 8)}… at=${r.rows[0].created_at.toISOString()}`);
  } catch (e) { record('volatile defaults populated', false, e.message); }

  try {
    await client.query(`CREATE TABLE spike_child (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id UUID REFERENCES spike_t(id)
    )`);
    record('CREATE TABLE with REFERENCES (FK) — DSQL FK support', true);
    try {
      await client.query(`INSERT INTO spike_child (parent_id) VALUES (gen_random_uuid())`);
      record('FK enforcement (orphan insert rejected)', false, 'orphan insert SUCCEEDED — FK not enforced');
    } catch (e) {
      record('FK enforcement (orphan insert rejected)', /foreign key|violates/i.test(e.message), e.message.slice(0, 80));
    }
  } catch (e) { record('CREATE TABLE with REFERENCES (FK)', false, e.message.slice(0, 120)); }

  try {
    await client.query(`SELECT 1 FROM spike_t WHERE email LIKE 'cus_%'`);
    record(`LIKE 'cus_%' pattern`, true);
  } catch (e) { record(`LIKE 'cus_%'`, false, e.message); }

  // 23505 fallback path: plain INSERT duplicate -> unique violation SQLSTATE
  try {
    await client.query(`INSERT INTO spike_t (email, n) VALUES ('a@example.com', 9)`);
    record('duplicate INSERT raises 23505', false, 'no error raised');
  } catch (e) {
    record('duplicate INSERT raises 23505', e.code === '23505', `code=${e.code}`);
  }

  await client.query('DROP TABLE IF EXISTS spike_child');
  await client.query('DROP TABLE IF EXISTS spike_t');
  await client.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('SPIKE ERROR:', e); process.exit(1); });
