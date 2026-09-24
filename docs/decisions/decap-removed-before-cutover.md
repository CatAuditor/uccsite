# Decap CMS removed from the AWS site before cutover, not at day 30

**Date:** 2026-09-23

## Decision
`static/admin/`, the `/admin` and `/admin/*` CloudFront behaviours, the
`AdminHeaders` response-headers policy, `ADMIN_CSP` and the `/admin/*` block in
`static/_headers` are deleted on `refactor`. Both AWS environments 404 at
`/admin`. Cloudflare keeps its copy — that code lives on `main` and still serves
the live site until the flip.

## Why
The runbook retired Decap at §7.8, thirty days after cutover. It was being
published to the AWS site meanwhile: HTTP 200, no authentication, serving a
`config.yml` naming `backend: github, repo: CatAuditor/uccsite, branch: main`.

After the DNS flip that becomes a live, unauthenticated admin on
`utahciviccompact.org/admin` that writes to git — a second publish path around
the two-person rule, reachable by anyone holding a token for a public
repository. `robots.txt` disallowed it, but that is a crawler hint, not access
control, and staging's basic-auth gate does not exist on prod.

Waiting thirty days meant running the whole parallel period with that path open.

## Alternatives
- **Gate it behind basic auth on prod.** Keeps a retired system alive and adds a
  credential to manage, for something with no remaining users.
- **Leave it and rely on `robots.txt`.** Not access control.

## Consequences
- `/admin` and `/admin/*` serve the site CSP and 404. `staging-check` asserts
  both, replacing the three checks that asserted the loosened policy.
- The CloudFront `AdminHeaders` policy is destroyed on both stacks.
- Cloudflare-era editing is unaffected — `main` still has `static/admin/`.
- `docs/decisions/csp-split-admin.md`'s `/admin/*` half is retired; the strict
  site-wide policy it introduced stands.

## What breaks if reversed
Restoring `static/admin/` to `refactor` republishes an unauthenticated
GitHub-backed editor onto the production origin. If Decap is ever genuinely
needed again, it belongs behind the Cognito pool, not on a public path.
