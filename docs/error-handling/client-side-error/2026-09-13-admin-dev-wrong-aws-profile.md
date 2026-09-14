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

A startup assertion in `apps/admin/lib/config.js` comparing the resolved account
to the expected one would make this fail loud in one line; not added (out of
scope for this fix).
