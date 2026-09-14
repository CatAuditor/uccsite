'use strict';
// DSQL schema for the operational tables (build-spec-aws.md §9, ADR
// aws-datastore-dsql.md). Ported from schema.sql (D1/SQLite) with the
// dialect changes the ADR records:
//   INTEGER PRIMARY KEY AUTOINCREMENT → UUID PK, client-generated
//   datetime('now') defaults          → now()
//   column REFERENCES kept (DSQL supports FKs since 2026-08-26)
// Table and column names are unchanged — the port stays mechanical.
// legacy_id columns carry the old D1 integer ids through migration
// verification (dropped afterwards; scripts/migrate-d1.mjs).
//
// DSQL: one DDL statement per transaction — apply these individually
// (scripts/migrate-schema.mjs).

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY,
    legacy_id INTEGER,
    stripe_customer_id TEXT UNIQUE,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    zip TEXT,
    newsletter_opt_in INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_members_email ON members(email)`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY,
    legacy_id INTEGER,
    member_id UUID REFERENCES members(id),
    stripe_subscription_id TEXT UNIQUE,
    stripe_price_id TEXT,
    amount_cents INTEGER,
    status TEXT,
    current_period_end TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`,

  `CREATE TABLE IF NOT EXISTS donations (
    id UUID PRIMARY KEY,
    legacy_id INTEGER,
    member_id UUID REFERENCES members(id),
    stripe_payment_intent_id TEXT UNIQUE,
    amount_cents INTEGER,
    public INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  // The donor ticker's exact access path (schema.sql had no donations index).
  `CREATE INDEX ASYNC IF NOT EXISTS idx_donations_public_created ON donations(public, created_at)`,

  `CREATE TABLE IF NOT EXISTS subscribers (
    id UUID PRIMARY KEY,
    legacy_id INTEGER,
    email TEXT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    address TEXT,
    zip TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,

  // Tipline (docs/migration/airtable-retirement-plan.md): replaces the
  // Airtable base. Column names mirror the old Airtable fields exactly.
  // legacy_airtable_id = Airtable record id, import idempotency only.
  `CREATE TABLE IF NOT EXISTS tips (
    id UUID PRIMARY KEY,
    legacy_airtable_id TEXT UNIQUE,
    name TEXT,
    anonymous INTEGER NOT NULL DEFAULT 0,
    email TEXT NOT NULL,
    subject_of_tip TEXT,
    tip_summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'New',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_tips_status_created ON tips(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY,
    ip TEXT,
    endpoint TEXT,
    timestamp INTEGER
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_rate_limits_lookup ON rate_limits(ip, endpoint, timestamp)`,

  `CREATE TABLE IF NOT EXISTS processed_events (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_processed_events_created ON processed_events(created_at)`,
];

module.exports = { STATEMENTS };
