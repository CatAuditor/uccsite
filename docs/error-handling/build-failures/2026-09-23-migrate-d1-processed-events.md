# 2026-09-23 — migrate-d1.mjs aborts on a missing `processed_events` table

## Error

```
no such table: processed_events: SQLITE_ERROR [code: 7500]
```

Raised by `wrangler d1 execute ucc-members --remote` inside
`scripts/migrate-d1.mjs`, at the unguarded read:

```js
const processedEvents = d1('SELECT * FROM processed_events ORDER BY id');
```

## Cause

`schema.sql` declares six tables, but the live D1 database has five.
`wrangler d1 info ucc-members` reports `num_tables = 5`; the missing one is
`processed_events`.

The table was never applied to production. `main`'s `functions/api/webhook.js`
contains no reference to `processed_events` at all — Stripe webhook idempotency
is a `refactor`-branch concept that was never deployed to Cloudflare. The
schema file described the intended state, not the deployed one.

Because the read sat before any DSQL write, the whole donor migration
(runbook §6.6) and the cutover delta re-run (§7.5) aborted before moving a
single row.

## Fix

Added `d1Optional(sql, table)` next to `d1()`. It catches the
`no such table: <name>` error for that one table, logs the fact, and returns
`[]`; every other failure still throws. There is nothing to migrate, so zero
rows is the correct result — creating the table in D1 first would have carried
across an empty table for no benefit.

Verified:

```
$ node scripts/migrate-d1.mjs --env prod --dry-run
Reading D1…
D1 has no processed_events table — migrating 0 rows.
D1: members=17 subscriptions=1 donations=5 subscribers=36 processed_events=0 donations SUM=27500
Dry run — nothing written.
```

## What would have caught this earlier

The script trusted `schema.sql` as a description of the live database. Nothing
compared the two. Any migration script that reads a source system should treat
its schema file as a claim to verify, not a fact — `wrangler d1 info` reports
the real table count in one call.

The same gap produced two neighbouring surprises found the same day: production
still serves `totalCents`/`goalCents` from `/api/donations/stats` (the removal
shipped only on `refactor`), and `TOKEN_SECRET` has never existed as a Pages
secret. `docs/state-of-the-site.md` and `docs/for-conner.md` describe the
`refactor` working tree in several places where they read as descriptions of
the live Cloudflare system.
