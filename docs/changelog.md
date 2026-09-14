# Changelog

One entry per push to the remote (CLAUDE.md rule). Version bumps: minor per
migration phase, patch per fix push. Open P0/P1 items are listed at the time
of each push.

## v0.12.0 — 2026-09-14 (branch `refactor`)

Airtable retired from the AWS stack: the tipline lives in DSQL.
Plan: `docs/migration/airtable-retirement-plan.md`; ADR
`docs/decisions/tipline-dsql.md`; spec addendum 13.
- **DB:** `tips` table (mirrors the Airtable fields + `legacy_airtable_id`,
  `status`, timestamps) in `packages/db/schema.js`; applied to staging.
  Added to the nightly operational export and `restore-operational.mjs`.
- **API:** `/api/tip` inserts into `tips`; `AIRTABLE_TOKEN` removed from
  `aws/api/secrets.js` (CDK dropped `ucc/staging/AIRTABLE_TOKEN`; prod copy is
  RETAIN, deleted by hand at day 30). Responses 200/400/403/429/500; insert
  failure logs the pg error NAME only. Tests: 26/26 incl. a console spy for
  body leakage.
- **Admin:** `/tips` inbox (editor+, status filter with counts) and
  `/tips/[id]` (full text as text, status change, owner-only delete). Both
  audited (`tip.status` from/to; `tip.delete` keeps only the legacy Airtable
  id as a re-import tombstone). Nav: Operations → Tips.
- **Scripts:** `migrate-tips.mjs` (Airtable → tips, read-scoped token via
  env var, deterministic ids, skips owner-deleted, 429 retry, counts only);
  `tip-smoke.mjs` (deployed-env verifier incl. CloudWatch search for tip
  text — must be zero hits).
- **Docs:** tipline.md rewrite, admin.md, api-security, debug/api,
  data-handling (tips row, Airtable marked legacy), for-conner (read token,
  cutover 6b/5b tips copy + delta, day-30 Airtable retirement, Read-Host),
  editing guide, plan doc.
- **Review (security / data-integrity / Next.js ops) + fixes:** stable
  import ids, delete tombstones, `updated_at` on import, strict uuid guard,
  SQL `edited` flag, `.tip-text` class, list counts/wording, smoke cleanup.
- **Verified on staging:** tip-smoke 7/7, staging-check 26/26, admin headless
  (viewer refused, editor status, editor delete refused, owner delete,
  audit rows, 404 on bad id), export drill (tips.json) + restore drill.

Open P1 unchanged: project files publish is one-person (v0.11.0).
**Accepted risk (new):** the API Lambda connects to DSQL as `admin`, so a
compromised public route could read tips (the Airtable token was
write-only). Fix path in `docs/systems/tipline.md` "Database access".

## v0.11.3 — 2026-09-13 (branch `refactor`)

Admin copy: what "next Publish" means.
- **Admin:** every save notice (collection pages, Site Settings, Documents
  list and editor, Files, Redirects) now says a draft goes live "when a
  publish request is approved on Publish & Status" instead of "on the next
  Publish", and that nothing is rebuilt by hand. Redirects save toast says
  the same. Wording only, no logic.
- **Docs:** `docs/non-technical-editing-guide.md` intro, Documents status
  and Redirects lines point at the section 2 request/approve flow.

Open P1 unchanged: project files publish is one-person (v0.11.0).

## v0.11.2 — 2026-09-13 (branch `refactor`)

Staging basic auth + admin DB client hygiene.
- **Infra (staging CloudFront Function):** `/css/*`, `/assets/*`, `/media/*`
  bypass the basic-auth gate; pages, `/files/*`, `/api/*` still 401 without
  the credential; prod unchanged. Fixes the native browser sign-in dialog that
  appeared over the admin document editor (preview iframe loads those
  subresources from `PUBLIC_ORIGIN`). `scripts/staging-check.mjs` gains a
  no-auth `/css/styles.css` 200 check (26 checks).
  `docs/decisions/staging-basic-auth-asset-exemption.md`,
  `docs/error-handling/client-side-error/2026-09-13-admin-preview-basic-auth-dialog.md`.
