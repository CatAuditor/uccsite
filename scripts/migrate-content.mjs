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
const { loadContent, replaceCollectionRows, insertRow, saveSettings, saveHomepage } = require('../packages/db/content');

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
  await saveSettings(client, repo.settings);
  await saveHomepage(client, repo.homepage);
  await replaceCollectionRows(client, 'team_members', repo.team.members);
  await replaceCollectionRows(client, 'statements', repo.statements.statements);
  await replaceCollectionRows(client, 'issues', repo.issues.issues);
  await replaceCollectionRows(client, 'blog_articles', repo.blog.articles);
  await replaceCollectionRows(client, 'blog_videos', repo.blog.videos);

  // projects + children — FIELD_MAPS-driven inserts (insertRow), so a new
  // column is one edit in packages/db, not a hand-synced SQL literal here.
  await client.query('DELETE FROM project_articles');
  await client.query('DELETE FROM project_videos');
  await client.query('DELETE FROM projects');
  for (let i = 0; i < repo.projects.projects.length; i++) {
    const p = repo.projects.projects[i];
    const projectId = await insertRow(client, 'projects', p, { sort_order: i });
    for (let j = 0; j < (p.articles || []).length; j++) {
      await insertRow(client, 'project_articles', p.articles[j], { project_id: projectId, sort_order: j });
    }
    for (let j = 0; j < (p.videos || []).length; j++) {
      await insertRow(client, 'project_videos', p.videos[j], { project_id: projectId, sort_order: j });
    }
  }

  // Coverage strips: one scoped replace per report key.
  await replaceCollectionRows(client, 'coverage_entries', repo.coverage.alpr_coverage, { where: ['report_key', 'alpr'] });
  await replaceCollectionRows(client, 'coverage_entries', repo.coverage.stratos_coverage, { where: ['report_key', 'stratos'] });

  // ── Round-trip verification ────────────────────────────────────────────
  const loaded = await loadContent(client);
  deepStrictEqual(loaded, repo);
  console.log(`Content migrated to ${stackName} and round-trip verified: DB reproduces content/*.json exactly.`);
});
