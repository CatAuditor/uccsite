// Collection editor specs — the admin's replacement for Decap's config.yml,
// except the DATABASE is the schema (a field added here + in
// packages/db/content-schema.js is a migration, not a silent-deletion
// hazard). Field lists mirror static/admin/config.yml so the editing surface
// carries over 1:1.
//
// widget: 'text' | 'textarea' | 'media' (text + media-library picker; targetWidth
// selects the variant). markdown flags fields that accept the
// **bold**/*italic*/[link](url) subset (hint shown to editors).

import { FIELD_MAPS, HOMEPAGE_GROUP_COLS, PROJECT_CHILDREN } from '@uccsite/db/content';

const MD_HINT = 'Supports **bold**, *italic*, [link text](https://url). Blank line = new paragraph.';

// The 7-field press/coverage shape used by three editors — one copy.
const PRESS_FIELDS = [
  { name: 'outlet', label: 'Outlet' },
  { name: 'badge_color', label: 'Badge color' },
  { name: 'date', label: 'Date' },
  { name: 'headline', label: 'Headline' },
  { name: 'url', label: 'URL' },
  { name: 'read_more', label: 'Read-more text' },
  { name: 'lang_attr', label: 'lang attribute', hint: 'optional, e.g. lang="es" for Spanish coverage' },
];

