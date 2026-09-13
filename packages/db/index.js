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
// signingDate, so presign the DbConnectAdmin request directly (same
// construction as its Signer.js) with a 60s-backdated signingDate — the token
// stays valid for its full expiry from that date. Lambda clocks don't need
// this but it's harmless there.
async function authToken(endpoint, region) {
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
  return formatUrl(presigned).replace('https://', '');
}

// connect({ endpoint, region }) → connected pg.Client. Caller must end() it.
async function connect({ endpoint, region = process.env.AWS_REGION || 'us-west-2' }) {
  const client = new pg.Client({
    host: endpoint,
    port: 5432,
    user: 'admin',
    database: 'postgres',
    password: await authToken(endpoint, region),
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
async function withRetry(fn, { attempts = 3, baseDelayMs = 100 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.code !== '40001') throw err;
      await new Promise(r => setTimeout(r, baseDelayMs * (i + 1) + Math.random() * baseDelayMs));
    }
  }
  throw lastErr;
}

module.exports = { connect, withConnection, withRetry };
