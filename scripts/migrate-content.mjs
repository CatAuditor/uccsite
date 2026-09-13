#!/usr/bin/env node
// migrate-content.mjs — load content/*.json into an environment's DSQL
// content tables (build-spec-aws.md §18 step 5), then read everything back
// through packages/db/content.js and DEEP-COMPARE against the repo JSON.
// The round-trip check is the point: if the DB can't reproduce the exact
// shapes the renderer consumes, the migration fails loudly here, not as a
// subtle page diff after cutover.
//
// Re-runnable: list tables are wipe-and-load; singletons upsert.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-content.mjs --env staging
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { deepStrictEqual } from 'node:assert';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { loadContent, saveContent } = require('../packages/db/content');

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');

const json = (name) => JSON.parse(readFileSync(join(ROOT, 'content', `${name}.json`), 'utf8'));
const repo = {
  settings: json('settings'),
  homepage: json('homepage'),
  team: json('team'),
  statements: json('statements'),
  issues: json('issues'),
  blog: json('blog'),
  projects: json('projects'),
  coverage: json('coverage'),
};

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  // saveContent is the shared write path (also restore-from-export.mjs).
  await saveContent(client, repo);

  // ── Round-trip verification ────────────────────────────────────────────
  const loaded = await loadContent(client);
  deepStrictEqual(loaded, repo);
  console.log(`Content migrated to ${stackName} and round-trip verified: DB reproduces content/*.json exactly.`);
});