export const COLLECTIONS = {
  team: {
    title: 'Team & Bios',
    table: 'team_members',
    itemLabel: (item) => item.name || 'member',
    fields: [
      { name: 'name', label: 'Full Name' },
      { name: 'title', label: 'Title / Role' },
      { name: 'photo', label: 'Headshot', widget: 'media', targetWidth: 400,
        hint: 'Pick from the Media Library (only assets with alt text are offered) or type a path such as /assets/team/name.jpg' },
      { name: 'bio', label: 'Bio', widget: 'textarea', hint: MD_HINT },
      { name: 'email', label: 'Admin email', hint: 'Links this bio to an admin account so they can edit their own bio and headshot from My profile. Not published.' },
    ],
  },
  statements: {
    title: 'Statements',
    table: 'statements',
    note: 'Newest first — the top statement is featured on the homepage.',
    itemLabel: (item) => item.title || item.slug || 'statement',
    fields: [
      { name: 'slug', label: 'Slug (URL anchor)', hint: 'lowercase-with-dashes' },
      { name: 'date', label: 'Date', hint: 'e.g. July 24, 2026' },
      { name: 'topic', label: 'Topic' },
      { name: 'author', label: 'Author' },
      { name: 'title', label: 'Title' },
      { name: 'snippet', label: 'Snippet (homepage card)', widget: 'textarea' },
      { name: 'body', label: 'Body', widget: 'textarea', hint: MD_HINT },
      { name: 'signoff', label: 'Sign-off', hint: 'optional, e.g. — Utah Civic Compact' },
      { name: 'url', label: 'Homepage card link', hint: 'optional; blank = the statement’s spot on /statements' },
      { name: 'more', label: 'Homepage read-more text', hint: 'optional; blank = "Read the full statement →"' },
    ],
  },
  issues: {
    title: 'Policy Positions',
    table: 'issues',
    itemLabel: (item) => item.title || 'position',
    fields: [
      { name: 'slug', label: 'Slug' },
      { name: 'num', label: 'Number' },
      { name: 'title', label: 'Title' },
      { name: 'author', label: 'Author' },
      { name: 'epigraph', label: 'Epigraph', widget: 'textarea' },
      { name: 'body', label: 'Body', widget: 'textarea', hint: MD_HINT },
    ],
  },
  'blog-articles': {
    title: 'News & Media — Articles',
    table: 'blog_articles',
    itemLabel: (item) => item.headline || 'article',
    fields: [
      { name: 'outlet', label: 'Outlet' },
      { name: 'badge_color', label: 'Badge color' },
      { name: 'date', label: 'Date' },
      { name: 'region', label: 'Region' },
      { name: 'headline', label: 'Headline' },
      { name: 'excerpt', label: 'Excerpt', widget: 'textarea' },
      { name: 'url', label: 'Article URL' },
      { name: 'read_more', label: 'Read-more text' },
      { name: 'lang_attr', label: 'lang attribute', hint: 'optional, e.g. lang="es" for Spanish coverage' },
    ],
  },
  'blog-videos': {
    title: 'News & Media — Videos',
    table: 'blog_videos',
    itemLabel: (item) => item.headline || 'video',
    fields: [
      { name: 'outlet', label: 'Outlet' },
      { name: 'badge_color', label: 'Badge color' },
      { name: 'date', label: 'Date' },
      { name: 'region', label: 'Region' },
      { name: 'headline', label: 'Headline' },
      { name: 'youtube_id', label: 'YouTube video id' },
      { name: 'embed_params', label: 'Embed params', hint: 'optional, e.g. start=90' },
      { name: 'youtube_title', label: 'Player title (accessibility)' },
    ],
  },
  // Nested collection (spec §3.1 "projects keeps its nested articles and
  // videos"): child lists are widget 'list' with their own fields and child
  // table; the whole tree saves in one transaction (replaceProjects).
  projects: {
    title: 'Projects',
    table: 'projects',
    nested: true,
    childTables: PROJECT_CHILDREN, // the db layer's mapping — asserted below
    note: 'Order here is the order on /projects and the homepage cards. Use the filter box to find a project; drag order with the arrows.',
    itemLabel: (item) => item.name || 'project',
    fields: [
      { name: 'name', label: 'Project name' },
      { name: 'slug', label: 'Slug', hint: 'lowercase-with-dashes; matches the report page slug when there is one' },
      { name: 'date', label: 'Date', hint: 'e.g. August 2026 or June 4, 2026 (used for "newest first" sorting on the site)' },
      { name: 'author', label: 'Author' },
      { name: 'status', label: 'Status', hint: 'e.g. Active, Closed' },
      { name: 'status_color', label: 'Status colour', hint: 'hex, e.g. #c0392b' },
      { name: 'region', label: 'Region' },
      { name: 'tagline', label: 'Tagline', widget: 'textarea' },
      { name: 'cta_url', label: 'Button link', hint: 'e.g. /alpr.html' },
      { name: 'cta_text', label: 'Button text' },
      { name: 'articles', label: 'In the press', widget: 'list', itemLabelField: 'headline', fields: [
        { name: 'outlet', label: 'Outlet' },
        { name: 'badge_color', label: 'Badge colour' },
        { name: 'date', label: 'Date' },
        { name: 'region', label: 'Region' },
        { name: 'headline', label: 'Headline' },
        { name: 'excerpt', label: 'Excerpt', widget: 'textarea' },
        { name: 'url', label: 'Article URL' },
        { name: 'read_more', label: 'Read-more text' },
        { name: 'lang_attr', label: 'lang attribute', hint: 'optional, e.g. lang="es"' },
      ]},
      { name: 'videos', label: 'On television', widget: 'list', itemLabelField: 'headline', fields: [
        { name: 'outlet', label: 'Outlet' },
        { name: 'badge_color', label: 'Badge colour' },
        { name: 'date', label: 'Date' },
        { name: 'region', label: 'Region' },
        { name: 'headline', label: 'Headline' },
        { name: 'youtube_id', label: 'YouTube video id' },
        { name: 'youtube_title', label: 'Player title (accessibility)' },
      ]},
    ],
  },
  'coverage-alpr': {
    title: 'Report Coverage — ALPR',
    table: 'coverage_entries',
    where: ['report_key', 'alpr'],
    itemLabel: (item) => item.headline || 'entry',
    fields: PRESS_FIELDS,
  },
  'coverage-stratos': {
    title: 'Report Coverage — Stratos',
    table: 'coverage_entries',
    where: ['report_key', 'stratos'],
    itemLabel: (item) => item.headline || 'entry',
    fields: PRESS_FIELDS,
  },
};

