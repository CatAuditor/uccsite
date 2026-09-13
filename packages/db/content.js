'use strict';
// Content access layer: DSQL rows ⇄ the EXACT JSON shapes packages/render
// consumes (the same shapes content/*.json holds today). Once the database is
// the source of truth (Phase 7), loadContent() feeds the publish pipeline —
// the golden-file tests stay meaningful because this mapping reproduces the
// repo JSON byte-for-byte through the renderer.
//
// Conventions:
//   - snake_case columns ⇄ camelCase/original JSON keys (explicit maps below)
//   - SQL NULL → key omitted from the JSON object (matches optional fields
//     like lang_attr/url/more; the template engine treats both identically,
//     and deep-equal parity tests demand omission)
//   - singletons (site_settings, homepage) use id='singleton'
//   - every list is ordered by sort_order

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

function rowToObject(table, row) {
  const out = {};
  for (const [col, key] of Object.entries(FIELD_MAPS[table])) {
    if (row[col] !== null && row[col] !== undefined) out[key] = row[col];
  }
  return out;
}

async function list(client, table, where = '', params = []) {
  const res = await client.query(
    `SELECT * FROM ${table} ${where} ORDER BY sort_order`, params);
  return res.rows.map(row => rowToObject(table, row));
}

// loadContent(client) → { settings, homepage, team, statements, issues, blog,
//                         projects, coverage } — the renderer's content map.
async function loadContent(client) {
  const settingsRow = (await client.query(
    `SELECT * FROM site_settings WHERE id = $1`, [SINGLETON])).rows[0];
  if (!settingsRow) throw new Error('site_settings singleton missing — run migrate-content');
  const settings = rowToObject('site_settings', settingsRow);

  const hp = (await client.query(
    `SELECT * FROM homepage WHERE id = $1`, [SINGLETON])).rows[0];
  if (!hp) throw new Error('homepage singleton missing — run migrate-content');
  const homepage = {};
  for (const [col, key] of [
    ['hero', 'hero'], ['mission', 'mission'], ['about', 'about'],
    ['join_section', 'join'], ['donate', 'donate'], ['modal', 'modal'],
  ]) {
    if (hp[col] !== null && hp[col] !== undefined) homepage[key] = JSON.parse(hp[col]);
  }
  homepage.press = await list(client, 'homepage_press');

  const projects = [];
  for (const row of (await client.query(`SELECT * FROM projects ORDER BY sort_order`)).rows) {
    const project = rowToObject('projects', row);
    project.articles = await list(client, 'project_articles', 'WHERE project_id = $1', [row.id]);
    project.videos = await list(client, 'project_videos', 'WHERE project_id = $1', [row.id]);
    projects.push(project);
  }

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

// ── Write side (migration + admin) ──────────────────────────────────────────

function objectToParams(table, obj) {
  return Object.entries(FIELD_MAPS[table]).map(([, key]) => obj[key] ?? null);
}

// replaceCollectionRows(client, table, items, extraCols?) — wipe-and-load a
// list table in one pass (migration and full-list admin saves). extraCols:
// { colName: (item, index) => value } appended per row.
async function replaceCollectionRows(client, table, items, extraCols = {}) {
  await client.query(`DELETE FROM ${table}`);
  const cols = Object.keys(FIELD_MAPS[table]);
  const extra = Object.keys(extraCols);
  for (let i = 0; i < items.length; i++) {
    const params = [i, ...objectToParams(table, items[i]), ...extra.map(c => extraCols[c](items[i], i))];
    const names = ['sort_order', ...cols, ...extra];
    const placeholders = names.map((_, j) => `$${j + 1}`);
    await client.query(
      `INSERT INTO ${table} (id, ${names.join(', ')}) VALUES (gen_random_uuid(), ${placeholders.join(', ')})`,
      params);
  }
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

async function saveHomepage(client, homepage) {
  const groups = [
    ['hero', 'hero'], ['mission', 'mission'], ['about', 'about'],
    ['join_section', 'join'], ['donate', 'donate'], ['modal', 'modal'],
  ];
  const params = [SINGLETON, ...groups.map(([, key]) => homepage[key] != null ? JSON.stringify(homepage[key]) : null)];
  await client.query(
    `INSERT INTO homepage (id, ${groups.map(([c]) => c).join(', ')})
     VALUES ($1, ${groups.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${groups.map(([c], i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now()`,
    params);
  await replaceCollectionRows(client, 'homepage_press', homepage.press || []);
}

// contentMeta(client) → { tableName: newest updated_at ISO string } for every
// content table — the publish Lambda's sitemap-lastmod source.
const CONTENT_TABLES = [
  'site_settings', 'homepage', 'homepage_press', 'team_members', 'statements',
  'issues', 'blog_articles', 'blog_videos', 'projects', 'project_articles',
  'project_videos', 'coverage_entries',
];

async function contentMeta(client) {
  const meta = {};
  for (const table of CONTENT_TABLES) {
    const res = await client.query(`SELECT MAX(updated_at)::text AS newest FROM ${table}`);
    if (res.rows[0]?.newest) meta[table] = new Date(res.rows[0].newest).toISOString();
  }
  return meta;
}

module.exports = {
  SINGLETON, FIELD_MAPS, rowToObject, loadContent, contentMeta, CONTENT_TABLES,
  replaceCollectionRows, saveSettings, saveHomepage,
};
