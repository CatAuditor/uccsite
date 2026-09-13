#!/usr/bin/env node
// admin-env.mjs — write apps/admin/.env.local from a deployed stack's outputs
// so `npm run dev -w @uccsite/admin` talks to that environment.
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/admin-env.mjs --env staging
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveEnv, argValue } from './lib/stack.mjs';

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const { region, outputs } = await resolveEnv(envName,
  ['AdminUserPoolId', 'AdminUserPoolClientId', 'AdminAuthDomain', 'DsqlEndpoint', 'PublishFunctionName']);

const envFile = [
  `UCC_ENV=${envName}`,
  `UCC_REGION=${region}`,
  `COGNITO_POOL_ID=${outputs.AdminUserPoolId}`,
  `COGNITO_CLIENT_ID=${outputs.AdminUserPoolClientId}`,
  `COGNITO_DOMAIN=${outputs.AdminAuthDomain}`,
  `DSQL_ENDPOINT=${outputs.DsqlEndpoint}`,
  `PUBLISH_FUNCTION_NAME=${outputs.PublishFunctionName}`,
  `APP_ORIGIN=http://localhost:3000`,
  '',
].join('\n');

const out = join(import.meta.dirname, '..', 'apps', 'admin', '.env.local');
writeFileSync(out, envFile);
console.log(`Wrote ${out} for ${envName}`);
