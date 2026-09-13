#!/usr/bin/env node
// restore-from-export.mjs — load a §14.2 export directory (a git checkout of
// the export branch, or scripts/export-content.mjs output) into an
// environment's content tables, then read everything back and DEEP-COMPARE
// against the files. Same write path as the initial migration
// (packages/db/content.js saveContent) — a restore can't drift from what the
// migration proved round-trips. Wipe-and-load: the target's current content
// is REPLACED. Publish afterwards to make it live.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/restore-from-export.mjs --env staging --from ./export-staging
//        (--from defaults to the repo's own content/ directory)
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { deepStrictEqual } from 'node:assert';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { loadContent, saveContent } = require('../packages/db/content');
const { COLLECTIONS, SCHEMA_VERSION } = require('../packages/db/export');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const fromDir = resolve(argValue(args, '--from', join(import.meta.dirname, '..')));
if (envName === 'prod' && !args.includes('--i-mean-prod')) {
  console.error('Refusing to wipe-and-load PROD content without --i-mean-prod');
  process.exit(2);
}

const manifestPath = join(fromDir, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== SCHEMA_VERSION) {
    console.error(`Export schema_version ${manifest.schema_version} != expected ${SCHEMA_VERSION}`);
    process.exit(2);
  }
  console.log(`Export from ${manifest.exported_at}: ${JSON.stringify(manifest.counts)}`);
} else {
  console.log('No manifest.json — treating the directory as a plain content/ checkout');
}

const repo = {};
for (const name of COLLECTIONS) {
  const p = join(fromDir, 'content', `${name}.json`);
  if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); }
  repo[name] = JSON.parse(readFileSync(p, 'utf8'));
}

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  await saveContent(client, repo);
  const loaded = await loadContent(client);
  deepStrictEqual(loaded, repo);
  console.log(`Restored ${fromDir} into ${stackName} and round-trip verified. Publish to make it live.`);
});
