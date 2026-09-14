# Site Structure

Static site built via `node build.js` and deployed on Cloudflare Pages.

## Code Map

```
build.js                 thin shell: read inputs → packages/render → write dist/ + static copies
packages/render/         THE template engine + site assembly (pure, golden-file tested;
                         PAGES manifest now lives in packages/render/site.js)
package.json             `npm run build` / `npm run dev` (wrangler pages dev); npm workspaces root
templates/*.html         one per page (17)
templates/partials/      header.html, footer.html  ← THE nav/footer; edit here only
                         (footer.html also carries the download modal, files.md)
content/*.json           CMS-managed content (see cms.md)
css/styles.css           site stylesheet (+ Style Kit @class annotations for the admin picker)
css/fonts.css            self-hosted @font-face (scripts/fetch-fonts.mjs) → assets/fonts/
css/pages/<page>.css     the fixed pages' page-specific styles (formerly inline <style>)
css/colors.css           GENERATED at render (packages/render/site.js withColorClasses):
                         .c-<hex> classes for content badge/status colours
js/main.js               nav, animations, join form, donate form, donation tracker,
                         createModal() (timed donation modal + download modal)
js/tip.js                tipline form controller
static/                  copied verbatim into dist/: admin/, _headers, _redirects
assets/, UCC.png, favicon.svg, robots.txt, llms.txt   copied verbatim (COPY_FROM_ROOT in build.js)
functions/api/           Cloudflare Pages Functions (see api-security.md)
workers/auth/            Decap OAuth worker (see cms.md)
packages/html-ingest/    Document sanitize/nid/a11y pipeline (AWS rebuild §5; pure)
packages/style-kit/      stylesheet → class catalog parser (§6.1; pure, zero-dep)
packages/style-apply/    StyleRules/Overrides resolution (§6.2-6.4; pure)
infra/cdk/               AWS CDK app: UccStaging/UccProd stacks (CloudFront, S3,
                         DSQL, API Lambda origin, CF Function + KVS redirects,
                         drift reconciler + hourly rule + SNS alerts)
aws/publish/             publish pipeline core + store + shared input loader
                         (see publish-pipeline.md). AWS code lives under aws/,
                         never functions/ - Pages compiles functions/* as routes.
aws/reconcile-drift/     hourly drift reconciler Lambda
aws/api/                 API Lambda port of functions/api (see api-security.md)
aws/export-operational/  nightly donor-data export to the restricted bucket (§14.3)
packages/db/             DSQL connection helper (IAM auth, retry on 40001)
packages/tokens/         THE HMAC token impl (unsubscribe/portal), byte-compatible
                         with functions/api/_lib.js; used by aws/api + periodical
packages/db/files.js     project files key layout + type allow-list (see files.md)
packages/db/schema.js    DSQL DDL for the operational tables (successor to
                         schema.sql's D1 dialect; applied via migrate-schema.mjs)
scripts/lib/stack.mjs    env → deployed stack outputs, shared by every script
scripts/publish.mjs      publish driver (repo → staging/prod)
scripts/staging-check.mjs   25-check e2e distribution verification
scripts/migrate-schema.mjs  apply DSQL schema to an environment
scripts/migrate-d1.mjs      one-time D1 → DSQL data migration (+ verification)
scripts/restore-operational.mjs  restore a dated §14.3 export into DSQL
schema.sql               D1 schema (source of truth)
scripts/send-periodical.js   bulk email via Mailgun (see api-security.md → Signed Tokens)
dist/                    build output, gitignored — never edit
```

## Build pipeline

```
templates/*.html + templates/partials/*.html + content/*.json → build.js → dist/
```

Cloudflare Pages build command: `node build.js`, output dir: `dist`. Local: `npm run build`.

