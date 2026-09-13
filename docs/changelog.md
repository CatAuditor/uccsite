# Changelog

One entry per push to the remote (CLAUDE.md rule). Version bumps: minor per
migration phase, patch per fix push. Open P0/P1 items are listed at the time
of each push.

## v0.8.0 — 2026-09-13 (branch `refactor`, not yet pushed)

Phase 8 — Documents & styling (`docs/systems/documents.md`).

### Documents
- Data model (`documents`, `style_rules`, `style_overrides`, `foreign_class_map`),
  compose layer (ingest on every publish → rules/overrides → tokens → shell
  with a generated SEO head + JSON-LD), page CSS as fingerprinted files.
- The eight long-form pages migrated into Documents with a parity proof;
  staging publishes them from the database (a Document replaces the
  same-slug template). Ingest allowlist widened for the reports (ADR).
- Admin: document list by category, editor (SEO panel with SERP preview,
  HTML/CSS editors + ingest report, element tree ↔ live preview, class
  picker, bulk apply, promote-to-rule), Styles page (rules with match
  counts, foreign class map, Style Kit catalog), restore path.
- Content export v2 (documents/, styles/rules.json) + restore drill passed.

### Site
- CSP tightened on AWS to `style-src 'self'; font-src 'self'`: self-hosted
  fonts, fixed pages' styles moved to `css/pages/*.css`, inline style
  attributes replaced by classes, generated `css/colors.css`.
- 24 Style Kit annotations in `css/styles.css`.

### Open items at this point
- Same operator blockers as v0.7.0 (secrets, GitHub App, Amplify install).
- Phase 8 review/fix loop in progress at the time of this entry.

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
