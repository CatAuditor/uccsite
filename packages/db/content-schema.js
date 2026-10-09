'use strict';
// DSQL schema for the CONTENT tables (build-spec-aws.md §9 "New (content)").
// One table per collection, columns matching the current content/*.json field
// names (snake_cased for SQL; packages/db/content.js maps rows back to the
// EXACT JSON shapes the renderer consumes — that mapping is what keeps the
// golden-file tests meaningful once the database is the source of truth).
//
// The operational "members" table holds donors, so the team collection lives
// in team_members. projects keeps its nested articles/videos as child tables
// (spec: that nesting is what "project work" refers to).
// Ordering: every list table carries sort_order (ascending). DSQL: one DDL
// per transaction; CREATE INDEX must be ASYNC.

const { DDL: REDIRECTS_DDL } = require('./redirects');
const { DDL: PUBLISH_REQUESTS_DDL } = require('./publish-requests');
const { DDL: NEWSLETTERS_DDL } = require('./newsletters');

const STATEMENTS = [
  // ── singletons ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS site_settings (
    id TEXT PRIMARY KEY,
    org_name TEXT,
    org_name_short TEXT,
    email TEXT,
    instagram TEXT,
    footer_tagline TEXT,
    copyright TEXT,
    turnstile_site_key TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  // Download modal copy (templates/partials/footer.html; edited on the admin's
  // Donation appeals page). Additive: ALTER so existing clusters gain them.
  `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS download_modal_title TEXT`,
  `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS download_modal_body TEXT`,
  `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS download_modal_cta TEXT`,
  `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS download_modal_dismiss TEXT`,
  // Header + footer menus as JSON (docs/systems/navigation.md). NULL = the
  // defaults in packages/render/navigation.js.
  `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS navigation TEXT`,
  // homepage.json's six object groups as JSON documents; press is a child list.
  `CREATE TABLE IF NOT EXISTS homepage (
    id TEXT PRIMARY KEY,
    hero TEXT,
    mission TEXT,
    about TEXT,
    join_section TEXT,
    donate TEXT,
    modal TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  // Petition campaign copy (hero takeover + /petition + /petition-thanks),
  // edited on the admin's Petition page. Additive: ALTER for existing clusters.
  `ALTER TABLE homepage ADD COLUMN IF NOT EXISTS petition TEXT`,
  `CREATE TABLE IF NOT EXISTS homepage_press (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    outlet TEXT, badge_color TEXT, date TEXT, headline TEXT, url TEXT,
    read_more TEXT, lang_attr TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,

  // ── lists ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    name TEXT, title TEXT, photo TEXT, bio TEXT, email TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  // email links a team member to their admin account (self-service bio/
  // headshot on /profile). Never rendered. Existing clusters: ADD COLUMN.
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email TEXT`,
  // Author pages (docs/systems/author-pages.md): slug = /team/<slug> (blank →
  // derived from the name); links = public profile URLs, one per line → sameAs.
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS slug TEXT`,
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS links TEXT`,
  `CREATE TABLE IF NOT EXISTS statements (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    slug TEXT UNIQUE, date TEXT, topic TEXT, author TEXT, title TEXT,
    snippet TEXT, body TEXT, signoff TEXT, url TEXT, more TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS issues (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    slug TEXT UNIQUE, num TEXT, title TEXT, author TEXT, epigraph TEXT, body TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS blog_articles (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    outlet TEXT, badge_color TEXT, date TEXT, region TEXT, headline TEXT,
    excerpt TEXT, url TEXT, read_more TEXT, lang_attr TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS blog_videos (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    outlet TEXT, badge_color TEXT, date TEXT, region TEXT, headline TEXT,
    youtube_id TEXT, embed_params TEXT, youtube_title TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    name TEXT, slug TEXT UNIQUE, date TEXT, author TEXT, status TEXT,
    status_color TEXT, region TEXT, tagline TEXT, cta_url TEXT, cta_text TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS project_articles (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    sort_order INTEGER NOT NULL,
    outlet TEXT, badge_color TEXT, date TEXT, region TEXT, headline TEXT,
    excerpt TEXT, url TEXT, read_more TEXT, lang_attr TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS project_videos (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    sort_order INTEGER NOT NULL,
    outlet TEXT, badge_color TEXT, date TEXT, region TEXT, headline TEXT,
    youtube_id TEXT, youtube_title TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  // coverage.json: two per-report strips keyed by report_key ('alpr'|'stratos').
  `CREATE TABLE IF NOT EXISTS coverage_entries (
    id UUID PRIMARY KEY,
    report_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    outlet TEXT, badge_color TEXT, date TEXT, headline TEXT, url TEXT,
    read_more TEXT, lang_attr TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_coverage_report ON coverage_entries(report_key, sort_order)`,

  // ── admin bookkeeping (spec §9) ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS revisions (
    id UUID PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    author TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_revisions_entity ON revisions(entity_type, entity_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY,
    actor TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    diff TEXT,
    at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_audit_at ON audit_log(at)`,

  // ── media library (spec §13, packages/db/media.js) ────────────────────────
  // s3_key = the private original under uploads/; variants = JSON array of
  // {format,width,height,path,bytes} served at /media/*. status: pending
  // (row created, PUT not yet seen) → processing → ready | failed.
  `CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY,
    s3_key TEXT NOT NULL,
    original_filename TEXT,
    mime TEXT,
    width INTEGER,
    height INTEGER,
    bytes INTEGER,
    alt TEXT,
    variants TEXT,
    uploaded_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_media_assets_created ON media_assets(created_at)`,

  // ── project files (docs/systems/files.md, packages/db/files.js) ───────────
  // project_slug is a soft link (projects are wiped and re-inserted with new
  // ids on every save, so no FK); '' or NULL = "General" (no project).
  // public_key is set while a published copy exists under files/ (served at /files/*).
  `CREATE TABLE IF NOT EXISTS project_files (
    id UUID PRIMARY KEY,
    project_slug TEXT,
    folder TEXT NOT NULL DEFAULT '',
    original_filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes BIGINT NOT NULL,
    note TEXT,
    s3_key TEXT NOT NULL,
    public_key TEXT,
    published_at TIMESTAMPTZ,
    published_by TEXT,
    uploaded_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_project_files_project ON project_files(project_slug, folder, created_at)`,
  // A file publish is a REQUEST until a second admin approves a site publish
  // (docs/decisions/project-files-two-person-publish.md). These two record who
  // asked and when; the approval clears them and fills public_key.
  `ALTER TABLE project_files ADD COLUMN IF NOT EXISTS publish_requested_at TIMESTAMPTZ`,
  `ALTER TABLE project_files ADD COLUMN IF NOT EXISTS publish_requested_by TEXT`,

  // ── press (docs/systems/press.md, packages/db/press.js) ───────────────────
  // ONE row per story; the hubs, coverage strips, News & Media and the
  // homepage cards derive from it (packages/render/press.js). Replaces
  // project_articles / project_videos / coverage_entries / blog_articles /
  // blog_videos / homepage_press, whose tables stay (empty) until a later
  // cleanup. Flags are TEXT '1' / NULL like every other collection string.
  `CREATE TABLE IF NOT EXISTS press (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    type TEXT, outlet TEXT, badge_color TEXT, date TEXT, region TEXT, headline TEXT,
    excerpt TEXT, url TEXT, read_more TEXT, lang_attr TEXT,
    youtube_id TEXT, embed_params TEXT, youtube_title TEXT,
    project_slug TEXT, featured TEXT, hide_from_news TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_press_project ON press(project_slug, sort_order)`,

  // ── petitions (docs/systems/petition.md, packages/db/petitions.js) ────────
  // ONE row per petition, always filed under a project (project_slug). Its
  // page is /projects/<project path>/<slug>, the thank-you page sits under
  // it, and the `featured` one takes over the homepage hero. Replaces the
  // homepage.petition JSON group (column kept, no longer read —
  // docs/decisions/petitions-collection.md). status: draft | open | closed.
  `CREATE TABLE IF NOT EXISTS petitions (
    id UUID PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    slug TEXT, project_slug TEXT, status TEXT, featured TEXT,
    label TEXT, headline TEXT, body TEXT, cta TEXT, cta_secondary TEXT, cta_secondary_url TEXT, count_label TEXT,
    form_title TEXT, form_intro TEXT, consent TEXT,
    thanks_title TEXT, thanks_body TEXT, thanks_cta TEXT, thanks_dismiss TEXT,
    donate_title TEXT, donate_body TEXT, donate_amounts TEXT, donate_default TEXT, donate_frequency TEXT,
    donate_default_frequency TEXT, donate_custom_label TEXT, donate_button TEXT, donate_public_label TEXT,
    share_title TEXT, share_text TEXT, share_image TEXT,
    closed_body TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_petitions_slug ON petitions(slug)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_petitions_project ON petitions(project_slug, sort_order)`,

  // ── project tree (docs/decisions/project-tree-nested-urls.md) ─────────────
  // parent_slug nests a project under another (depth 2; validated by
  // packages/render/projects.js validateProjectTree). summary: markdown intro
  // for the project's hub page. Since 2026-10-09 projects keep their ids
  // across saves (replaceProjects upserts), so the slug links below are
  // rename-safe (the save cascades a rename).
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_slug TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS summary TEXT`,
  // Internal project notes (admin only, never rendered): markdown typed in
  // the admin or converted from an uploaded .md/.docx. folder matches the
  // project_files folder convention so notes and files share one tree.
  `CREATE TABLE IF NOT EXISTS project_notes (
    id UUID PRIMARY KEY,
    project_slug TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    body_md TEXT NOT NULL DEFAULT '',
    source_filename TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    author TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_project_notes_project ON project_notes(project_slug, folder, updated_at)`,

  // ── redirects (spec §9; packages/db/redirects.js) ─────────────────────────
  ...REDIRECTS_DDL,

  // ── two-person publishing (docs/systems/admin.md, packages/db/publish-requests.js)
  ...PUBLISH_REQUESTS_DDL,

  // ── newsletters (docs/systems/newsletters.md, packages/db/newsletters.js)
  ...NEWSLETTERS_DDL,

  // ── Documents + styling (spec §3.2, §5, §6, §9; packages/db/documents.js) ─
  // body_html_raw is exactly what was pasted and is never mutated; normalized
  // + ingest_report are regenerated on every save AND on every publish.
  // page_css is the page's own stylesheet text (published as a fingerprinted
  // file). SEO fields are structured (§12) — the head is generated.
  `CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT,
    template_key TEXT NOT NULL DEFAULT 'report',
    status TEXT NOT NULL DEFAULT 'draft',
    sort_order INTEGER NOT NULL DEFAULT 0,
    body_html_raw TEXT,
    body_html_normalized TEXT,
    ingest_report TEXT,
    page_css TEXT,
    meta_title TEXT,
    meta_description TEXT,
    meta_keywords TEXT,
    canonical_url TEXT,
    og_type TEXT,
    og_title TEXT,
    og_description TEXT,
    og_image TEXT,
    twitter_card TEXT,
    noindex INTEGER NOT NULL DEFAULT 0,
    nofollow INTEGER NOT NULL DEFAULT 0,
    jsonld_type TEXT,
    jsonld_overrides TEXT,
    allow_scripts INTEGER NOT NULL DEFAULT 0,
    sitemap_priority TEXT,
    published_at TIMESTAMPTZ,
    content_hash TEXT,
    live_hash TEXT,
    live_at TIMESTAMPTZ,
    last_publish_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_documents_status ON documents(status, sort_order)`,
  // Author (team member's full name) → JSON-LD Person with the author page's
  // @id + listing on /team/<slug> (docs/systems/author-pages.md). Existing clusters: ADD COLUMN.
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS author TEXT`,
  // Builder blocks (docs/systems/document-builder.md): the editing model as
  // JSON; body_html_raw is generated from it on save. NULL = a legacy
  // raw-HTML document edited in the HTML box. Existing clusters: ADD COLUMN.
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS body_blocks TEXT`,
  // The project a document sits under (projects.slug — a soft link like
  // project_files.project_slug: projects are re-inserted with new ids on every
  // save, so no FK). NULL = none, unless a project's CTA points at the page
  // (packages/render/projects.js projectOf). docs/systems/projects.md "Nesting".
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_slug TEXT`,
  // Nested URLs (docs/decisions/project-tree-nested-urls.md): a document
  // under a project publishes at /projects/<path>/<slug>. short_path: an
  // optional one-segment alias (e.g. /alpr) published as a 301 to it.
  // live_path: the path the last successful publish wrote, so the next
  // publish can 301 from it when the URL changes (and an archived document's
  // 410 lands on its last address). Both ride the KeyValueStore sync.
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS short_path TEXT`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS live_path TEXT`,
  // Slugs are unique PER PROJECT (two projects may each have a "report"):
  // the table-level UNIQUE on slug goes, project_slug stores '' (never NULL —
  // NULLs are distinct in a unique index) for "no project", and the unique
  // index is on the pair. documents.js documentToParams keeps '' for this
  // column; scripts/migrate-project-tree.mjs backfills existing NULLs.
  `ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_slug_key`,
  `ALTER TABLE documents ALTER COLUMN project_slug SET DEFAULT ''`,
  `CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_documents_address ON documents(project_slug, slug)`,
  // Rules match structure (selector subset, §6.2); scope 'template' rules
  // apply to every document with that template_key, 'page' rules to one.
  `CREATE TABLE IF NOT EXISTS style_rules (
    id UUID PRIMARY KEY,
    scope TEXT NOT NULL,
    template_key TEXT,
    document_id UUID,
    selector TEXT NOT NULL,
    classes TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 10,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  // Per-element exceptions keyed by node id (§6.3); can be orphaned by a re-paste.
  `CREATE TABLE IF NOT EXISTS style_overrides (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL,
    nid TEXT NOT NULL,
    classes TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'append',
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_style_overrides_doc ON style_overrides(document_id)`,
  // Foreign class → Style Kit class substitutions applied on ingest (§5.5).
  // to_class NULL = drop silently. template_key NULL = every template.
  `CREATE TABLE IF NOT EXISTS foreign_class_map (
    id UUID PRIMARY KEY,
    template_key TEXT,
    from_class TEXT NOT NULL,
    to_class TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
];

module.exports = { STATEMENTS };