- **Admin:** `editorData` and the Files page run their queries sequentially on
  the shared `pg.Client` (was `Promise.all` → pg DeprecationWarning, throws in
  pg 9). `docs/error-handling/client-side-error/2026-09-13-pg-concurrent-query-deprecation.md`.
- Docs: `documents.md`, `media.md`, build-spec §16 note the exemption.

Open P1 unchanged: project files publish is one-person (v0.11.0).

## v0.11.1 — 2026-09-13 (branch `refactor`)

Project files on the site + donation asks (`docs/systems/files.md`,
`docs/decisions/donation-appeals-page.md`).
- **/projects lists published files** under each project block (name,
  folder · size, note; `download` links). The DB render path supplies
  `content.project_files` (`packages/db/project-files.js`,
  `deriveProjectFiles`); the git/local build renders none.
- **Download modal** on every page (footer partial): "Your download has
  started." + donation ask after any published-file download; copy in four
  new `site_settings` columns (`downloadModal*`, ALTER TABLE; defaults in
  content/settings.json; declared in config.yml). `js/main.js` now has one
  `createModal()` for both dialogs.
- **Admin /appeals (Donation appeals)**: homepage donate section, homepage
  timed modal and the download modal edited together; Homepage and Site
  Settings editors skip and preserve those fields.
- **CDN cost controls**: 50 MB publish cap (`MAX_PUBLIC_BYTES`); prod-only
  AWS Budget on CloudFront → OpsAlerts (80 % actual / 100 % forecast);
  compression confirmed on `/files/*`.
- Staging: schema applied + settings seeded; e2e through a real
  `--source db` publish passed (11 checks), test file removed, republished.
- Error log: `docs/error-handling/build-failures/2026-09-13-publish-refused-git-source.md`
  (`scripts/publish.mjs` without `--source db` would drop Documents; the
  guard refused — three `failed` manual rows on the staging dashboard).

Open: Amplify Hosting deploy (repo access); OpsAlerts email subscription
(for-conner.md); nav/footer "Donate" labels and the donate form button stay
template-owned.

## v0.11.1 — 2026-09-13 (branch `refactor`)

Docs and repo hygiene (no code).
- **`docs/for-conner.md`** rewritten as an operator runbook that Conner's
  own Claude Code agent can execute, with `[hand]` steps where a console
  click or a secret is needed: agent setup (mandatory `uccsite` profile),
  secrets with a write-only verification pattern, GitHub App for the
  export, admin roster + the two-person publish requirement (two accounts
  minimum), prod stack redeploy / content / donor migration commands,
  cutover sequence (custom domain + ACM not yet in the stack — flagged),
  Amplify hosting, open dev items.
- **.gitignore**: `docs/migration/documents/*.document.json` were ignored,
  leaving the docs tree incomplete in git; now tracked (8 files, one-time
  migration output).
- CLAUDE.md docs structure matches the real tree; admin.md and
  publish-pipeline.md no longer mention restore-and-republish / a publish
  button; README lists files.md.

Open P1 unchanged: project files publish is one-person (v0.11.0).

## v0.11.0 — 2026-09-13 (branch `refactor`)

Admin: two-person publishing (`docs/systems/admin.md` "Publishing", ADR
`docs/decisions/two-person-publish.md`). The direct Publish button is gone;
the code landed in the v0.10.1 push (3cd00bb), the docs and review fixes in
this one.
- **Request → approve/decline**: Publish & Status lists every content save
  since the site last went live; an editor/owner requests a publish with a
  note; any OTHER editor/owner approves (the only admin path that invokes
  PublishFn) or declines with a required note; the requester can withdraw,
  an owner can clear a stale request. Requester ≠ reviewer enforced by
  `cognito:username` and email; one pending request at a time; conditional
  UPDATE so two reviewers can't both publish; in-flight publish refused.
