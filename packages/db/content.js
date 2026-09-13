'use strict';
// Content access layer: DSQL rows ⇄ the EXACT JSON shapes packages/render
// consumes (the same shapes content/*.json holds today). Once the database is
// the source of truth (Phase 7), loadContent() feeds the publish pipeline —
// the golden-file tests stay meaningful because this mapping reproduces the
// repo JSON byte-for-byte through the renderer.
//
// Single sources of truth in this file (everything else derives):
//   FIELD_MAPS            column ⇄ JSON key per table
//   HOMEPAGE_GROUP_COLS   homepage singleton's JSON-document columns
//   COLLECTION_TABLES     content name → tables (lastmod, meta, callers)
// The admin's editor specs are VALIDATED against FIELD_MAPS at boot
// (apps/admin/lib/collections.js) — drift is a loud startup error, not a
// silent wipe-on-save.
//
// Conventions:
//   - SQL NULL → key omitted from the JSON object (optional fields; the
//     template engine treats both identically, deep-equal parity demands it)
//   - singletons (site_settings, homepage) use id='singleton'
//   - every list is ordered by sort_order
const { withRetry } = require('./index');

const SINGLETON = 'singleton';

// column -> JSON key maps (identity where names match)
const FIELD_MAPS = {
  site_settings: {
    org_name: 'orgName', org_name_short: 'orgNameShort', email: 'email',
    instagram: 'instagram', footer_tagline: 'footerTagline', copyright: 'copyright',
    turnstile_site_key: 'turnstileSiteKey',
  },
  homepage_press: {
    outlet: 'outlet', badge_color: 'badge_color', date: 'date', headline: 'headline',
    url: 'url', read_more: 'read_more', lang_attr: 'lang_attr',
  },
  team_members: { name: 'name', title: 'title', photo: 'photo', bio: 'bio' },
  statements: {
    slug: 'slug', date: 'date', topic: 'topic', author: 'author', title: 'title',
    snippet: 'snippet', body: 'body', signoff: 'signoff', url: 'url', more: 'more',
  },
  issues: {
    slug: 'slug', num: 'num', title: 'title', author: 'author',
    epigraph: 'epigraph', body: 'body',
  },
  blog_articles: {
    outlet: 'outlet', badge_color: 'badge_color', date: 'date', region: 'region',
    headline: 'headline', excerpt: 'excerpt', url: 'url', read_more: 'read_more',
    lang_attr: 'lang_attr',
  },
  blog_videos: {
    outlet: 'outlet', badge_color: 'badge_color', date: 'date', region: 'region',
    headline: 'headline', youtube_id: 'youtube_id', embed_params: 'embed_params',
    youtube_title: 'youtube_title',
  },
  projects: {
    name: 'name', slug: 'slug', date: 'date', author: 'author', status: 'status',
    status_color: 'status_color', region: 'region', tagline: 'tagline',
    cta_url: 'cta_url', cta_text: 'cta_text',
  },
  project_articles: {
    outlet: 'outlet', badge_color: 'badge_color', date: 'date', region: 'region',
    headline: 'headline', excerpt: 'excerpt', url: 'url', read_more: 'read_more',
    lang_attr: 'lang_attr',
  },
  project_videos: {
    outlet: 'outlet', badge_color: 'badge_color', date: 'date', region: 'region',
    headline: 'headline', youtube_id: 'youtube_id', youtube_title: 'youtube_title',
  },
  coverage_entries: {
    outlet: 'outlet', badge_color: 'badge_color', date: 'date', headline: 'headline',
    url: 'url', read_more: 'read_more', lang_attr: 'lang_attr',
  },
};

// homepage singleton: [column, jsonKey] (join is a SQL keyword → join_section)
const HOMEPAGE_GROUP_COLS = [
  ['hero', 'hero'], ['mission', 'mission'], ['about', 'about'],
  ['join_section', 'join'], ['donate', 'donate'], ['modal', 'modal'],
];

// content name → the tables whose rows/updated_at constitute that collection.
const COLLECTION_TABLES = {
  settings: ['site_settings'],
  homepage: ['homepage', 'homepage_press'],
  team: ['team_members'],
  statements: ['statements'],
  issues: ['issues'],
  blog: ['blog_articles', 'blog_videos'],
  projects: ['projects', 'project_articles', 'project_videos'],
  coverage: ['coverage_entries'],
};
const CONTENT_TABLES = [...new Set(Object.values(COLLECTION_TABLES).flat())];

function rowToObject(table, row) {
  const out = {};
  for (const [col, key] of Object.entries(FIELD_MAPS[table])) {
    if (row[col] !== null && row[col] !== undefined) out[key] = row[col];
  }
  return out;
}

