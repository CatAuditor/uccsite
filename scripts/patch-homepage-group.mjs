#!/usr/bin/env node
// patch-homepage-group.mjs — set ONE OR MORE fields inside a homepage group
// in an environment's database without touching the rest of the group (the
// seed script replaces the whole group, which would clobber prod's edited
// copy). Used 2026-10-09 to file the live petition under its project
// (homepage.petition.project_slug = alpr) on staging and prod; anything an
// editor could type into the admin's field is a valid value. Writes an audit
// row (action homepage.patch, actor = --actor or 'script').
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/patch-homepage-group.mjs --env staging --group petition --set project_slug=alpr [--set k=v ...] [--actor you@example.org]
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { HOMEPAGE_GROUP_COLS, loadHomepage, saveHomepage } = require('../packages/db/content');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const group = argValue(args, '--group');
const actor = argValue(args, '--actor', 'script');
const sets = args.flatMap((a, i) => (a === '--set' && args[i + 1] ? [args[i + 1]] : []));
if (!HOMEPAGE_GROUP_COLS.some(([, key]) => key === group)) {
  console.error(`--group must be one of: ${HOMEPAGE_GROUP_COLS.map(([, k]) => k).join(', ')}`); process.exit(2);
}
const patch = {};
for (const kv of sets) {
  const eq = kv.indexOf('=');
  const key = eq > 0 ? kv.slice(0, eq).trim() : '';
  if (!/^[a-z][a-z0-9_]*$/.test(key)) { console.error(`--set needs field=value (got "${kv}")`); process.exit(2); }
  patch[key] = kv.slice(eq + 1);
}
if (!Object.keys(patch).length) { console.error('nothing to set: pass --set field=value'); process.exit(2); }

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const current = await loadHomepage(client);
  const before = current[group] || {};
  const next = { ...before };
  for (const [k, v] of Object.entries(patch)) { if (v === '') delete next[k]; else next[k] = v; }
  await client.query('BEGIN');
  try {
    await saveHomepage(client, { ...current, [group]: next }, { tx: false });
    await client.query(
      `INSERT INTO revisions (id, entity_type, entity_id, snapshot, author)
       VALUES (gen_random_uuid(), 'homepage', 'singleton', $1, $2)`,
      [JSON.stringify(current), actor],
    );
    await client.query(
      `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff)
       VALUES (gen_random_uuid(), $1, 'homepage.patch', 'homepage', 'singleton', $2)`,
      [actor, JSON.stringify({ group, before, after: next })],
    );
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
  for (const [k, v] of Object.entries(patch)) console.log(`${stackName}: homepage.${group}.${k}: ${JSON.stringify(before[k] ?? null)} -> ${JSON.stringify(v === '' ? null : v)}`);
});
