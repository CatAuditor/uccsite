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
    name TEXT, title TEXT, photo TEXT, bio TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
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

  // ── Documents + styling (spec §3.2, §5, §6, §9; packages/db/documents.js) ─
  // body_html_raw is exactly what was pasted and is never mutated; normalized
  // + ingest_report are regenerated on every save AND on every publish.
  // page_css is the page's own stylesheet text (published as a fingerprinted
  // file). SEO fields are structured (§12) — the head is generated.
  `CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
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
