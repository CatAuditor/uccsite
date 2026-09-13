#!/usr/bin/env node
// migrate-schema.mjs — apply the operational-table DDL (packages/db/schema.js)
// to an environment's DSQL cluster. DSQL allows one DDL statement per
// transaction, so statements run individually. Idempotent (IF NOT EXISTS).
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-schema.mjs --env staging
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { STATEMENTS: OPERATIONAL } = require('../packages/db/schema');
const { STATEMENTS: CONTENT } = require('../packages/db/content-schema');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  for (const ddl of [...OPERATIONAL, ...CONTENT]) {
    const label = ddl.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 70);
    await client.query(ddl);
    console.log(`ok  ${label}`);
  }
});
console.log(`Schema applied to ${stackName} (${outputs.DsqlEndpoint})`);
