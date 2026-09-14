# Changelog

One entry per push to the remote (CLAUDE.md rule). Version bumps: minor per
migration phase, patch per fix push. Open P0/P1 items are listed at the time
of each push.

## v0.9.1 — 2026-09-13 (branch `refactor`, pushed 2026-09-13)

Follow-ups that needed no operator input:
- `allow_scripts` escape hatch implemented in the sanitizer (src-only,
  allowlisted host, content emptied, every toggle audited).
- Media library refuses to delete an asset still referenced by a team
  headshot or a document; cards show "Used by …".
- Style Kit: 143 of 151 classes annotated (`scripts/annotate-style-kit.mjs`);
  the parser now accepts stacked `@class` comments on a shared rule.
- Review fixes: `allow_scripts` cannot be re-enabled by an editor through a
  revision restore (owner-only on every path, audited); kept scripts carry
  src/async/defer only; dropped scripts are explained in the ingest report;
  media usage computed in a few queries and also covers markdown links.

## v0.9.0 — 2026-09-13 (branch `refactor`; first pushed with v0.9.1)

Phase 9 — Projects and cleanup (`docs/systems/projects.md`).

- Admin projects editor with nested press articles / videos (recursive list
  editor), filter box and A–Z / newest-first sorting; whole tree saved in one
  transaction; restore path handles the nested snapshot.
- `/projects` gains client-side status/region filters and sort (featured,
  newest, A–Z) with no inline script/style; option lists derived from content.
- ADR reconciliation: every pre-migration decision carries a status line;
  cms.md and state-of-the-site.md point at the AWS state.
- Review fixes: `[hidden]` always wins (filter controls truly hidden without
  JS), one deterministic free-text date parser shared by site and admin
  (`packages/render/dates.mjs`), `PROJECT_CHILDREN` drives the nested
  read/write and the drift guard, trimmed data attributes, blank nested
  entries dropped, article `lang` rendered on /projects.

## v0.8.0 — 2026-09-13 (branch `refactor`; first pushed with v0.9.1)

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

### Review loop (688ec60)
- Three review passes fixed: failed runs marking documents live, export
  deletions + normalized bodies for restore, migration overwrite guard,
  token expansion on the tree with re-escaped author text, coverage
  partial sinks (`{{url}}`, validated `lang`), YouTube host vs CSP,
  preview iframe isolation, React 19 form reset on rejected saves,
  rooted selectors, class toggle semantics, `/styles` parse-once.

### Open items at this point
- Same operator blockers as v0.7.0 (secrets, GitHub App, Amplify install).

## v0.7.0 — 2026-09-13 (branch `refactor`; first pushed with v0.9.1)

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
