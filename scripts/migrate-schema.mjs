#!/usr/bin/env node
// migrate-schema.mjs — apply the operational-table DDL (packages/db/schema.js)
// to an environment's DSQL cluster, then provision the API Lambda's
// least-privilege database role: CREATE ROLE api WITH LOGIN (if missing),
// AWS IAM GRANT api TO '<ApiRoleArn stack output>' (if not mapped), and the
// API_GRANTS. DSQL allows one DDL statement per transaction, so statements
// run individually. Idempotent (IF NOT EXISTS / existence checks / GRANT).
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-schema.mjs --env staging
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { STATEMENTS: OPERATIONAL, API_ROLE, API_GRANTS } = require('../packages/db/schema');
const { STATEMENTS: CONTENT } = require('../packages/db/content-schema');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint', 'ApiRoleArn']);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  for (const ddl of [...OPERATIONAL, ...CONTENT]) {
    const label = ddl.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 70);
    await client.query(ddl);
    console.log(`ok  ${label}`);
  }

  // API role. AWS IAM GRANT takes no bind parameters; the ARN is a stack
  // output, validated before interpolation.
  const arn = outputs.ApiRoleArn;
  if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/.test(arn)) throw new Error(`ApiRoleArn output looks wrong: ${arn}`);
  const roleExists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [API_ROLE])).rowCount > 0;
  if (!roleExists) { await client.query(`CREATE ROLE ${API_ROLE} WITH LOGIN`); console.log(`ok  CREATE ROLE ${API_ROLE}`); }
  else console.log(`ok  role ${API_ROLE} exists`);
  const mapped = (await client.query(
    'SELECT 1 FROM sys.iam_pg_role_mappings WHERE pg_role_name = $1 AND arn = $2', [API_ROLE, arn])).rowCount > 0;
  if (!mapped) { await client.query(`AWS IAM GRANT ${API_ROLE} TO '${arn}'`); console.log(`ok  AWS IAM GRANT ${API_ROLE} TO ${arn}`); }
  else console.log(`ok  ${API_ROLE} already mapped to ${arn}`);
  for (const grant of API_GRANTS) { await client.query(grant); console.log(`ok  ${grant}`); }
});
console.log(`Schema applied to ${stackName} (${outputs.DsqlEndpoint})`);
