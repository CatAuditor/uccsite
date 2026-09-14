# 2026-09-13 — Admin dev server 500s / hangs: DSQL "access denied" from the wrong AWS profile

## Symptom

`npm run dev` in `apps/admin` (Next.js on :3000) appeared to hang in the browser;
`/login` was fine but every gated page (`/`, `/issues`, …) returned 500 after
several seconds. The terminal that started the server showed the error, but the
browser only showed a spinner / generic error.

## Error (server log)

```
[admin] nav categories unavailable: unable to accept connection, access denied
 ⨯ [error: unable to accept connection, access denied] {
  severity: 'FATAL',
  code: '08006',
  hint: 'User: arn:aws:iam::507024406243:user/laebel is not authorized to access this resource',
}
 GET / 500 in 8017ms
 GET /issues 500 in 2891ms
```

Route: any page that calls `withDb` (`apps/admin/lib/data.js` → `packages/db`,
which signs the DSQL auth token with `defaultProvider()`).

## Root cause

The dev server was started without `AWS_PROFILE=uccsite`, so the SDK default
credential chain picked the personal default profile (account 507024406243).
Aurora DSQL in the uccsite account (017110365763) rejects that principal at
connect time. Nothing in the app fails loudly at startup; the first DB read per
request throws and the page 500s.

The original hung server (no response at all on `/login` for 15s+) was the same
process wedged after repeated failing DB connections; killing and restarting it
cleared that.

## Fix

Start the dev server with the project profile, as `docs/systems/admin.md` and
`README.md` already say:

```powershell
$env:AWS_PROFILE='uccsite'; cd apps/admin; npm run dev
```

Verified after restart: `/login` 200, and a direct DSQL query via
`packages/db` under `AWS_PROFILE=uccsite` succeeds.

## What would catch it earlier

Quick check before starting the server:

```powershell
aws sts get-caller-identity --query Account --output text   # must print 017110365763
```

Added (same day): `scripts/admin-env.mjs` now writes `UCC_ACCOUNT_ID` from the
stack ARN, and `apps/admin/lib/aws-account.js` checks STS GetCallerIdentity
against it once per process — at boot via `instrumentation.js` (terminal line)
and before every DB use in `lib/data.js` (clear error instead of DSQL's
"access denied"). Verified: wrong profile → boot prints
`[admin] AWS credentials resolve to account 507024406243 (...) but UCC_ENV=staging lives in 017110365763. Restart with AWS_PROFILE=uccsite.`;
right profile → `[admin] AWS credentials OK: account 017110365763 (...)`.
Rerun `node scripts/admin-env.mjs --env staging` once to pick up the new var.

Gotcha hit while adding it: `instrumentation.js` is bundled by webpack, and
`lib/config.js`'s `require('node:path')` fails there (`UnhandledSchemeError:
Reading from "node:path"`), which also broke `/login`. `aws-account.js`
therefore reads `process.env` directly and must not import `config.js`.