// ── Boot-time drift guard ───────────────────────────────────────────────────
// Every editor field must exist in FIELD_MAPS and vice versa. Without this,
// a column added to the DB but not here is silently WIPED on the next save
// (sanitizeItems drops unknown keys, then wipe-and-load) — Decap's exact
// delete-on-save hazard. Drift is a loud startup error instead.
function assertFieldsMatch(label, table, fields) {
  if (!FIELD_MAPS[table]) throw new Error(`${label}: "${table}" is not a content table (FIELD_MAPS)`);
  const mapped = new Set(Object.values(FIELD_MAPS[table]));
  const declared = new Set(fields.filter(f => f.widget !== 'list').map(f => f.name));
  for (const f of declared) {
    if (!mapped.has(f)) throw new Error(`${label}: field "${f}" not in FIELD_MAPS.${table}`);
  }
  for (const m of mapped) {
    if (!declared.has(m)) throw new Error(`${label}: FIELD_MAPS.${table} key "${m}" missing from editor fields — saves would wipe it`);
  }
}
for (const [key, spec] of Object.entries(COLLECTIONS)) {
  assertFieldsMatch(`collections.${key}`, spec.table, spec.fields);
  const listFields = spec.fields.filter(f => f.widget === 'list').map(f => f.name);
  if (spec.nested) {
    // The editor's child lists must be exactly what replaceProjects/loadProjects read.
    const expected = Object.keys(PROJECT_CHILDREN).sort().join(',');
    if (listFields.slice().sort().join(',') !== expected) {
      throw new Error(`collections.${key}: list fields [${listFields}] must equal PROJECT_CHILDREN [${expected}] — a mismatch would wipe child rows on save`);
    }
  }
  for (const f of spec.fields.filter(f => f.widget === 'list')) {
    const child = spec.childTables?.[f.name];
    if (!child) throw new Error(`collections.${key}: list field "${f.name}" has no childTables entry`);
    assertFieldsMatch(`collections.${key}.${f.name}`, child, f.fields);
  }
}

// Site settings singleton fields (the settings editor). Guarded against
// FIELD_MAPS.site_settings below like the list editors: a column not
// declared here would be NULLed on the next save.
export const SETTINGS_FIELDS = [
  ['orgName', 'Organization Name'],
  ['orgNameShort', 'Short Name'],
  ['email', 'Contact Email'],
  ['instagram', 'Instagram URL'],
  ['footerTagline', 'Footer Tagline'],
  ['copyright', 'Copyright Line'],
  ['turnstileSiteKey', 'Turnstile Site Key (blank = no CAPTCHA widget)'],
];
{
  const mapped = new Set(Object.values(FIELD_MAPS.site_settings));
  const declared = new Set(SETTINGS_FIELDS.map(([k]) => k));
  for (const k of declared) if (!mapped.has(k)) throw new Error(`SETTINGS_FIELDS: "${k}" not in FIELD_MAPS.site_settings`);
  for (const k of mapped) if (!declared.has(k)) throw new Error(`SETTINGS_FIELDS: FIELD_MAPS.site_settings key "${k}" missing — saves would wipe it`);
}

// Homepage singleton groups (flat string fields inside each group) + press list.
export const HOMEPAGE_GROUPS = [
  { key: 'hero', title: 'Hero', fields: [
    ['headline', 'Headline', 'textarea', 'HTML allowed (line breaks with <br />)'],
    ['subtitle', 'Subtitle', 'textarea'],
    ['cta_primary', 'Primary button label'],
    ['cta_secondary', 'Secondary button label'],
  ]},
  { key: 'mission', title: 'Mission', fields: [['quote', 'Quote', 'textarea']] },
  { key: 'about', title: 'About', fields: [
    ['title', 'Title'], ['body1', 'Paragraph 1', 'textarea'],
    ['body2', 'Paragraph 2', 'textarea'], ['body3', 'Paragraph 3', 'textarea'],
    ['quote', 'Quote', 'textarea'],
  ]},
  { key: 'join', title: 'Join / Get Involved', fields: [
    ['title', 'Title'], ['body', 'Body', 'textarea'],
    ['item1', 'Item 1'], ['item2', 'Item 2'], ['item3', 'Item 3'], ['item4', 'Item 4'],
  ]},
  { key: 'donate', title: 'Donate section', fields: [
    ['label', 'Label'], ['title', 'Title'], ['body', 'Body', 'textarea'],
  ]},
  { key: 'modal', title: 'Donation modal', fields: [
    ['badge', 'Badge'], ['title', 'Title'], ['body', 'Body', 'textarea'], ['cta', 'CTA label'],
  ]},
];

export const HOMEPAGE_PRESS_FIELDS = PRESS_FIELDS;

// Group-level drift guard: every JSON group column must have an editor group
// and vice versa (a group missing here would be NULLed on save). Field-level
// keys inside a group are template-defined (templates/index.html) — adding
// one there means adding it to HOMEPAGE_GROUPS in the same commit.
{
  const cols = new Set(HOMEPAGE_GROUP_COLS.map(([, key]) => key));
  const groups = new Set(HOMEPAGE_GROUPS.map(g => g.key));
  for (const k of groups) if (!cols.has(k)) throw new Error(`HOMEPAGE_GROUPS: "${k}" is not a homepage column`);
  for (const k of cols) if (!groups.has(k)) throw new Error(`HOMEPAGE_GROUPS: homepage column "${k}" has no editor group — saves would wipe it`);
}
