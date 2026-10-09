#!/usr/bin/env node
// migrate-project-tree.mjs — one-time data migration for the project tree
// (docs/decisions/project-tree-nested-urls.md, docs/systems/projects.md):
//
//   1. the "weber-county" project is deleted (its press moves to alpr): the
//      Weber County complaint is a document OF the license-plate
//      investigation, not a project;
//   2. the migrated reports get their project and a short path so every link
//      the press has printed keeps working as a 301 to the nested URL:
//        /alpr                      → /projects/alpr/report       (slug alpr → report)
//        /stratos                   → /projects/stratos/report    (slug stratos → report)
//        /weber-county              → /projects/alpr/weber-county
//        /how-did-this-happen       → /projects/alpr/how-did-this-happen
//        /license-plate-has-a-price → /projects/alpr/license-plate-has-a-price
//   3. the two projects' buttons point at their reports' new addresses;
//   4. every published document records its current address as live_path, so
//      a later move emits a redirect from it.
//
// Prerequisite: node scripts/migrate-schema.mjs --env <env> (adds the columns
// and the project_notes table). Dry run by default; --apply writes, in one
// transaction, with a revision + audit row per changed document. Idempotent:
// steps already done are reported and skipped. Nothing reaches the site until
// the next publish (scripts/publish.mjs --env <env> --source db, or the admin).
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/migrate-project-tree.mjs --env staging [--apply]
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';

const require = createRequire(import.meta.url);
const { withConnection } = require('../packages/db');
const { loadProjects } = require('../packages/db/content');
const { listDocuments } = require('../packages/db/documents');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const APPLY = args.includes('--apply');
const ACTOR = 'scripts/migrate-project-tree';

// Current slug → where it goes. `slug` renames the document (absent = keep).
const DOCUMENT_MOVES = {
  'alpr': { project: 'alpr', slug: 'report' },
  'stratos': { project: 'stratos', slug: 'report' },
  'weber-county': { project: 'alpr' },
  'how-did-this-happen': { project: 'alpr' },
  'license-plate-has-a-price': { project: 'alpr' },
};
const DROP_PROJECT = { slug: 'weber-county', pressTo: 'alpr' };
const CTA = { alpr: '/projects/alpr/report', stratos: '/projects/stratos/report' };

