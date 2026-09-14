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
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { buildSite } = require('../packages/render');
const { publish } = require('../aws/publish/core.js');
const { loadRenderInputs, collectStaticFiles, gitLastmodProvider } = require('../aws/publish/inputs.js');
const { withConnection } = require('../packages/db');
const { loadSiteFromDb, renderSiteFromDb, recordDocumentPublish, publishRedirects } = require('../aws/publish/render-db.js');
const { SITE_URL } = require('../packages/render/site');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const trigger = argValue(args, '--trigger', 'manual');
const allowBulkDelete = args.includes('--allow-bulk-delete');
// --source db: content comes from the environment's DSQL content tables
// (Phase 7 source of truth) instead of content/*.json. Templates, partials,
// and static files always come from the repo.
const source = argValue(args, '--source', envName === 'prod' ? undefined : 'git');
if (!['git', 'db'].includes(source)) {
  console.error(source === undefined
    ? 'Prod publishes must state their content source explicitly: --source git | --source db. '
      + 'After the content cutover, git-source publishes would overwrite admin edits with stale repo JSON.'
    : `Unknown --source "${source}" (use: git, db)`);
  process.exit(2);
}

const ROOT = join(import.meta.dirname, '..');

async function main() {
  // git source: render FIRST so build breakage reports without needing AWS
  // credentials; db source inherently needs the stack resolved up front.
  const errors = [];
  const inputs = loadRenderInputs(ROOT, (msg) => errors.push(msg), { includeContent: source === 'git' });
  let stack, region, stackName;
  const outputs = collectStaticFiles(ROOT);
  let files, renderErrors = [], rendered = null, dbConfig = null;
  if (source === 'db') {
    // Same code path as the publish Lambda (aws/publish/render-db.js):
    // collections + Documents, Documents replacing same-slug templates.
    ({ region, stackName, outputs: stack } = await resolveEnv(envName, ['SiteBucketName', 'DistributionId', 'DsqlEndpoint', 'RedirectStoreArn']));
    dbConfig = { endpoint: stack.DsqlEndpoint, region };
    const db = await withConnection(dbConfig, loadSiteFromDb);
    const siteCss = outputs.get('css/styles.css')?.toString('utf8') || '';
    rendered = errors.length ? { files: {}, errors: [] } : renderSiteFromDb({ inputs, siteCss, ...db, siteUrl: SITE_URL });
    ({ files, errors: renderErrors } = rendered);
    console.log(`[publish] content source: database (${db.bundle.documents.length} documents)`);
  } else {
    ({ files, errors: renderErrors } = errors.length ? { files: {}, errors: [] } : buildSite({ ...inputs, lastmod: gitLastmodProvider(ROOT) }));
  }
  const allErrors = [...errors, ...renderErrors];
  if (allErrors.length) {
    // Fail-fast (§7): abort before anything is written.
    for (const e of allErrors) console.error('RENDER ERROR: ' + e);
    if (rendered && dbConfig) await withConnection(dbConfig, (client) => recordDocumentPublish(client, { ...rendered, errors: allErrors })).catch(() => {});
    process.exit(1);
  }

  for (const [name, text] of Object.entries(files)) outputs.set(name, Buffer.from(text, 'utf8'));
  console.log(`Rendered ${Object.keys(files).length} files, ${outputs.size} total outputs`);

  if (source === 'git') {
    ({ region, stackName, outputs: stack } = await resolveEnv(envName, ['SiteBucketName', 'DistributionId', 'DsqlEndpoint']));
  }
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
  if (rendered && dbConfig) {
    await withConnection(dbConfig, (client) => recordDocumentPublish(client, rendered));
    // Pages are live at this point; a redirect-sync failure is reported, not fatal.
    await withConnection(dbConfig, (client) => publishRedirects({ client, kvsArn: stack.RedirectStoreArn, region, log: (m) => console.log(`[publish] ${m}`) }))
      .catch((err) => console.error(`[publish] WARNING: redirects sync failed: ${err.message}`));
  }
  console.log(JSON.stringify({ status: result.status, changed: result.changed.length, removed: result.removed.length, invalidationId: result.invalidationId }));
}

main().catch((e) => { console.error(e); process.exit(1); });
