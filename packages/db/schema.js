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
  // Double opt-in (2026-10-05, docs/systems/newsletters.md "Confirmed
  // subscribers"): a join-form row is mailed only once confirmed_at is set
  // (GET /api/confirm from the welcome email). Petition signers are confirmed
  // at insert (signing = consent). Rows older than the feature are
  // grandfathered — the UPDATE is idempotent and bounded by the cutoff date.
  `ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`,
  `UPDATE subscribers SET confirmed_at = created_at WHERE confirmed_at IS NULL AND created_at < '2026-10-07T00:00:00Z'`,
  // Soft unsubscribe (2026-10-06, docs/systems/newsletters.md "Mailing list
  // management"): the unsubscribe link and the admin's "Remove from list"
  // stamp unsubscribed_at instead of deleting the row, so the admin can see
  // who left and when. unsubscribed_by = 'self' (their link) or the admin's
  // email. Signing up again / signing a petition clears both (fresh consent).
  `ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ`,
  `ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS unsubscribed_by TEXT`,

  // Campaign-level newsletter opens (docs/systems/newsletters.md "Opens"):
  // one anonymous row per pixel hit — newsletter id + time, nothing else.
  `CREATE TABLE IF NOT EXISTS newsletter_opens (
    id UUID PRIMARY KEY,
    newsletter_id UUID NOT NULL,
    at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_newsletter_opens_newsletter ON newsletter_opens(newsletter_id)`,

  // SES bounce/complaint/reject ledger (packages/db/email-events.js).
  ...require('./email-events').DDL,

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

  // Petition signatures (docs/systems/petition.md). `petition` is the campaign
  // slug the public form posts (content-driven: homepage.petition.slug), so a
  // new campaign is new copy + a new slug, no schema change. One signature
  // per email per petition — a re-sign updates the row, never duplicates.
  // created_at is the signing timestamp the CSV exports.
  `CREATE TABLE IF NOT EXISTS petition_signatures (
    id UUID PRIMARY KEY,
    petition TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    zip TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (petition, email)
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_petition_signatures_petition_created ON petition_signatures(petition, created_at)`,
  // Filed under a project (2026-10-09, docs/systems/petition.md "Project"):
  // the project the campaign belonged to WHEN it was signed, copied from
  // homepage.petition.project_slug by the API, so a past campaign keeps its
  // project after the slug moves on. NULL = signed before this column or the
  // campaign had no project. The UDOT ALPR petition belongs to `alpr`.
  `ALTER TABLE petition_signatures ADD COLUMN IF NOT EXISTS project_slug TEXT`,
  `UPDATE petition_signatures SET project_slug = 'alpr' WHERE petition = 'udot-alpr-permits' AND project_slug IS NULL`,

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

// Least-privilege role for the public API Lambda (docs/systems/api-security.md
// "DSQL access"). It connects as API_ROLE with a dsql:DbConnect token, never as
// admin, so a compromised public route cannot read what it has no grant for —
// notably `tips` (INSERT only: the tipline is write-only from the internet,
// as it was under Airtable's write-scoped token). UPDATE/DELETE with a WHERE
// clause needs SELECT on the table in Postgres, hence SELECT on those.
// scripts/migrate-schema.mjs creates the role, maps it to the Lambda's IAM
// role (AWS IAM GRANT) and applies these — re-run it whenever a route needs a
// new table or privilege; GRANT is idempotent. Content tables get nothing.
// (No GRANT USAGE ON SCHEMA public: DSQL rejects it, 0A000 "feature not
// supported on system entity"; usage on public is implicit.)
const API_ROLE = 'api';
const API_GRANTS = [
  `GRANT SELECT, INSERT, DELETE ON rate_limits TO ${API_ROLE}`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON subscribers TO ${API_ROLE}`,
  `GRANT SELECT, INSERT, UPDATE ON members TO ${API_ROLE}`,
  `GRANT SELECT, INSERT, UPDATE ON subscriptions TO ${API_ROLE}`,
  `GRANT SELECT, INSERT ON donations TO ${API_ROLE}`,
  `GRANT SELECT, INSERT, DELETE ON processed_events TO ${API_ROLE}`,
  `GRANT INSERT ON tips TO ${API_ROLE}`,
  `GRANT INSERT ON newsletter_opens TO ${API_ROLE}`, // the open pixel; never SELECT
  // Upsert (ON CONFLICT DO UPDATE needs SELECT + UPDATE); never DELETE.
  `GRANT SELECT, INSERT, UPDATE ON petition_signatures TO ${API_ROLE}`,
  // The ONE content exception (docs/systems/api-security.md): read-only on
  // the homepage singleton + projects so the petition route can file a
  // signature under the campaign's project and the thank-you emails can carry
  // the admin's copy. Both are public-site content; never INSERT/UPDATE.
  `GRANT SELECT ON homepage TO ${API_ROLE}`,
  `GRANT SELECT ON projects TO ${API_ROLE}`,
  // Attached automatic emails (packages/db/newsletters.js transactional_emails,
  // docs/systems/email.md "Attached emails"): the frozen subject/html per trigger.
  `GRANT SELECT ON transactional_emails TO ${API_ROLE}`,
];

module.exports = { STATEMENTS, API_ROLE, API_GRANTS };
