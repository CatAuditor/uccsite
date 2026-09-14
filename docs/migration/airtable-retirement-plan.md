# Airtable retirement plan (tipline → DSQL)

Status: BUILT 2026-09-14 (commits 4e292ce..). Staging verified: tip-smoke 7/7, staging-check 26/26, admin headless (status/role-refusal/owner delete/audit) OK, export+restore drill incl. tips. Remaining = the Conner/cutover steps in docs/for-conner.md. Org decision: Airtable is the only
non-AWS dependency retired in this pass. Stripe, Resend, Mailgun, GitHub,
Cloudflare DNS + Turnstile all stay (see the 2026-09-14 dependency audit in
the session; Resend/Mailgun → SES and Cloudflare DNS → Route 53 are possible
later moves, explicitly deferred).

## Goal

`/api/tip` on the AWS stack writes tips to a `tips` table in DSQL. Staff read
and triage them in the admin. The Airtable base, the `AIRTABLE_TOKEN` secret,
and the Airtable REST call disappear from the AWS stack. The Cloudflare stack
(`functions/api/tip.js`) is NOT touched — it keeps writing to Airtable until
cutover, and stays deployable as rollback for 30 days after.

Done means:

- `node --test` green in `aws/api` with the Airtable test replaced.
- Staging: POST `/api/tip` → 200, one row in `tips`, and a CloudWatch search of
  the API log group for the test tip text returns **zero** hits.
- Admin `/tips` (editor+): list, detail, status change, owner-only delete;
  every mutation lands in `audit_log`; a viewer gets the role refusal.
- `export-operational` output includes `tips.json`; `restore-operational.mjs`
  restores it (staging drill).
- `scripts/migrate-tips.mjs` imports every Airtable record idempotently and
  prints counts only.
- Docs, ADR, data-handling, for-conner, spec addendum, changelog updated.

## Non-goals