const { region, stackName, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
console.log(`[tree] ${stackName} ${APPLY ? 'APPLY' : 'dry run'}`);

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const cols = (await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('projects', 'documents') AND column_name IN ('parent_slug', 'short_path', 'live_path')`)).rows;
  const has = (t, c) => cols.some(r => r.table_name === t && r.column_name === c);
  if (!has('projects', 'parent_slug') || !has('documents', 'short_path') || !has('documents', 'live_path')) {
    throw new Error(`schema is behind: run  node scripts/migrate-schema.mjs --env ${envName}  first`);
  }

  const slugUnique = (await client.query(`SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'documents' AND constraint_name = 'documents_slug_key'`)).rows[0];
  if (slugUnique) throw new Error(`documents.slug is still globally UNIQUE: run  node scripts/migrate-schema.mjs --env ${envName}  first (it drops the constraint)`);

  const projects = await loadProjects(client, { ids: true });
  const docs = await listDocuments(client);
  const byId = (slug) => projects.find(p => p.slug === slug);
  const plan = [];      // human lines
  const work = [];      // async (client) => void, run in order inside the transaction

  // 0. "No project" is '' from now on (NULLs are distinct in the unique index).
  const nulls = Number((await client.query(`SELECT count(*)::int AS n FROM documents WHERE project_slug IS NULL`)).rows[0].n);
  if (nulls) { plan.push(`${nulls} document(s) with NULL project_slug → ''`); work.push((c) => c.query(`UPDATE documents SET project_slug = '' WHERE project_slug IS NULL`)); }

  // 1. Drop the weber-county project; move its press to alpr.
  const drop = byId(DROP_PROJECT.slug);
  const target = byId(DROP_PROJECT.pressTo);
  if (drop) {
    if (!target) throw new Error(`project "${DROP_PROJECT.pressTo}" is missing — cannot move the press`);
    for (const [table, col, label] of [['project_files', 'project_slug', 'files'], ['project_notes', 'project_slug', 'notes']]) {
      const n = Number((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [drop.slug])).rows[0].n);
      if (n) throw new Error(`project "${drop.slug}" still has ${n} ${label}; move them in the admin first`);
    }
    const press = drop.articles.length + drop.videos.length;
    plan.push(`delete project "${drop.slug}" (${drop.name}); move ${press} press item(s) to "${target.slug}"`);
    work.push(async (c) => {
      for (const table of ['project_articles', 'project_videos']) {
        const max = Number((await c.query(`SELECT coalesce(max(sort_order), -1)::int AS m FROM ${table} WHERE project_id = $1`, [target.id])).rows[0].m);
        await c.query(`UPDATE ${table} SET project_id = $2, sort_order = sort_order + $3 WHERE project_id = $1`, [drop.id, target.id, max + 1]);
      }
      await c.query('DELETE FROM projects WHERE id = $1', [drop.id]);
      // close the sort_order gap
      const rest = projects.filter(p => p.id !== drop.id);
      for (let i = 0; i < rest.length; i++) await c.query('UPDATE projects SET sort_order = $2, updated_at = now() WHERE id = $1', [rest[i].id, i]);
    });
  } else plan.push(`project "${DROP_PROJECT.slug}" already gone`);

  // 2. Documents: project, slug, short path, live path.
  const taken = new Map(); // `${project}/${slug}` → title, to catch collisions before writing
  for (const d of docs) taken.set(`${d.projectSlug || ''}/${d.slug}`, d.title);
  for (const d of docs) {
    const move = DOCUMENT_MOVES[d.slug];
    const next = { projectSlug: d.projectSlug || '', slug: d.slug, shortPath: d.shortPath || '', livePath: d.livePath || '' };
    if (move && !(d.projectSlug === move.project && (!move.slug || d.slug === move.slug))) {
      if (!byId(move.project)) throw new Error(`project "${move.project}" is missing`);
      next.projectSlug = move.project;
      next.slug = move.slug || d.slug;
      next.shortPath = next.shortPath || `/${d.slug}`;
      next.livePath = next.livePath || `/${d.slug}`;
      const key = `${next.projectSlug}/${next.slug}`;
      if (taken.has(key) && taken.get(key) !== d.title) throw new Error(`"${key}" would collide with "${taken.get(key)}"`);
      taken.set(key, d.title);
    } else if (d.status !== 'draft' && !d.livePath) {
      next.livePath = `/${d.slug}`;
    }
    const changed = next.projectSlug !== (d.projectSlug || '') || next.slug !== d.slug || next.shortPath !== (d.shortPath || '') || next.livePath !== (d.livePath || '');
    if (!changed) { plan.push(`document ${d.slug}: unchanged`); continue; }
    const to = next.projectSlug ? `/projects/${next.projectSlug}/${next.slug}` : `/${next.slug}`;
    plan.push(`document ${d.slug} (${d.status}): project=${next.projectSlug || '-'} slug=${next.slug} short_path=${next.shortPath || '-'} live_path=${next.livePath || '-'}  → ${to}`);
    work.push(async (c) => {
      const { bodyHtmlNormalized, ingestReport, liveHash, liveAt, livePath, lastPublishError, createdAt, updatedAt, contentHash, publishedAt, ...fields } = d;
      await c.query(`INSERT INTO revisions (id, entity_type, entity_id, snapshot, author) VALUES (gen_random_uuid(), 'document', $1, $2, $3)`, [d.id, JSON.stringify(fields), ACTOR]);
      await c.query(`UPDATE documents SET project_slug = $2, slug = $3, short_path = $4, live_path = $5, updated_at = now() WHERE id = $1`,
        [d.id, next.projectSlug || '', next.slug, next.shortPath || null, next.livePath || null]);
      await c.query(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), $1, 'document.move', 'document', $2, $3)`,
        [ACTOR, d.id, JSON.stringify({ from: { project: d.projectSlug || '', slug: d.slug }, to: { project: next.projectSlug, slug: next.slug, shortPath: next.shortPath, url: to } })]);
    });
  }

  // 2b. A stored canonical that names the document's own old address would
  // point search engines at the 301 (the renderer ignores such a canonical
  // too; clearing it keeps the editor honest).
  for (const d of docs) {
    const move = DOCUMENT_MOVES[d.slug] || (d.projectSlug && DOCUMENT_MOVES[(d.shortPath || '').slice(1)]);
    const own = new Set([`/${d.slug}`, d.shortPath, d.livePath].filter(Boolean).map(p => `https://utahciviccompact.org${p}`));
    const c = String(d.canonicalUrl || '').replace(/\.html$/, '');
    if (!c || !own.has(c)) continue;
    plan.push(`document ${d.slug}: canonical ${d.canonicalUrl} names its own old address → cleared`);
    work.push((cl) => cl.query('UPDATE documents SET canonical_url = NULL WHERE id = $1', [d.id]));
    void move;
  }

  // 3. Project buttons.
  for (const [slug, url] of Object.entries(CTA)) {
    const p = byId(slug);
    if (!p) continue;
    const old = String(p.cta_url || '').replace(/\.html$/, '');
    if (p.cta_url === url) { plan.push(`project ${slug}: button already ${url}`); continue; }
    if (old !== `/${slug}`) { plan.push(`project ${slug}: button is ${p.cta_url} (not the report) — left alone`); continue; }
    plan.push(`project ${slug}: button ${p.cta_url} → ${url}`);
    work.push(async (c) => {
      await c.query('UPDATE projects SET cta_url = $2, updated_at = now() WHERE id = $1', [p.id, url]);
    });
  }
  if (work.length) work.push(async (c) => {
    await c.query(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), $1, 'projects.save', 'projects', 'collection', $2)`,
      [ACTOR, JSON.stringify({ migration: 'project-tree', steps: plan.filter(l => !/unchanged|already/.test(l)).length })]);
  });

  console.log(plan.map(l => `  - ${l}`).join('\n'));
  if (!APPLY) { console.log(`[tree] dry run: ${work.length} step(s) would run. Re-run with --apply.`); return; }
  if (!work.length) { console.log('[tree] nothing to do'); return; }
  await client.query('BEGIN');
  try {
    for (const step of work) await step(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  console.log(`[tree] applied ${work.length} step(s). Next: publish (scripts/publish.mjs --env ${envName} --source db, or the admin) — the run writes the pages at their new addresses and the 301s from the old ones.`);
});
