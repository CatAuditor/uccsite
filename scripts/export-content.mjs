#!/usr/bin/env node
// export-content.mjs — write an environment's content tables to a directory
// in the §14.2 export layout (content/*.json + manifest.json), using the SAME
// builder as the nightly export Lambda (aws/export-content). Feeds the
// restore drill (scripts/restore-from-export.mjs) and any ad-hoc backup.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/export-content.mjs --env staging --out ./export-staging
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { loadContent } = require('../packages/db/content');
const { buildContentExport } = require('../packages/db/export');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const outDir = resolve(argValue(args, '--out', `./export-${envName}`));

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
const content = await withConnection({ endpoint: outputs.DsqlEndpoint, region }, (client) => loadContent(client));
const files = buildContentExport(content);
for (const [path, text] of files) {
  const abs = join(outDir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}
console.log(`Exported ${files.size} files from ${stackName} to ${outDir}`);
