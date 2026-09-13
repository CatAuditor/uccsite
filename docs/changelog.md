# Changelog

One entry per push to the remote (CLAUDE.md rule). Version bumps: minor per
migration phase, patch per fix push. Open P0/P1 items are listed at the time
of each push.

## v0.7.0 — 2026-09-13 (branch `refactor`, not yet pushed)

State of the AWS rebuild (`docs/build-spec-aws.md`) at the end of Phase 7.
Everything below is on `refactor`; `main` still deploys the Cloudflare site.

### Phases 0–5 (2026-09-12)
- Renderer ported to `packages/render` with golden-file parity tests; named
  diffs (partials, clean-URL canonicals, donation total removed, 404 page).
- Content core: `html-ingest`, `style-kit`, `style-apply` (pure, tested).
- CDK stack per environment: S3 + CloudFront (OAC, headers policies,
  viewer-request function + KVS redirects, staging basic auth), Aurora
  DSQL, API Lambda Function URL with origin lock, Cognito pool/groups.
- Publish pipeline (hash diff, put-changed, invalidate, verify,
  `publish_runs`) + hourly drift reconciler + operational export bucket.
- API port (all routes + Stripe webhook, runtime Secrets Manager),
  D1 migration scripts, Turnstile front-end.

### Phase 7 — admin (2026-09-13)
- Next.js admin (`apps/admin`): Cognito PKCE login, role gating, typed
  editors for every collection, donations view, audit log, revisions with
  restore-and-republish, publish dashboard.
- Media library: presigned browser uploads, `MediaProcessFn` sharp
  AVIF/WebP variants under `/media/*`, alt-text gate, team headshot picker.
- Content export to git (`ExportContentFn`, GitHub App, commits only on
  change, `content-export` branches) + `restore-from-export.mjs`; staging
  restore drill passed.
- Review + fix loop (security / data-integrity / Next.js-ops): DB publish
  mutex with `refused` runs and recorded early failures, async retries off;
  one-transaction saves with lost-update stamps; form actions return
  `{ok}|{error}` (Next 15 masks thrown messages in prod); signed upload
  Content-Length; prod Cognito SRP-only; donor PII editor-only; Amplify
  build spec + checklist.
- `templates/weber-county.html` heading order restored to production's.

### Open items at this point
- P1 (blocked on operator): `TOKEN_SECRET` recovery, real API secrets,
  GitHub App secrets (export → then Decap retirement), Amplify GitHub
  install (admin hosting). See `docs/for-conner.md`.
- Phase 6 cutover not started (needs the above + explicit go).
