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
const { loadContent, replaceCollectionRows, saveSettings, saveHomepage } = require('../packages/db/content');

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

  // projects + children (child rows need the parent's generated id)
  await client.query('DELETE FROM project_articles');
  await client.query('DELETE FROM project_videos');
  await client.query('DELETE FROM projects');
  for (let i = 0; i < repo.projects.projects.length; i++) {
    const p = repo.projects.projects[i];
    const res = await client.query(
      `INSERT INTO projects (id, sort_order, name, slug, date, author, status, status_color, region, tagline, cta_url, cta_text)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [i, p.name ?? null, p.slug ?? null, p.date ?? null, p.author ?? null, p.status ?? null,
       p.status_color ?? null, p.region ?? null, p.tagline ?? null, p.cta_url ?? null, p.cta_text ?? null]);
    const projectId = res.rows[0].id;
    for (let j = 0; j < (p.articles || []).length; j++) {
      const a = p.articles[j];
      await client.query(
        `INSERT INTO project_articles (id, project_id, sort_order, outlet, badge_color, date, region, headline, excerpt, url, read_more, lang_attr)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [projectId, j, a.outlet ?? null, a.badge_color ?? null, a.date ?? null, a.region ?? null,
         a.headline ?? null, a.excerpt ?? null, a.url ?? null, a.read_more ?? null, a.lang_attr ?? null]);
    }
    for (let j = 0; j < (p.videos || []).length; j++) {
      const v = p.videos[j];
      await client.query(
        `INSERT INTO project_videos (id, project_id, sort_order, outlet, badge_color, date, region, headline, youtube_id, youtube_title)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [projectId, j, v.outlet ?? null, v.badge_color ?? null, v.date ?? null, v.region ?? null,
         v.headline ?? null, v.youtube_id ?? null, v.youtube_title ?? null]);
    }
  }

  // Both coverage strips in ONE call (replaceCollectionRows wipes the table).
  const allCoverage = [
    ...repo.coverage.alpr_coverage.map(e => ({ ...e, __key: 'alpr' })),
    ...repo.coverage.stratos_coverage.map(e => ({ ...e, __key: 'stratos' })),
  ];
  await replaceCollectionRows(client, 'coverage_entries', allCoverage, { report_key: (item) => item.__key });

  // ── Round-trip verification ────────────────────────────────────────────
  const loaded = await loadContent(client);
  deepStrictEqual(loaded, repo);
  console.log(`Content migrated to ${stackName} and round-trip verified: DB reproduces content/*.json exactly.`);
});