Hard rules:
- **Do not add page HTML at repo root.** Every page is a template in `templates/` and an entry in `PAGES` in `packages/render/site.js`. (`tip.html` and `privacy.html` moved into `templates/` 2026-08-23.)
- **Do not change rendering semantics in `packages/render/engine.js`.** Output is locked byte-for-byte by golden-file tests (`packages/render/test/`); intentional changes require an `expected-diffs.json` entry.
- **Do not edit `dist/`.** It is wiped on every build.
- **Do not hand-edit nav or footer in a page.** They live in `templates/partials/`.
- **No inline `<script>`** — the CSP blocks it. Put JS in `js/`.
- `main` auto-deploys to production with no preview.

## Pages (`PAGES` in `build.js`)

| Output | Content files | Notes |
|---|---|---|
| `index.html` | settings, homepage, projects | featured statement derived from `statements.json` |
| `team.html` | settings, team | |
| `blog.html` | settings, blog | |
| `statements.html` | settings, statements | |
| `issues.html` | settings, issues | |
| `projects.html` | settings, projects | |
| `privacy-report.html` | settings | |
| `stratos.html` | settings, coverage | |
| `weber-county.html` | settings | |
| `alpr.html` | settings, coverage | data hosted at archive.org/details/weber-county-alpr-records |
| `how-did-this-happen.html` | settings | policy paper reading the Utah Code against the Weber County–Flock contract |
| `dignity-index-statement.html` | settings | 9/11 anniversary statement calling for Dignity Index adoption; bespoke design distinct from `statements.html` |
| `theory.html` | settings | |
| `tip.html` | settings | noindex, excluded from sitemap |
| `privacy.html` | settings | |
| `success.html` | settings | Stripe return page; noindex, no nav/footer |
| `404.html` | settings | real not-found page (replaces Pages SPA fallback); noindex, excluded from sitemap |

`sitemap.xml` is generated by the build from this table (`sitemap: false` excludes). Locs are **clean URLs** (no `.html` — the live site serves pages extensionless). `lastmod` comes from an injectable provider: file mtimes locally (`build.js`), deterministic sources in CI/publish. Do not check in a sitemap.

## Statements

Official statements live in `content/statements.json` (`statements` array: `slug`, `date`, `topic`, `author`, `title`, `snippet`, `body` markdown, `signoff`, optional `url` + `more`), newest first. The build converts `body` via `mdToHtml` and renders one `<article id={{slug}}>` per statement on `/statements.html`. The homepage card is **derived** from the first entry at build time — there is no second copy to maintain. The card's link is the entry's `url` (fallback `/statements.html#<slug>`) and its read-more line is `more` (fallback "Read the full statement →") — see [homepage-statement-links.md](../decisions/homepage-statement-links.md).

## Nav / footer

`templates/partials/header.html` and `footer.html`, included with `{{> header}}` / `{{> footer}}` on every page except `success.html`. (`how-did-this-happen.html` and `dignity-index-statement.html` migrated from hardcoded copies to the partials 2026-09-12.) The header partial opens `<main id="main">` (after a skip link); the footer partial closes it. `aria-current="page"` is set from `current.<page>`; subpages get the `scrolled` header class via `{{^is_home}}`.

Nav links: Mission, **About Us** (dropdown: Team & Bios, Theory of Change, Policies, Privacy Report), News & Media, Projects, Submit a Tip, **Donate** (red → `/#donate`), **Get Involved** (red → `/#join`). Footer contact/tagline/copyright come from `content/settings.json`.

The dropdown (`.nav-dropdown*`, `js/main.js`) hover-opens on desktop and click/keyboard-toggles otherwise; JS keeps `aria-expanded` truthful on hover and supports Arrow keys/Escape. See [nav-about-us-dropdown.md](../decisions/nav-about-us-dropdown.md).

## Branches

- `main` — production, auto-deploys to utahciviccompact.org
- `staging` — design/code sandbox at https://staging.uccsite.pages.dev

To sync staging with main: `git checkout staging && git merge main && git push origin staging`

## Backend

See `docs/systems/api-security.md` for the full Functions code map, rate limits, tokens, and env vars.

## Environment variables

Inventory with descriptions lives in the comment block of `wrangler.toml`. `DB` is the D1 binding (database: ucc-members).
