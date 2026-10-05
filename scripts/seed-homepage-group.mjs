#!/usr/bin/env node
// seed-homepage-group.mjs — copy ONE group of content/homepage.json (e.g. the
// petition campaign copy) into an environment's homepage singleton. Fills an
// empty (NULL) column only, unless --force; never touches other groups or
// the press list. Use it to seed staging after a schema change added a
// group; prod copy normally comes from the admin's editor.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/seed-homepage-group.mjs --env staging --group petition [--force]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { HOMEPAGE_GROUP_COLS, loadHomepage, saveHomepage } = require('../packages/db/content');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const group = argValue(args, '--group');
const force = args.includes('--force');
const col = HOMEPAGE_GROUP_COLS.find(([, key]) => key === group);
if (!col) { console.error(`--group must be one of: ${HOMEPAGE_GROUP_COLS.map(([, k]) => k).join(', ')}`); process.exit(2); }

const repo = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'content', 'homepage.json'), 'utf8'));
if (!repo[group]) { console.error(`content/homepage.json has no "${group}" group`); process.exit(2); }

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const current = await loadHomepage(client);
  if (current[group] && !force) {
    console.log(`${stackName}: homepage.${group} already set (${Object.keys(current[group]).length} fields) — pass --force to overwrite`);
    return;
  }
  await saveHomepage(client, { ...current, [group]: repo[group] });
  console.log(`${stackName}: homepage.${group} seeded from content/homepage.json (${Object.keys(repo[group]).length} fields)`);
});
