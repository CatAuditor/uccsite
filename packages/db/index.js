'use strict';
// Aurora DSQL connection helper (build-spec-aws.md §9, ADR
// docs/decisions/aws-datastore-dsql.md). Phase 4 ships the minimal surface the
// publish pipeline needs; Phase 5 grows the query layer for the API port.
//
// DSQL constraints honored here: IAM auth token per connection, TLS required,
// connections killed at 1 hour (callers open short-lived connections), one DDL
// statement per transaction (run DDL statements individually).
const { SignatureV4 } = require('@smithy/signature-v4');
const { Sha256 } = require('@smithy/core/checksum');
const { HttpRequest } = require('@smithy/core/protocols');
const { formatUrl } = require('@aws-sdk/core/util');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const pg = require('pg');

// Some dev machines run ahead of AWS clocks; a future-dated SigV4 presign is
// rejected ("Signature not yet current"). @aws-sdk/dsql-signer doesn't expose
// signingDate, so presign the DbConnect(Admin) request directly (same
// construction as its Signer.js) with a 60s-backdated signingDate — the token
// stays valid for its full expiry from that date. Lambda clocks don't need
// this but it's harmless there.
//
// The `admin` role needs a DbConnectAdmin token (IAM dsql:DbConnectAdmin);
// every custom role (e.g. the API Lambda's least-privilege `api` role,
// schema.js API_ROLE) needs a DbConnect token (IAM dsql:DbConnect).
async function authToken(endpoint, region, user = 'admin') {
  const signer = new SignatureV4({
    service: 'dsql', region, credentials: defaultProvider(), sha256: Sha256,
  });
  const request = new HttpRequest({
    method: 'GET', protocol: 'https:', hostname: endpoint,
    query: { Action: user === 'admin' ? 'DbConnectAdmin' : 'DbConnect' },
    headers: { host: endpoint },
  });
  const presigned = await signer.presign(request, {
    expiresIn: 900, signingDate: new Date(Date.now() - 60_000),
  });
  return formatUrl(presigned).replace('https://', '');
}

// connect({ endpoint, region, user }) → connected pg.Client. Caller must end() it.
// user defaults to 'admin' (scripts, publish, export, admin app); the API
// Lambda passes its custom role.
async function connect({ endpoint, region = process.env.AWS_REGION || 'us-west-2', user = 'admin' }) {
  const client = new pg.Client({
    host: endpoint,
    port: 5432,
    user,
    database: 'postgres',
    password: await authToken(endpoint, region, user),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

// withConnection(cfg, fn) — open, run, always close.
async function withConnection(cfg, fn) {
  const client = await connect(cfg);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Retry wrapper for DSQL optimistic-concurrency aborts (SQLSTATE 40001 / OC000).
// Retries are logged — a run that retried twice must look different in
// CloudWatch from one that sailed through.
async function withRetry(fn, { attempts = 3, baseDelayMs = 100 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.code !== '40001') throw err;
      console.warn(`[db] 40001 optimistic-concurrency abort, retry ${i + 1}/${attempts - 1}`);
      await new Promise(r => setTimeout(r, baseDelayMs * (i + 1) + Math.random() * baseDelayMs));
    }
  }
  console.error(`[db] giving up after ${attempts} attempts: ${lastErr.message}`);
  throw lastErr;
}

// Warm-invocation connection cache for Lambdas: reuses one client across
// invocations, refreshed before DSQL's 1-hour kill and replaced on error.
// makeCachedClient(cfg) → { query(text, params), end() }
// - An idle cached pg.Client can emit 'error' between invocations (dropped
//   TCP); with no listener that kills the whole Node process, so every cached
//   client gets one that just drops it from the cache.
// - 40001 optimistic-concurrency aborts are retried here (the transaction
//   applied nothing, so single-statement retries are safe) — DSQL raises
//   these routinely and the D1-era code never saw them.
function makeCachedClient(cfg, { maxAgeMs = 50 * 60 * 1000 } = {}) {
  let client = null;
  let bornAt = 0;
  async function drop() {
    const c = client;
    client = null;
    if (c) { try { await c.end(); } catch {} }
  }
  async function get() {
    if (client && Date.now() - bornAt < maxAgeMs) return client;
    await drop();
    const c = await connect(cfg);
    c.on('error', (err) => {
      console.warn(`[db] cached connection errored (${err.message}); dropping`);
      if (client === c) client = null;
    });
    client = c;
    bornAt = Date.now();
    return client;
  }
  return {
    query(text, params) {
      return withRetry(async () => {
        try {
          return await (await get()).query(text, params);
        } catch (err) {
          if (err.severity || err.code === '40001') throw err; // SQL-level errors pass to withRetry/caller
          await drop(); // connection-level failure: reconnect and retry once
          return (await get()).query(text, params);
        }
      });
    },
    end: drop,
  };
}

// insertChunked(client, sql, rows, toParams, { chunk }) → inserted count.
// THE bulk-insert loop for DSQL (3,000-row DML cap → default 500-row
// transactions, 40001 retries re-running only the failed chunk). Rows are
// sent as multi-row VALUES batches — one round trip per chunk, not per row.
// `sql` is a template containing the literal token /*VALUES*/ where the
// placeholder tuples go, e.g.:
//   INSERT INTO t (a, b) VALUES /*VALUES*/ ON CONFLICT (a) DO NOTHING
async function insertChunked(client, sql, rows, toParams, { chunk = 500 } = {}) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const tupleSql = slice.map((row) =>
      '(' + toParams(row).map((v) => { params.push(v); return `$${params.length}`; }).join(', ') + ')'
    ).join(', ');
    // One multi-row INSERT per chunk — its own implicit transaction, so a
    // 40001 retry replays just this chunk and ON CONFLICT keeps it idempotent.
    await withRetry(async () => {
      const res = await client.query(sql.replace('/*VALUES*/', tupleSql), params);
      inserted += res.rowCount;
    });
  }
  return inserted;
}

module.exports = { authToken, connect, withConnection, withRetry, makeCachedClient, insertChunked };
