# Datastore for the AWS rebuild: Aurora DSQL

**Date:** 2026-09-12 · **Status:** Accepted · **Spec ref:** `docs/build-spec-aws.md` §1.2, §9

## Decision

The D1 (SQLite) database ports to **Aurora DSQL** (us-west-2, account 017110365763).
Confirmed with the org during plan review.

## Why

- The API Lambda must reach both the database and third-party HTTPS APIs (Stripe,
  Resend, Airtable). DSQL needs no VPC placement, so the Lambda stays VPC-free —
  no NAT gateway (~$32/mo), no cold-resume risk on the Stripe webhook path.
- Free tier (100K DPUs + 1 GB/month, non-expiring) covers this workload outright.
- The spec's fallback trigger — "schema.sql uses foreign keys → Aurora Serverless
  v2" — was written against pre-Aug-2026 DSQL. **DSQL has supported foreign keys
  and sequences since 2026-08-26**, so the trigger no longer fires.

## Evidence (spike, 2026-09-12)

`scripts/dsql-spike.mjs` against a scratch cluster (`hnucl2nuxyvm6mob5huqmg2zam`,
created and deleted same day) — 10/10:

- IAM-token connect from Node (`pg` + SigV4 presign); server is PostgreSQL 16
- `CREATE TABLE` with `DEFAULT gen_random_uuid()` and `DEFAULT now()` — both populate
- `INSERT ... ON CONFLICT (col) DO NOTHING RETURNING id` — rowCount 1 then 0
- `INSERT ... ON CONFLICT DO UPDATE SET ... excluded.*` with COALESCE — works
- Column-level `REFERENCES` FK — creates AND enforces (orphan insert rejected)
- `LIKE 'cus_%'`; duplicate plain INSERT raises SQLSTATE 23505

## Consequences / port rules

- Primary keys: client-generated UUIDs (`crypto.randomUUID()`), not sequences —
  AWS guidance, and sequence caches produce gaps. `processed_events.id` stays TEXT.
- Keep the two `REFERENCES` FKs from `schema.sql` (supported; semantics identical).
- Keep all four load-bearing UNIQUE constraints (every upsert relies on them).
- Dialect rewrites: `datetime('now')` → `now()`; `INSERT OR IGNORE` →
  `ON CONFLICT DO NOTHING`; D1 `meta.changes` → `rowCount`; `?` binds → `$n`.
- DSQL constraints that bind the query layer (`packages/db`):
  - Repeatable Read only; optimistic concurrency — retry writes on SQLSTATE 40001 (OC000)
  - 1 DDL statement per transaction (migration scripts run DDL individually)
  - ≤3,000 rows per DML transaction (bulk import chunks)
  - Connections killed at 1 hour — pool max-lifetime well under that
  - IAM auth token per connection (`password` as async function)
- Local dev machine clock skew note: this Windows host runs ~10-15s ahead of AWS;
  SigV4 presigns from it must backdate `signingDate` (see `scripts/dsql-spike.mjs`)
  or the connection fails with "Signature not yet current". Lambda clocks are not
  affected.

## What breaks if reversed

Moving to Aurora Serverless v2 without reading this: the Lambda needs VPC + NAT
(cost), or the Data API (different client code), and scale-to-zero adds ~15s
resume on the webhook path — either a ~$44/mo ACU floor or lost-webhook risk.
