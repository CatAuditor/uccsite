# Tipline storage: own `tips` table instead of Airtable

**Date:** 2026-09-14 · **Status:** Accepted · **Spec ref:** `docs/build-spec-aws.md` addendum 13, §9, §10, §14.3

## Decision

On the AWS stack, `/api/tip` inserts into a `tips` table in DSQL and staff
triage tips in the admin (`/tips`). Airtable, the `AIRTABLE_TOKEN` secret and
the Airtable REST call are gone from `aws/`. The Cloudflare stack
(`functions/api/tip.js` → Airtable) is untouched until its own retirement.

## Alternatives

- **Keep Airtable** (the spec's original §10 line). Works, but it is one more
  vendor, one more token to rotate, and a copy of the most sensitive data the
  org holds living outside the account the rest of the PII lives in.
- **DynamoDB table.** No benefit over a table in the database the API and
  admin already talk to; it would need its own export path and admin client.
- **Email the tip to staff (Resend) and store nothing.** Loses triage state
  and puts confidential text into mailboxes.

## Why this one

- Every other operational record already lives in DSQL with a nightly
  restricted export and a role-gated admin. Tips get the same protections for
  free: encryption at rest, editor-only reads, owner-only deletes, audit rows.
- The org decided (2026-09-14) that Airtable is the only non-AWS dependency
  retired in this pass, so the change is small and self-contained.
- Confidentiality guarantees get stronger, not weaker: the API logs the pg
  error *name* only (Airtable error bodies used to echo field values), and
  the unit tests spy on the console for leaks.

## Consequences / what breaks if reversed

- The admin Tips page, `aws/export-operational`, `restore-operational.mjs` and
  `scripts/migrate-tips.mjs` all assume the `tips` table. Reinstating the
  Airtable proxy would need the secret back in `aws/api/secrets.js` (CDK
  derives the Secrets Manager set from that list) and would orphan every tip
  submitted on AWS.
- Deleting a tip is permanent; the audit row records only that a deletion
  happened (no snapshot, by design — deleted contents must not survive in
  `audit_log`).
- Attachments are still unimplemented; when built they must go to a
  restricted prefix, never a public URL (the Airtable design needed public
  URLs, which is one more reason not to go back).
