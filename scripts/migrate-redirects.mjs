#!/usr/bin/env node
// migrate-redirects.mjs — seed the redirects table from infra/cdk/kvs/
// redirects.json (the KeyValueStore's deploy-time seed). Run once per
// environment; after that the admin's Redirects page is the source of truth
// and every publish syncs the store. Idempotent (skips existing paths).
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-redirects.mjs --env staging
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { listRedirects, upsertRedirect } = require('../packages/db/redirects');

const envName = argValue(process.argv.slice(2), '--env', 'staging');
const seed = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'infra', 'cdk', 'kvs', 'redirects.json'), 'utf8')).data;
const { region, outputs, stackName } = await resolveEnv(envName, ['DsqlEndpoint']);
await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const existing = new Set((await listRedirects(client)).map(r => r.fromPath));
  for (const { key, value } of seed) {
    if (existing.has(key)) { console.log(`skip ${key} (exists)`); continue; }
    const v = JSON.parse(value);
    await upsertRedirect(client, { fromPath: key, toUrl: v.to, statusCode: v.status || 302, active: true, note: 'seeded from infra/cdk/kvs/redirects.json' });
    console.log(`added ${key} → ${v.to} (${v.status || 302})`);
  }
});
console.log(`Redirects seeded in ${stackName}.`);
