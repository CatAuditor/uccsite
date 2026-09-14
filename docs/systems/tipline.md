# Tipline

Confidential tip submission form at `/tip`.

Two backends exist until cutover (docs/migration/airtable-retirement-plan.md):

| Stack | Handler | Store |
|---|---|---|
| Cloudflare (live prod until the DNS flip) | `functions/api/tip.js` | Airtable base `appgd3KnYil6zQgHp` / table `tblRLdlEgvV1KqqiL`, secret `AIRTABLE_TOKEN` (see the "Cloudflare stack" section at the end) |
| AWS (staging now, prod at cutover) | `aws/api/routes.js` `tip()` | DSQL table `tips`; read in the admin at `/tips` |

Everything below describes the AWS stack unless marked otherwise.

## Architecture

```
templates/tip.html     ← form UI (built to /tip.html; noindex, not in sitemap)
js/tip.js              ← form controller (external file — site CSP blocks inline scripts)
  POST /api/tip
    aws/api/routes.js tip()   ← rate limit → Turnstile → validate → INSERT INTO tips
      packages/db/schema.js   ← tips table DDL
apps/admin/app/tips           ← staff triage (editor+): list, detail, status, owner delete
aws/export-operational        ← nightly snapshot to the RESTRICTED bucket (tips.json)
scripts/restore-operational.mjs ← restores it (ON CONFLICT (id) DO NOTHING)
scripts/migrate-tips.mjs      ← one-time Airtable → tips import (cutover + delta)
```

## `tips` table

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` on insert |
| `legacy_airtable_id` | TEXT UNIQUE | Airtable record id; import idempotency only. NULL for tips submitted on AWS |
| `name` | TEXT | the literal `Anonymous` when the box was ticked |
| `anonymous` | INTEGER | 0/1 |
| `email` | TEXT NOT NULL | always collected (see "Anonymous"); `''` only for imported Airtable rows that had none |
| `subject_of_tip` | TEXT | |
| `tip_summary` | TEXT NOT NULL | up to 100 000 chars |
| `status` | TEXT NOT NULL | `New` (default) → `In review` → `Closed`; imported rows keep their Airtable value verbatim |
| `created_at` | TIMESTAMPTZ | Airtable `createdTime` on import |
| `updated_at` | TIMESTAMPTZ | bumped on status change |

Index: `idx_tips_status_created (status, created_at)`.

## Request handling (`tip()`)

1. `rateLimitOr429(db, event, 'tip', 5)` — 5 / IP / hour, fails open if the DB is down (logged).
2. `turnstileOr403` when `TURNSTILE_SECRET_KEY` is set: missing/invalid `turnstileToken` → **403** `Verification failed. Please try again.` The widget renders on `/tip` only when `settings.turnstileSiteKey` is set (site key FIRST, then secret — docs/for-conner.md).
3. Validate: email via `isValidEmail` (cap 200, lowercased); `tip_summary` non-empty (cap 100 000); `name` / `subject_of_tip` cap 200.
4. `INSERT INTO tips (...) VALUES (gen_random_uuid(), …, 'New')`.

## Responses

| Status | When |
|---|---|
| 200 `{ok:true}` | Saved |
| 400 | Bad JSON, invalid email, or empty tip |
| 403 | Turnstile rejected |
| 429 | Rate limited |
| 500 | Insert failed (`Submission failed. Please try again.`) |

## Logging policy

This is a confidential tipline. `tip()` never logs request bodies or database
error messages — pg error text can echo parameter values. On insert failure
it logs `[api] tip insert failed: <ErrorName>` (the error **name** only).
The unit test `tip: insert failure 500s and logs the error name only` spies
on the console and fails if the tip text or email appears in any line. Keep
it that way. Admin page reads are not logged either.

## Admin (`/tips`, editor+)

Viewer role is refused — tips are contact PII plus confidential content, the
same rule as `/donations`. Staff can change `status` and (owner only) delete
a tip; both write `audit_log` (`tip.status`, `tip.delete`). Nobody can edit
what the tipster wrote. No CSV export by design.

## Export / backup

`tips` is in the operational export (`aws/export-operational`, restricted
bucket, 90-day expiry) and in `scripts/restore-operational.mjs`. It is
NEVER in the content export to GitHub (spec §14.2).

## Import from Airtable

`scripts/migrate-tips.mjs --env staging|prod [--dry-run]` reads every record
from the Airtable table with a **read-scoped** PAT passed as the
`AIRTABLE_TOKEN` env var (never stored in Secrets Manager), maps the fields
1:1, and inserts `ON CONFLICT (legacy_airtable_id) DO NOTHING`. Prints
counts only. Run before the cutover flip, again after propagation (delta),
and again after any rollback. Runbook: docs/for-conner.md.

## "Anonymous"

The checkbox only blanks the `name` field. Email is still required and
stored so staff can follow up — the form copy should not promise more than
that.

## Attachments

Not wired. The form accepts files; the API ignores them. When built, the path
is a presigned PUT to a restricted prefix in the media bucket, never a public
URL.

## Cloudflare stack (unchanged until retirement)

`functions/api/tip.js` validates via `_lib.js` and POSTs `{fields}` to the
Airtable REST API with the Pages secret `AIRTABLE_TOKEN` (scope
`data.records:write`, Tip Intake base only). Field mapping: `name`,
`anonymous` (checkbox), `email`, `subject_of_tip`, `tip_summary` (long text),
`status` → "New". Responses: 502 upstream error, 503 token unset. Airtable
error bodies echo field values, so only status codes are logged. This path
stays deployable as rollback for 30 days after cutover, then the base and
token are deleted (plan §Cutover).
