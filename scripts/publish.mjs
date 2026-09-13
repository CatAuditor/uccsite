#!/usr/bin/env node
// publish.mjs — drive the publish pipeline (aws/publish/core.js) from the
// repo: render everything with packages/render, collect static files, publish
// to an environment's bucket + distribution. Pre-Phase-7 the repo IS the
// content source; the Phase 7 admin invokes the same core from a Lambda with
// database content instead.
//
// Environment endpoints resolve AT RUN TIME from the CloudFormation stack's
// outputs (UccStaging / UccProd) — nothing hardcoded, so a stack replacement
// or the prod stack's first deploy needs no code change here.
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; node scripts/publish.mjs --env staging
//     [--trigger manual] [--allow-bulk-delete]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const require = createRequire(import.meta.url);
const { buildSite } = require('../packages/render');
const { publish } = require('../aws/publish/core.js');
const { loadRenderInputs, collectStaticFiles, gitLastmodProvider } = require('../aws/publish/inputs.js');

const STACKS = { staging: 'UccStaging', prod: 'UccProd' };

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const envName = argVal('--env', 'staging');
const trigger = argVal('--trigger', 'manual');
const allowBulkDelete = args.includes('--allow-bulk-delete');
const stackName = STACKS[envName];
if (!stackName) { console.error(`Unknown env ${envName} (use: ${Object.keys(STACKS).join(', ')})`); process.exit(2); }

const ROOT = join(import.meta.dirname, '..');

async function resolveStack(region) {
  const cfn = new CloudFormationClient({ region });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = Object.fromEntries((res.Stacks[0].Outputs || []).map(o => [o.OutputKey, o.OutputValue]));
  for (const key of ['SiteBucketName', 'DistributionId', 'DsqlEndpoint']) {
    if (!outputs[key]) throw new Error(`Stack ${stackName} is missing output ${key}`);
  }
  return outputs;
}

async function main() {
  const errors = [];
  const inputs = loadRenderInputs(ROOT, (msg) => errors.push(msg));
  const { files, errors: renderErrors } = errors.length
    ? { files: {}, errors }
    : buildSite({ ...inputs, lastmod: gitLastmodProvider(ROOT) });
  const allErrors = [...errors, ...renderErrors];
  if (allErrors.length) {
    // Fail-fast (§7): abort before anything is written.
    for (const e of allErrors) console.error('RENDER ERROR: ' + e);
    process.exit(1);
  }

  const outputs = collectStaticFiles(ROOT);
  for (const [name, text] of Object.entries(files)) outputs.set(name, Buffer.from(text, 'utf8'));
  console.log(`Rendered ${Object.keys(files).length} files, ${outputs.size} total outputs`);

  const region = 'us-west-2';
  const stack = await resolveStack(region);
  console.log(`[publish] target ${stackName}: bucket=${stack.SiteBucketName} distribution=${stack.DistributionId}`);

  const result = await publish({
    outputs,
    s3: new S3Client({ region }),
    cf: new CloudFrontClient({ region }),
    bucket: stack.SiteBucketName,
    distributionId: stack.DistributionId,
    dbConfig: { endpoint: stack.DsqlEndpoint, region },
    trigger,
    allowBulkDelete,
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify({ status: result.status, changed: result.changed.length, removed: result.removed.length, invalidationId: result.invalidationId }));
}

main().catch((e) => { console.error(e); process.exit(1); });
