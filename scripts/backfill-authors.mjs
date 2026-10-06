#!/usr/bin/env node
// backfill-authors.mjs — one-time data step for author pages
// (docs/systems/author-pages.md): after migrate-schema.mjs adds
// documents.author, set the author on the migrated long-form Documents and
// turn their plain-text "By <name>" byline into a link to /team/<slug>.
// Idempotent: only rows with an empty author / an unlinked byline change.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/backfill-authors.mjs --env staging [--dry-run]
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { slugify } = require('../packages/render/site');

// slug → author (docs/systems/bylines.md: projects → Conner, statements → Clark,
// the ALPR policy paper → Jarom). privacy-report / theory / privacy stay unbylined.
const AUTHORS = {
  alpr: 'Conner Radcliffe',
  stratos: 'Conner Radcliffe',
  'weber-county': 'Conner Radcliffe',
  'how-did-this-happen': 'Jarom Gillins',
  'dignity-index-statement': 'Clark Dice',
};

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const dryRun = args.includes('--dry-run');
const { stackName, region, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const { rows } = await client.query('SELECT id, slug, author, body_html_raw FROM documents ORDER BY slug');
  for (const row of rows) {
    const author = AUTHORS[row.slug];
    if (!author) { console.log(`--  ${row.slug}: no author mapping (unbylined)`); continue; }
    const slug = slugify(author);
    let body = row.body_html_raw || '';
    // "By Conner Radcliffe" / "By Jarom Gillins, Director of Policy" inside the
    // existing .release-author span → linked name, rest of the text kept.
    const re = new RegExp(`(<span class="release-author">By )(${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![^<]*</a>)`, 'g');
    body = body.replace(re, `$1<a href="/team/${slug}">$2</a>`);
    const setAuthor = (row.author || '').trim() !== author;
    const setBody = body !== (row.body_html_raw || '');
    if (!setAuthor && !setBody) { console.log(`ok  ${row.slug}: already ${author}, byline linked`); continue; }
    console.log(`${dryRun ? 'DRY' : 'set'} ${row.slug}: author=${author}${setBody ? ', byline linked' : ''}`);
    if (dryRun) continue;
    await client.query('UPDATE documents SET author = $2, body_html_raw = $3, updated_at = now() WHERE id = $1', [row.id, author, body]);
  }
});
console.log(`Done (${stackName})${dryRun ? ' — dry run, nothing written' : ''}`);
