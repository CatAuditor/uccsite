#!/usr/bin/env node
// migrate-schema.mjs — apply the operational-table DDL (packages/db/schema.js)
// to an environment's DSQL cluster. DSQL allows one DDL statement per
// transaction, so statements run individually. Idempotent (IF NOT EXISTS).
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-schema.mjs --env staging
import { createRequire } from 'node:module';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { STATEMENTS } = require('../packages/db/schema');

const STACKS = { staging: 'UccStaging', prod: 'UccProd' };
const args = process.argv.slice(2);
const envName = args[args.indexOf('--env') + 1] || 'staging';
const stackName = STACKS[envName];
if (!stackName) { console.error(`Unknown env ${envName}`); process.exit(2); }

const region = 'us-west-2';
const cfn = new CloudFormationClient({ region });
const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
const endpoint = (res.Stacks[0].Outputs || []).find(o => o.OutputKey === 'DsqlEndpoint')?.OutputValue;
if (!endpoint) { console.error('No DsqlEndpoint output'); process.exit(1); }

await withConnection({ endpoint, region }, async (client) => {
  for (const ddl of STATEMENTS) {
    const label = ddl.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 70);
    await client.query(ddl);
    console.log(`ok  ${label}`);
  }
});
console.log(`Schema applied to ${stackName} (${endpoint})`);
