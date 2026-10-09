#!/usr/bin/env node
// migrate-press.mjs — one-time unification of the four press sources into the
// press table (docs/systems/press.md, docs/decisions/press-unification.md):
// project_articles + project_videos (per project), coverage_entries (per
// report key = project slug), blog_articles + blog_videos (News & Media),
// homepage_press (the three homepage cards). The same story in several
// places becomes ONE row (packages/db/press.js unifyPress: dedupe by URL /
// YouTube id, first source sets the fields, later ones fill blanks, a project
// source sets project_slug, the homepage source sets featured). Newest first.
//
// Prerequisite: node scripts/migrate-schema.mjs --env <env> (creates press).
// Dry run by default prints every resulting row with its sources; --apply
// writes the rows in one transaction, EMPTIES the six legacy tables (their
// DDL stays until a later cleanup) and records an audit row with a snapshot
// of what they held. Refuses to run when press already has rows unless
// --force (which replaces them).
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-press.mjs --env staging [--apply] [--force]
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { list, rowToObject, insertRow } = require('../packages/db/content');
const { unifyPress } = require('../packages/db/press');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const ACTOR = 'scripts/migrate-press';
const LEGACY = ['project_articles', 'project_videos', 'coverage_entries', 'blog_articles', 'blog_videos', 'homepage_press'];

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
console.log(`[press] ${stackName} ${APPLY ? 'APPLY' : 'dry run'}`);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const exists = (await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'press'`)).rows[0];
  if (!exists) throw new Error(`press table missing: run  node scripts/migrate-schema.mjs --env ${envName}  first`);
  const already = Number((await client.query('SELECT count(*)::int AS n FROM press')).rows[0].n);
  if (already && !FORCE) throw new Error(`press already has ${already} row(s); pass --force to replace them from the legacy tables`);

  // Legacy sources, in the shapes unifyPress expects.
  const projectRows = (await client.query('SELECT id, slug FROM projects ORDER BY sort_order')).rows;
  const byProject = async (table) => {
    const rows = (await client.query(`SELECT * FROM ${table} ORDER BY project_id, sort_order`)).rows;
    const map = new Map();
    for (const r of rows) (map.get(r.project_id) || map.set(r.project_id, []).get(r.project_id)).push(rowToObject(table, r));
    return map;
  };
  const arts = await byProject('project_articles');
  const vids = await byProject('project_videos');
  const projects = projectRows.map(p => ({ slug: p.slug, articles: arts.get(p.id) || [], videos: vids.get(p.id) || [] }));
  const coverageRows = (await client.query('SELECT * FROM coverage_entries ORDER BY report_key, sort_order')).rows;
  const coverage = {};
  for (const r of coverageRows) (coverage[`${r.report_key}_coverage`] ??= []).push(rowToObject('coverage_entries', r));
  const blog = { articles: await list(client, 'blog_articles'), videos: await list(client, 'blog_videos') };
  const homepagePress = await list(client, 'homepage_press');
  let legacyCount = projects.reduce((n, p) => n + p.articles.length + p.videos.length, 0) + coverageRows.length + blog.articles.length + blog.videos.length + homepagePress.length;
  let sourcesIn = { projects, blog, coverage, homepagePress };
  if (!legacyCount) {
    // Already applied once (the legacy tables are empty): re-run from the
    // snapshot the first run kept, so a merge-rule fix can be re-applied.
    const rev = (await client.query(`SELECT snapshot FROM revisions WHERE entity_type = 'press-legacy' AND entity_id = 'collection' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    if (rev) {
      sourcesIn = JSON.parse(rev.snapshot);
      legacyCount = (sourcesIn.projects || []).reduce((n, p) => n + (p.articles || []).length + (p.videos || []).length, 0)
        + Object.values(sourcesIn.coverage || {}).reduce((n, l) => n + l.length, 0) + (sourcesIn.blog?.articles || []).length + (sourcesIn.blog?.videos || []).length + (sourcesIn.homepagePress || []).length;
      console.log(`[press] legacy tables are empty — using the press-legacy snapshot kept by the first run (${legacyCount} rows)`);
    }
  }

  const { items, sources, report } = unifyPress(sourcesIn);
  console.log(`[press] ${legacyCount} legacy row(s) → ${items.length} press row(s)`);
  for (const line of report) console.log(`  ! ${line}`);
  items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}. ${(it.type || 'article').padEnd(7)} ${(it.project_slug || '-').padEnd(10)} ${it.featured ? 'HOME ' : '     '}${(it.date || '').padEnd(18)} ${String(it.headline || '').slice(0, 64)}  <= ${sources[i].join(', ')}`));
  if (!APPLY) { console.log('[press] dry run — re-run with --apply to write'); return; }
  if (!legacyCount) { console.log('[press] nothing to migrate: legacy tables empty and no snapshot'); return; }

  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM press');
    for (let i = 0; i < items.length; i++) await insertRow(client, 'press', items[i], { sort_order: i });
    const snapshot = sourcesIn;
    for (const table of LEGACY) await client.query(`DELETE FROM ${table}`);
    await client.query(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), $1, 'press.save', 'press', 'collection', $2)`,
      [ACTOR, JSON.stringify({ migration: 'press-unification', legacyRows: legacyCount, rows: items.length, report })]);
    await client.query(`INSERT INTO revisions (id, entity_type, entity_id, snapshot, author) VALUES (gen_random_uuid(), 'press-legacy', 'collection', $1, $2)`, [JSON.stringify(snapshot), ACTOR]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  console.log(`[press] applied: ${items.length} row(s) written, legacy tables emptied (snapshot kept in revisions as press-legacy/collection). Next: publish from the database.`);
});
