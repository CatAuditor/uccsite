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
    outlet TEXT, badge_color TEXT, date TEXT, headline TEXT, url TEXT,
    read_more TEXT, lang_attr TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS project_videos (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    sort_order INTEGER NOT NULL,
    outlet TEXT, badge_color TEXT, date TEXT, headline TEXT,
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
];

module.exports = { STATEMENTS };