// list(client, table, where?, params?) → ordered JSON objects. THE collection
// read — the admin and the renderer must never disagree on order or mapping.
async function list(client, table, where = '', params = []) {
  const res = await client.query(
    `SELECT * FROM ${table} ${where} ORDER BY sort_order`, params);
  return res.rows.map(row => rowToObject(table, row));
}

async function loadSettings(client) {
  const row = (await client.query(
    `SELECT * FROM site_settings WHERE id = $1`, [SINGLETON])).rows[0];
  if (!row) throw new Error('site_settings singleton missing — run migrate-content');
  return rowToObject('site_settings', row);
}

async function loadHomepage(client) {
  const hp = (await client.query(
    `SELECT * FROM homepage WHERE id = $1`, [SINGLETON])).rows[0];
  if (!hp) throw new Error('homepage singleton missing — run migrate-content');
  const homepage = {};
  for (const [col, key] of HOMEPAGE_GROUP_COLS) {
    if (hp[col] !== null && hp[col] !== undefined) homepage[key] = JSON.parse(hp[col]);
  }
  homepage.press = await list(client, 'homepage_press');
  return homepage;
}

// loadContent(client) → the renderer's full content map. Project children are
// fetched in two grouped queries (not 2 per project).
// loadProjects(client) → projects with nested articles/videos (the projects.json shape).
async function loadProjects(client) {

  const projectRows = (await client.query(`SELECT * FROM projects ORDER BY sort_order`)).rows;
  const groupByProject = (rows, table) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.project_id)) map.set(row.project_id, []);
      map.get(row.project_id).push(rowToObject(table, row));
    }
    return map;
  };
  const articlesBy = groupByProject(
    (await client.query(`SELECT * FROM project_articles ORDER BY project_id, sort_order`)).rows, 'project_articles');
  const videosBy = groupByProject(
    (await client.query(`SELECT * FROM project_videos ORDER BY project_id, sort_order`)).rows, 'project_videos');
  return projectRows.map(row => ({
    ...rowToObject('projects', row),
    articles: articlesBy.get(row.id) || [],
    videos: videosBy.get(row.id) || [],
  }));
}

async function loadContent(client) {
  const settings = await loadSettings(client);
  const homepage = await loadHomepage(client);
  const projects = await loadProjects(client);

  return {
    settings,
    homepage,
    team: { members: await list(client, 'team_members') },
    statements: { statements: await list(client, 'statements') },
    issues: { issues: await list(client, 'issues') },
    blog: {
      articles: await list(client, 'blog_articles'),
      videos: await list(client, 'blog_videos'),
    },
    projects: { projects },
    coverage: {
      alpr_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['alpr']),
      stratos_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['stratos']),
    },
  };
}

// contentMeta(client) → { tableName: newest updated_at ISO } in ONE query.
async function contentMeta(client) {
  const sql = CONTENT_TABLES
    .map(t => `SELECT '${t}' AS t, MAX(updated_at)::text AS newest FROM ${t}`)
    .join(' UNION ALL ');
  const res = await client.query(sql);
  const meta = {};
  for (const row of res.rows) {
    if (row.newest) meta[row.t] = new Date(row.newest).toISOString();
  }
  return meta;
}

// makeDbLastmod(meta) → (page) => 'YYYY-MM-DD' for the publish sitemap.
// Known limitation (documented in publish-pipeline.md): template-only changes
// don't advance lastmod, and deleting the newest row can lower it.
function makeDbLastmod(meta) {
  const today = new Date().toISOString().slice(0, 10);
  return (page) => {
    let best = '';
    for (const name of page.content) {
      for (const table of COLLECTION_TABLES[name] || []) {
        const iso = meta[table];
        if (iso && iso > best) best = iso;
      }
    }
    return best ? best.slice(0, 10) : today;
  };
}

// ── Write side (migration + admin) ──────────────────────────────────────────

function objectToParams(table, obj) {
  return Object.entries(FIELD_MAPS[table]).map(([, key]) => obj[key] ?? null);
}

