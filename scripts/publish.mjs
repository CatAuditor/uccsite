#!/usr/bin/env node
// publish.mjs — drive the publish pipeline (functions/publish/core.js) from
// the repo: render everything with packages/render, collect static files, and
// publish to an environment's bucket + distribution. Pre-Phase-7 the repo IS
// the content source; the Phase 7 admin invokes the same core from a Lambda
// with database content instead.
//
// Usage:
//   $env:AWS_PROFILE='uccsite'; node scripts/publish.mjs --env staging [--trigger manual]
//
// Environment endpoints come from `cdk deploy` outputs; keep these in sync.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';

const require = createRequire(import.meta.url);
const { buildSite, PAGES } = require('../packages/render');
const { publish } = require('../functions/publish/core.js');

const ENVS = {
  staging: {
    bucket: 'uccstaging-sitebucket397a1860-cbr2pmtojv4m',
    distributionId: 'E39TWWGF1FE29Y',
    dsqlEndpoint: 'rjucl37cz3byuiur5vewhazcpq.dsql.us-west-2.on.aws',
  },
  // prod: filled in when UccProd deploys (Phase 6)
};

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const envName = argVal('--env', 'staging');
const trigger = argVal('--trigger', 'manual');
const env = ENVS[envName];
if (!env) { console.error(`Unknown env ${envName}`); process.exit(2); }

const ROOT = join(import.meta.dirname, '..');
const COPY_FROM_ROOT = ['css', 'js', 'assets', 'robots.txt', 'llms.txt', 'favicon.svg', 'UCC.png'];

// Deterministic sitemap lastmod: last git commit date per input file (fs
// mtimes are checkout times in CI). Falls back to today for uncommitted files.
function gitLastmod(page) {
  const files = [join('templates', page.template), ...page.content.map(n => join('content', `${n}.json`))];
  let newest = '';
  for (const f of files) {
    try {
      const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', f], { cwd: ROOT, encoding: 'utf8' }).trim();
      if (iso > newest) newest = iso;
    } catch { /* uncommitted */ }
  }
  return (newest || new Date().toISOString()).slice(0, 10);
}

function collectStatic() {
  const files = new Map();
  const addFile = (abs, key) => files.set(key.replace(/\\/g, '/'), readFileSync(abs));
  const walk = (dir, baseKey) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const key = baseKey ? `${baseKey}/${entry}` : entry;
      if (statSync(abs).isDirectory()) walk(abs, key);
      else addFile(abs, key);
    }
  };
  for (const item of COPY_FROM_ROOT) {
    const abs = join(ROOT, item);
    try {
      if (statSync(abs).isDirectory()) walk(abs, item);
      else addFile(abs, item);
    } catch { /* optional */ }
  }
  const staticDir = join(ROOT, 'static');
  try { walk(staticDir, ''); } catch { /* optional */ }
  return files;
}

function loadRenderInputs() {
  const content = {};
  for (const f of readdirSync(join(ROOT, 'content'))) {
    if (f.endsWith('.json')) content[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(ROOT, 'content', f), 'utf8'));
  }
  const templates = {};
  for (const { template } of PAGES) {
    templates[template] = readFileSync(join(ROOT, 'templates', template), 'utf8');
  }
  const partials = {};
  for (const f of readdirSync(join(ROOT, 'templates', 'partials'))) {
    if (f.endsWith('.html')) partials[f.replace(/\.html$/, '')] = readFileSync(join(ROOT, 'templates', 'partials', f), 'utf8');
  }
  return { templates, partials, content };
}

async function main() {
  const { files, errors } = buildSite({ ...loadRenderInputs(), lastmod: gitLastmod });
  if (errors.length) {
    // Fail-fast (§7): abort before anything is written.
    for (const e of errors) console.error('RENDER ERROR: ' + e);
    process.exit(1);
  }

  const outputs = collectStatic();
  for (const [name, text] of Object.entries(files)) outputs.set(name, Buffer.from(text, 'utf8'));
  console.log(`Rendered ${Object.keys(files).length} files, ${outputs.size} total outputs`);

  const region = 'us-west-2';
  const result = await publish({
    outputs,
    s3: new S3Client({ region }),
    cf: new CloudFrontClient({ region }),
    bucket: env.bucket,
    distributionId: env.distributionId,
    dbConfig: { endpoint: env.dsqlEndpoint, region },
    trigger,
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify({ status: result.status, changed: result.changed.length, removed: result.removed.length, invalidationId: result.invalidationId }));
}

main().catch((e) => { console.error(e); process.exit(1); });