- Attachments (still unimplemented; the form's file input stays inert). When
  built, the path is a presigned PUT to a restricted prefix, never a public URL.
- Email notification to staff on new tip (not in Airtable today either; could
  be a Resend send later — not now).
- CSV export of tips. Confidential; read it in the admin.

## Design

### Schema (`packages/db/schema.js`, operational table)

```sql
CREATE TABLE IF NOT EXISTS tips (
  id UUID PRIMARY KEY,
  legacy_airtable_id TEXT UNIQUE,        -- import idempotency; NULL for new tips
  name TEXT,                             -- 'Anonymous' literal when anonymous=1
  anonymous INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL,
  subject_of_tip TEXT,
  tip_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',    -- New | In review | Closed
  created_at TIMESTAMPTZ DEFAULT now(),  -- Airtable date_received on import
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_tips_status_created ON tips(status, created_at);
```

Column names mirror the Airtable fields exactly (same discipline as the D1
port). One DDL per transaction; apply with `scripts/migrate-schema.mjs`.

**Open question (default chosen):** Airtable `status` single-select options.
Plan assumes `New`, `In review`, `Closed`. If the base uses other values the
import keeps them verbatim and the admin status picker lists whatever is
present plus the three defaults.

### API (`aws/api/routes.js` `tip()`)

Unchanged: rate limit 5/hr key `tip`, Turnstile 403, validation (400s),
`str()` caps, the logging policy (status codes only — never bodies).

Changed:
- Remove `AIRTABLE_URL`, the `AIRTABLE_TOKEN` 503 gate, and the fetch.
- Insert: `INSERT INTO tips (id, name, anonymous, email, subject_of_tip,
  tip_summary, status) VALUES ($1..$7)` with a client-generated UUID
  (same pattern as `subscribers` inserts).
- DB failure → 500 `Submission failed. Please try again.`, logged as
  `[api] tip insert failed: <err.name>` (name only, never message — pg
  errors can echo parameter values).
- Response table becomes: 200 / 400 / 403 / 429 / 500. The 502 and 503 go.

`aws/api/secrets.js` `NAMES` drops `AIRTABLE_TOKEN`. CDK derives the secret
list from `NAMES`, so `ucc/<env>/AIRTABLE_TOKEN` is removed from the stack on
the next deploy (staging: destroyed; prod: RETAIN policy → orphaned, delete by
hand at retirement, see runbook).

Tests (`aws/api/test/api.test.mjs`): replace the 503 test with
- tip inserts one row with the expected columns and returns 200;
- anonymous replaces name with the literal;
- 400 on bad email / empty summary;
- 500 on insert failure, and a console spy asserts no log line contains the
  tip text or email.

### Admin (`apps/admin`)

- `app/tips/page.js` — `requireRole('editor')` (confidential PII, same rule
  as `/donations`). Table: received, status, subject, name, email, first ~80
  chars of summary. Filter by status (default: not Closed). Newest first,
  LIMIT 500.
- `app/tips/[id]/page.js` — full record, status picker + save, owner-only
  Delete with confirm. Both go through `runAction` → `{ ok } | { error }` and
  `ActionForm`. Both call `recordChange` with `entityType: 'tip'` so the
  audit trail has actor/action/diff (`action: 'tip.status'` /
  `'tip.delete'`). No revisions row — tips are not content.
- Nav: `Operations` group, `['/tips', 'Tips']` next to Donations/Subscribers.
- No edit of tip body. Staff never alter what the tipster wrote.

### Export / restore

- `aws/export-operational/index.mjs` `TABLES` += `'tips'`.
- `scripts/restore-operational.mjs` table list += `'tips'` (ON CONFLICT (id)).
- Restricted bucket only. Never the content export (§14.2 rule: operational
  data never reaches git).

### One-time import (`scripts/migrate-tips.mjs`)

Mirrors `scripts/migrate-d1.mjs`:
- `--env staging|prod`, `--dry-run`.
- Reads `AIRTABLE_TOKEN` from the environment (a **read-scoped** token created
  for this run only; never stored in Secrets Manager).
- Pages Airtable `GET /v0/appgd3KnYil6zQgHp/tblRLdlEgvV1KqqiL` (`offset`
  cursor, 100/page).
- Maps `fields.{name,anonymous,email,subject_of_tip,tip_summary,status}`,
  `createdTime` → `created_at`, `record.id` → `legacy_airtable_id`.
  Missing email (older Airtable rows may have none) → stored as `''`; the
  NOT NULL holds and the admin shows "(none)".
- `INSERT … ON CONFLICT (legacy_airtable_id) DO NOTHING`; re-runnable for the
  cutover delta.
- Output: fetched N, inserted M, skipped K. **Never prints a field value.**

### Cutover interaction (Phase 6)

Cloudflare prod writes to Airtable until the DNS flip. So:
1. Before flip: run `migrate-tips.mjs --env prod` (full import).
2. After flip + propagation window: run it again (delta — whatever landed in
   Airtable during split-brain). Same shape as the D1 delta step already in
   the cutover runbook.
3. Airtable base stays alive, read-only, for the 30-day Cloudflare rollback
   window. If rollback happens, tips resume landing in Airtable and a third
   import runs when AWS comes back.
4. Day 30: revoke the read token, delete the base, delete the retained prod
   `ucc/prod/AIRTABLE_TOKEN` secret by hand. Airtable retired.

Staging gets a full import earlier so the admin page is exercised on real
shapes (the staging DSQL is already restricted; treat it as prod-sensitive).

## Conner (hand) items → `docs/for-conner.md`

- **Drop:** the `AIRTABLE_TOKEN` write-token row from the secrets table.
- **Add:** create a read-only Airtable PAT (`data.records:read`, Tip Intake
  base only), hand it to the agent as an env var for the import runs, revoke
  after the day-30 step.
- **Add** to the cutover checklist: steps 1–4 above.
- **Confirm** the Airtable `status` option values (open question).

## Docs touched

| File | Change |
|---|---|
| `docs/systems/tipline.md` | Rewrite: DSQL architecture, table, responses, admin page, import, logging policy unchanged |
| `docs/systems/admin.md` | Code Map + coverage table rows for `/tips`; audit actions |
| `docs/systems/api-security.md` | line 12 route note, line 86 secrets inventory |
| `docs/error-handling/debug/api.md` | replace the Airtable log rows with `tip insert failed: <name>` |
| `docs/legal/data-handling.md` | remove Airtable third-party row; add `tips` DB row (fields, confidential, retention: until deleted by an owner in the admin; exported nightly to the restricted bucket, 90-day noncurrent) |
| `docs/for-conner.md` | as above |
| `docs/build-spec-aws.md` | addendum 13: Airtable retired, `/api/tip` → DSQL, admin Tips page, §17 secret list minus `AIRTABLE_TOKEN` |
| `docs/decisions/tipline-dsql.md` | ADR: chose own DB over Airtable (one fewer vendor + token, confidentiality inside the already-gated admin, export covers it); alternatives (keep Airtable, DynamoDB); what breaks if reversed (admin page, export, import script all assume the table) |
| `docs/changelog.md` | one entry per push |
| `docs/non-technical-editing-guide.md` | short "Tips" section: where to read, statuses, who can delete |

`wrangler.toml`, `functions/api/tip.js`, `docs/state-of-the-site.md` stay as
they are — they describe the Cloudflare stack, which is unchanged.

## Commit sequence

1. `Tips: DSQL table + export/restore coverage` — schema.js, export-operational, restore-operational; apply to staging.
2. `API: /api/tip writes to DSQL, retire AIRTABLE_TOKEN` — routes.js, secrets.js, tests, debug/api.md, api-security.md, tipline.md.
3. `Admin: Tips page (list, detail, status, owner delete, audited)` — apps/admin, admin.md, editing guide.
4. `Scripts: migrate-tips.mjs one-time Airtable import` — script + for-conner.
5. `Docs: tipline ADR, data-handling, spec addendum 13` .
6. Deploy staging (`cdk deploy UccStaging`), run staging-check + a tip smoke
   (POST, assert row, assert log-group has no body text, delete the row),
   export drill; fix loop; changelog entry on push.

Review loop after step 6 (same 3-angle pattern as prior phases: security /
data-integrity / Next.js ops), then fix pass.

## Risks

- **Log leakage** is the only real one. Two guards: the test console spy, and
  the staging CloudWatch search in the DoD. Keep pg error *messages* out of
  logs (name only).
- **Import of rows with no email** — NOT NULL would reject; handled by `''`.
- **Prod secret orphan** — RETAIN policy leaves `ucc/prod/AIRTABLE_TOKEN`
  behind; runbook step deletes it.
