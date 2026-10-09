#!/usr/bin/env node
// migrate-petitions.mjs — one-time move of the single petition campaign
// (homepage.petition JSON group) into the petitions table (docs/systems/petition.md,
// docs/decisions/petitions-collection.md). The group becomes ONE row: its
// slug, project and copy, status `open` when it had a headline (else `draft`),
// and `featured` ticked (it was the homepage hero). The homepage column is
// left as it was (nothing reads it any more; it is the pre-migration backup).
//
// Prerequisite: node scripts/migrate-schema.mjs --env <env> (creates petitions,
// grants the API role SELECT on it). Dry run by default; --apply writes the row
// in one transaction with an audit row. Refuses to run when petitions already
// has rows unless --force (which replaces them).
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-petitions.mjs --env staging [--apply] [--force]
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { insertRow } = require('../packages/db/content');
const { PETITION_FIELDS, validatePetition } = require('../packages/db/petitions');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const ACTOR = 'scripts/migrate-petitions';

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
console.log(`[petitions] ${stackName} ${APPLY ? 'APPLY' : 'dry run'}`);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const exists = (await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'petitions'`)).rows[0];
  if (!exists) throw new Error(`petitions table missing: run  node scripts/migrate-schema.mjs --env ${envName}  first`);
  // The pre-collection attached thank-you email was keyed `petition-thanks`;
  // since 2026-10-10 the key is per petition (`petition-thanks:<slug>`). Move
  // it onto the migrated petition. Idempotent; runs even when the row import
  // below is skipped (a second run after the first apply).
  const legacyEmail = (await client.query(`SELECT trigger FROM transactional_emails WHERE trigger = 'petition-thanks'`)).rows[0] || null;
  const already = Number((await client.query('SELECT count(*)::int AS n FROM petitions')).rows[0].n);
  if (already && !FORCE) {
    console.log(`[petitions] petitions already has ${already} row(s) — row import skipped (pass --force to replace them from homepage.petition)`);
    if (legacyEmail) {
      const first = (await client.query('SELECT slug FROM petitions ORDER BY sort_order LIMIT 1')).rows[0];
      console.log(`[petitions] legacy attached email 'petition-thanks' → 'petition-thanks:${first.slug}'`);
      if (APPLY) await client.query(`UPDATE transactional_emails SET trigger = $1 WHERE trigger = 'petition-thanks'`, [`petition-thanks:${first.slug}`]);
      else console.log('[petitions] dry run — re-run with --apply to move it');
    }
    return;
  }

  const hp = (await client.query(`SELECT petition FROM homepage WHERE id = 'singleton'`)).rows[0];
  let group = null;
  try { group = hp?.petition ? JSON.parse(hp.petition) : null; } catch { group = null; }
  if (!group || !String(group.slug || '').trim()) { console.log('[petitions] homepage.petition is empty — nothing to migrate'); return; }

  const row = {};
  for (const f of PETITION_FIELDS) if (group[f] !== undefined && String(group[f]).trim() !== '') row[f] = String(group[f]).trim();
  row.status = String(group.headline || '').trim() ? 'open' : 'draft';
  row.featured = row.status === 'open' ? '1' : '';
  // The ALPR report moved to /projects/alpr/report; the old button link 301s but the row may as well point straight there.
  if (row.cta_secondary_url === '/alpr.html' || row.cta_secondary_url === '/alpr') row.cta_secondary_url = '/projects/alpr/report';
  const projects = (await client.query('SELECT slug, parent_slug FROM projects')).rows;
  const errors = validatePetition(row, { projects });
  if (errors.length) throw new Error(`the campaign group does not make a valid petition: ${errors.join('. ')} — fix homepage.petition first (scripts/patch-homepage-group.mjs)`);
  const sigs = (await client.query('SELECT count(*)::int AS n FROM petition_signatures WHERE petition = $1', [row.slug])).rows[0].n;
  console.log(`[petitions] ${row.slug} → project ${row.project_slug}, status ${row.status}, featured ${row.featured || '-'}; ${sigs} signature(s) already under this slug`);
  for (const [k, v] of Object.entries(row)) console.log(`  ${k.padEnd(26)} ${String(v).slice(0, 80)}`);
  if (!APPLY) { console.log('[petitions] dry run — re-run with --apply to write'); return; }

  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM petitions');
    const id = await insertRow(client, 'petitions', row, { sort_order: 0 });
    if (legacyEmail) {
      await client.query(`UPDATE transactional_emails SET trigger = $1 WHERE trigger = 'petition-thanks'`, [`petition-thanks:${row.slug}`]);
      console.log(`[petitions] legacy attached email 'petition-thanks' → 'petition-thanks:${row.slug}'`);
    }
    await client.query(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), $1, 'petition.create', 'petition', $2, $3)`,
      [ACTOR, id, JSON.stringify({ migration: 'petitions-collection', slug: row.slug, project: row.project_slug, status: row.status })]);
    await client.query('COMMIT');
    console.log(`[petitions] applied: row ${id} written. Next: redeploy the stack (templates + API) and publish from the database.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
});
