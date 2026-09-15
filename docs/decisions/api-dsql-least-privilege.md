# API Lambda connects to DSQL as a least-privilege role, not `admin`

**Date:** 2026-09-14 · **Status:** Accepted · **Spec ref:** `docs/build-spec-aws.md` §9, §10; `docs/systems/api-security.md` "DSQL access"

## Decision

The public API Lambda (`aws/api`) connects to Aurora DSQL as the custom
database role `api`, authenticated with a `dsql:DbConnect` token, and holds
only the table privileges its routes use (`packages/db/schema.js`
`API_GRANTS`). Every other DB client (admin app, publish, export, reconcile,
scripts) keeps the DSQL-managed `admin` role and `dsql:DbConnectAdmin`.

`scripts/migrate-schema.mjs` provisions the role: `CREATE ROLE api WITH
LOGIN`, `AWS IAM GRANT api TO '<ApiRoleArn>'` (the Lambda execution role, a
stack output), then the grants. All three steps are idempotent. The stack
sets `DSQL_USER=api` on the function; `packages/db` `connect()` picks the
token type from the user name.

## Why

- The API is the only internet-facing database client. Under Airtable the
  tipline was write-only from the internet (a `data.records:write` token);
  moving tips into DSQL while the API connected as `admin` would have let any
  compromised public route read every confidential tip, and every donor row.
  The 2026-09-14 security review flagged exactly that.
- Postgres grants are the cheapest control available: no new service, no
  code path change beyond a `user` option, and the grant list doubles as
  documentation of what each route may touch.

## Alternatives

- Keep `admin` and accept the risk (the first draft of the tipline ADR did).
  Rejected the same day: the fix is ~40 lines.
- A separate cluster or database for tips. Overkill; the API still needs to
  insert, and the admin still needs to read.

## Consequences / what breaks if reversed

- A route that touches a table or privilege not in `API_GRANTS` fails with
  `permission denied for table …` (SQLSTATE 42501). Add the grant to
  `API_GRANTS` and re-run `migrate-schema.mjs`; do not hand the API back
  `DbConnectAdmin`.
- Fresh cluster ordering: deploy the stack (which creates the Lambda role and
  the `ApiRoleArn` output) BEFORE `migrate-schema.mjs`; until the script has
  run, the API cannot connect (health check 503). `docs/for-conner.md` §6
  already runs them in that order. After `AWS IAM GRANT` the mapping takes
  ~2-3 minutes to propagate (observed on staging: `access denied` for that
  window, then clean).
- DSQL rejects `GRANT USAGE ON SCHEMA public` (0A000, system entity); schema
  usage is implicit, so `API_GRANTS` lists tables only.
- `sys.iam_pg_role_mappings` shows the mapping; `AWS IAM REVOKE api FROM
  '<arn>'` removes it.
