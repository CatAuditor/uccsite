# uccsite — Utah Civic Compact

Source for [utahciviccompact.org](https://utahciviccompact.org): a static
site rendered from structured content, plus the admin that edits it.

Two deployments exist while the migration finishes:

| | Live today | AWS rebuild (branch `refactor`) |
|---|---|---|
| Hosting | Cloudflare Pages, `main` auto-deploys | S3 + CloudFront (staging live, prod cutover pending) |
| Content | `content/*.json` edited through Decap CMS at `/admin` | Aurora DSQL, edited in the Next.js admin (`apps/admin`) |
| Backend | Pages Functions (`functions/api/`) + D1 | Lambda Function URL (`aws/api/`) + DSQL |
| Spec | — | `docs/build-spec-aws.md` (governing document) |

Everything below describes the AWS rebuild unless marked Cloudflare.

## What creates a page

Only **Documents** create new pages. Every other thing an editor adds is an
entry on an existing page:

| An editor adds a… | Result on the site |
|---|---|
| **Document** (report, whitepaper, legal page) | **New page** at `/<slug>` with its own SEO, JSON-LD, page CSS, sitemap entry |
| Statement | Section on `/statements` (`/statements#slug`); the newest one is also the homepage card |
| Policy position | Section on `/issues` |
| Project | Block on `/projects` + a homepage card; its press articles and videos render inside the block |
| News article / video | Card on `/blog` |
| Report coverage entry | "In the media" strip inside the ALPR / Stratos documents |
| Team member | Entry on `/team` |
| Redirect | Old URL → new URL at the edge |

Rationale: spec §3 — collections are structured records rendered by
developer-owned templates; Documents are pasted HTML that editors can
publish without a developer. A long statement that deserves its own URL
becomes a Document; the collection entry links to it.

## Repository layout

```
templates/            page templates (Mustache subset) + partials/ + documents/ (Document shells)
content/*.json        collection content (Cloudflare path; migrated into DSQL for AWS)
css/ js/ assets/      site assets (css/pages/*.css per fixed page, css/fonts.css self-hosted)
build.js              Cloudflare-era build (templates + content → dist/)
packages/
  render/             pure renderer: engine, site manifest, Document compose, dates
  html-ingest/        Document sanitizer, node ids, accessibility gate
  style-kit/          parses css/styles.css annotations into the class picker catalog
  style-apply/        template rules + per-element overrides → classes
  db/                 DSQL connect/query layer, schemas, content ⇄ JSON mapping, export
aws/
  api/                public API (Stripe, join, tip, portal, stats)
  publish/            render → hash-diff → S3 → invalidate → verify; redirects → KeyValueStore
  reconcile-drift/    hourly drift check + rollback
  media-process/      sharp variants for uploads
  export-content/     nightly content export to git (GitHub App)
  export-operational/ nightly donor/subscriber export to a restricted bucket
apps/admin/           Next.js admin (Cognito login, editors, Documents, media, users)
infra/cdk/            one stack per environment (UccStaging / UccProd)
scripts/              publish, migrations, export/restore, parity checks, admin users
docs/                 systems/ (how it works), decisions/ (ADRs), changelog, for-conner (operator to-dos)
```

`functions/` is Cloudflare Pages only — never put AWS code there.

## Running things

```
npm ci                                   # Node 22+, one lockfile for the monorepo
npm test                                 # every workspace's tests (golden renderer parity included)
node build.js                            # Cloudflare-style build into dist/

# AWS (profile `uccsite` is mandatory; a hook blocks anything else)
$env:AWS_PROFILE='uccsite'
node scripts/admin-env.mjs --env staging     # writes apps/admin/.env.local from stack outputs
npm run dev -w @uccsite/admin                # admin at http://localhost:3000
node scripts/publish.mjs --env staging --source db   # publish from the database
node scripts/seo-parity-check.mjs --target https://<staging-domain> --basic-auth user:pass \
     --exceptions docs/migration/parity-exceptions.json
cd infra/cdk && npx cdk deploy UccStaging --profile uccsite
```

More scripts: `scripts/migrate-*.mjs` (schema, content, documents, redirects,
D1), `scripts/export-content.mjs` / `restore-from-export.mjs`,
`scripts/admin-user.mjs` (invite an admin), `scripts/fetch-fonts.mjs`,
`scripts/annotate-style-kit.mjs`.

## Rules that bite

- Never edit `dist/`; never add page HTML at the repo root.
- No inline `<script>` and, on AWS, no inline `<style>` or `style=""`
  attributes — the CSP is `script-src 'self'`, `style-src 'self'`.
- Nav and footer live only in `templates/partials/`.
- Publish AWS from the database (`--source db`); a git-source publish would
  render the old inline styles the CSP blocks.
- `main` deploys Cloudflare production instantly; `refactor` is the AWS
  branch. The nightly export commits to `content-export` branches, not `main`.
- The tipline handler never logs request or response bodies.

## Where to read next

- Non-technical editors: `docs/non-technical-editing-guide.md`
- How each system works: `docs/systems/` (admin, documents, media, projects,
  publish-pipeline, content-export, api-security, site-structure)
- Why: `docs/decisions/`
- What changed: `docs/changelog.md`
- What needs a human with keys: `docs/for-conner.md`