// insertRow(client, table, item, extra) — one row from a JSON item plus fixed
// extra columns ({sort_order: i, project_id: x, …}). THE insert everything
// (migration, admin saves) goes through.
async function insertRow(client, table, item, extra = {}) {
  const cols = Object.keys(FIELD_MAPS[table]);
  const extraCols = Object.keys(extra);
  const names = [...extraCols, ...cols];
  const params = [...extraCols.map(c => extra[c]), ...objectToParams(table, item)];
  const res = await client.query(
    `INSERT INTO ${table} (id, ${names.join(', ')})
     VALUES (gen_random_uuid(), ${names.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    params);
  return res.rows[0].id;
}

// replaceCollectionRows(client, table, items, { where, extraCols, tx } = {})
// Wipe-and-load, ATOMIC: DELETE + inserts inside one transaction with a
// 40001 retry of the whole transaction — an abort can no longer leave the
// table empty/partial (which would silently publish blank pages).
//   where: [col, val] scopes the delete AND stamps the column on each row.
//   extraCols: { col: (item, i) => value } additional stamped columns.
//   tx: false → the CALLER owns BEGIN/COMMIT/retry (the admin wraps the
//   wipe-and-load, the revision snapshot and the audit row in one txn).
async function replaceCollectionRows(client, table, items, { where, extraCols = {}, tx = true } = {}) {
  const body = async () => {
    if (where) await client.query(`DELETE FROM ${table} WHERE ${where[0]} = $1`, [where[1]]);
    else await client.query(`DELETE FROM ${table}`);
    for (let i = 0; i < items.length; i++) {
      const extra = { sort_order: i };
      if (where) extra[where[0]] = where[1];
      for (const [col, fn] of Object.entries(extraCols)) extra[col] = fn(items[i], i);
      await insertRow(client, table, items[i], extra);
    }
  };
  if (!tx) return body();
  await withRetry(async () => {
    await client.query('BEGIN');
    try {
      await body();
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });
}

async function saveSettings(client, settings) {
  const cols = Object.entries(FIELD_MAPS.site_settings);
  const sets = cols.map(([col], i) => `${col} = $${i + 2}`).join(', ');
  const params = [SINGLETON, ...cols.map(([, key]) => settings[key] ?? null)];
  await client.query(
    `INSERT INTO site_settings (id, ${cols.map(([c]) => c).join(', ')})
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${sets}, updated_at = now()`,
    params);
}

// saveHomepage(client, homepage, { tx }) — tx: false when the caller owns
// the transaction (the groups upsert and the press wipe-and-load must
// commit together; on their own they are two transactions).
async function saveHomepage(client, homepage, { tx = true } = {}) {
  const params = [SINGLETON, ...HOMEPAGE_GROUP_COLS.map(([, key]) => homepage[key] != null ? JSON.stringify(homepage[key]) : null)];
  await client.query(
    `INSERT INTO homepage (id, ${HOMEPAGE_GROUP_COLS.map(([c]) => c).join(', ')})
     VALUES ($1, ${HOMEPAGE_GROUP_COLS.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${HOMEPAGE_GROUP_COLS.map(([c], i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now()`,
    params);
  await replaceCollectionRows(client, 'homepage_press', homepage.press || [], { tx });
}

// replaceProjects(client, projects, { tx }) — projects + children in ONE
// transaction (a 40001 abort or a crash between the parent wipe and the
// child inserts must not publish empty projects). tx: false when the caller
// owns the transaction (the admin's projects editor).
async function replaceProjects(client, projects, { tx = true } = {}) {
  const body = async () => {
    await client.query('DELETE FROM project_articles');
    await client.query('DELETE FROM project_videos');
    await client.query('DELETE FROM projects');
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const projectId = await insertRow(client, 'projects', p, { sort_order: i });
      for (let j = 0; j < (p.articles || []).length; j++) {
        await insertRow(client, 'project_articles', p.articles[j], { project_id: projectId, sort_order: j });
      }
      for (let j = 0; j < (p.videos || []).length; j++) {
        await insertRow(client, 'project_videos', p.videos[j], { project_id: projectId, sort_order: j });
      }
    }
  };
  if (!tx) return body();
  await withRetry(async () => {
    await client.query('BEGIN');
    try { await body(); await client.query('COMMIT'); } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
  });
}

// saveContent(client, repo) — the inverse of loadContent: load the eight
// content/*.json shapes into the tables (singletons upsert, lists
// wipe-and-load). THE write path for the initial migration and for
// restore-from-export (§14.4) — one implementation, so a restore can never
// drift from what the migration proved round-trips.
async function saveContent(client, repo) {
  await saveSettings(client, repo.settings);
  await saveHomepage(client, repo.homepage);
  await replaceCollectionRows(client, 'team_members', repo.team.members);
  await replaceCollectionRows(client, 'statements', repo.statements.statements);
  await replaceCollectionRows(client, 'issues', repo.issues.issues);
  await replaceCollectionRows(client, 'blog_articles', repo.blog.articles);
  await replaceCollectionRows(client, 'blog_videos', repo.blog.videos);

  await replaceProjects(client, repo.projects.projects);

  await replaceCollectionRows(client, 'coverage_entries', repo.coverage.alpr_coverage, { where: ['report_key', 'alpr'] });
  await replaceCollectionRows(client, 'coverage_entries', repo.coverage.stratos_coverage, { where: ['report_key', 'stratos'] });
}

module.exports = {
  SINGLETON, FIELD_MAPS, HOMEPAGE_GROUP_COLS, COLLECTION_TABLES, CONTENT_TABLES,
  rowToObject, objectToParams, list, insertRow,
  loadSettings, loadHomepage, loadProjects, loadContent, contentMeta, makeDbLastmod,
  replaceCollectionRows, replaceProjects, saveSettings, saveHomepage, saveContent,
};