- **Review fixes** (one agent, 4 findings): approve carries `seenThrough`
  and is refused if saves landed after the reviewer's page was rendered;
  "unpublished" measured from the last good run's `started_at`; a one-row
  `publish_request_gate` makes racing requests conflict on DSQL; trigger
  `approve:<id>:<email>` joins each approval to its run in the requests
  table (live / publishing / failed / refused / not started), and a failed
  invoke reopens the request with a `publish.invoke_failed` audit row.
- **Revisions**: restore is a draft (no automatic republish).
- Schema: `publish_requests`, `publish_request_gate` (wired into
  `content-schema.js`; applied to staging).
- Docs: admin.md, publish-pipeline.md, editor guide §2, README, ADR,
  debug/admin.md, data-handling rows.
- Verified headlessly on staging with the editor/owner test users:
  self-approve, self-decline, decline-without-note, duplicate request,
  stale-page approve all refused; owner approve → run `approve:<id>:…`.

Open P1: **project files** (`/files` Publish, v0.10.1) copies a file to the
public `/files/*` on one editor's action — an exception to the two-person
rule, recorded in admin.md; route it through the publish request.

## v0.10.1 — 2026-09-13 (branch `refactor`)

Admin: project files (`docs/systems/files.md`).
- **Files** page (`/files`): signed-in file store organised by project
  (soft link on `projects.slug`) then a free-text folder path, with a note
  per file. Any role downloads (presigned GET, attachment); editor+ uploads,
  moves, publishes, unpublishes, deletes. Every mutation audited
  (`files.*`).
- Uploads: type derived from the extension against an allow-list (no
  html/svg/js), signed into the presigned PUT with the length; the server
  verifies the object (HeadObject) before the row becomes ready. 250 MB cap.
- **Publish to the live site**: server-side CopyObject `private-files/` →
  `files/<id>/<name>` in the media bucket, served by a new CloudFront
  `/files/*` behavior on the shared media origin; the bucket policy grants
  `media/*` + `files/*` only, so uploads and private files stay unreachable
  from the edge. Public copies carry Content-Disposition and a 5-minute
  cache (unpublish lag).
- Schema: `project_files` table (+ index). Applied to staging; UccStaging
  deployed; 18-check e2e on staging passed (signed-type PUT 403/200,
  private prefix 404 via CloudFront, public copy 200 with type/disposition/
  cache/nosniff, basic auth still gates, presigned download).
- Docs: files.md, debug/files.md, admin/media/site-structure code maps,
  data-handling rows.

Open: Amplify Hosting deploy still blocked on repo access (SSR role needs
the same media-bucket object grants for files). Project pages do not list
published files yet; paste the `/files/…` path into a CTA or Document.

## v0.10.0 — 2026-09-13 (branch `refactor`)

Admin completeness pass (`docs/systems/admin.md` "What the admin covers").
- **Account & security**: `/profile` — change password, authenticator-app
  MFA (TOTP), security keys / passkeys (registered on Cognito managed login,
  listed/removed in the admin), own bio + headshot (`team_members.email`
  link). Cognito: managed login v2, passkey first factor, `aws.cognito.
  signin.user.admin` scope, access-token cookie.
- **Users & roles** (owner): invite, role, disable/enable, password reset,
  remove MFA, sign out everywhere; `scripts/admin-user.mjs` for the CLI.
- **Redirects**: `redirects` table + admin page; every publish syncs the
  CloudFront KeyValueStore (verified end to end at the edge); exported as
  `redirects.json`.
- **Subscribers**: list + audited CSV export (editor+).
- Cognito user jarom.gillins@utahciviccompact.org created as owner (staging).
- Review fixes: session requires a verified email claim and the pool keeps
  the original email until a new one is verified (identity cannot be
  spoofed through the self-service scope); owner self-guards by username;
  removing MFA or a security key needs a sign-in under 15 minutes old; edge
  redirects preserve query strings and use correct status text; redirect
  validation tightened + two-hop loop guard; KVS sync never wipes a seeded
  store on an empty table and failures show on the run row; user list
  paginated; own-profile save carries the lost-update stamp; CSV export
  is POST-only.

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
