# CMS — Decap CMS + Static Build

> **Superseded (AWS rebuild, 2026-09-13):** content editing moves to the Next.js admin (docs/systems/admin.md, documents.md, media.md, projects.md) with the database as the source of truth. Decap and `workers/auth/` stay only until the nightly content export is committing (spec §19 Phase 7); everything below describes the Cloudflare-era path that still runs from `main`.

Editors can change site copy at `/admin` without touching code. Changes commit to git and Cloudflare Pages rebuilds automatically.

## Code Map

```
content/*.json           ← editor changes these via /admin
templates/*.html         ← HTML with {{placeholders}}
templates/partials/      ← header.html / footer.html, included with {{> name}}
build.js                 ← validates content, merges into templates → dist/, writes sitemap.xml
static/admin/config.yml  ← Decap collections (must declare EVERY key in each JSON file)
static/admin/index.html  ← Decap shell (vendored decap-cms.js 3.3.3 alongside)
static/admin/callback.html ← OAuth popup relay (BroadcastChannel/postMessage; localStorage fallback cleared on close)
workers/auth/            ← Cloudflare Worker: GitHub OAuth proxy (state-cookie CSRF check)
static/_redirects        ← /auth → worker (single source; functions/auth.js was removed)
dist/                    ← Cloudflare Pages serves this (.gitignored)
```

## What's editable

| Collection | Content file | Fields |
|---|---|---|
| Site Settings | `content/settings.json` | org name, contact email, Instagram, footer tagline, copyright (rendered by the footer partial) |
| Homepage | `content/homepage.json` | hero, mission, about, join, donate, modal, featured press (hand-curated) |
| Team & Bios | `content/team.json` | members (name, title, photo, bio) |
| Statements | `content/statements.json` | statements (newest first — the top one is auto-featured on the homepage; optional `url`/`more` override the featured card's link and read-more text) |
| Policy Positions | `content/issues.json` | issues |
| News & Press | `content/blog.json` | articles, videos |
| Projects | `content/projects.json` | projects incl. nested press `articles` and `videos` |
| Report Media Coverage | `content/coverage.json` | "Read About This in the Media" cards on `alpr.html` and `stratos.html` (`alpr_coverage`, `stratos_coverage`) |

Pillars, the issues grid, stats, and nav links are hardcoded in templates/partials.

`settings.json` carries the download-modal copy (`downloadModalTitle/Body/Cta/Dismiss`, docs/systems/files.md) — declared in the `settings` collection.

**Hard constraint:** Decap rewrites a JSON file with only the fields declared in `config.yml`. Adding a key to a content file without adding it to the matching collection means the next CMS save deletes it. `config.yml` is validated against the content files by hand — keep them in sync.

## Text formatting in bios / statements / issues

`build.js` `mdToHtml()` supports **bold**, *italic*, `[text](https://url)`, and blank-line paragraphs — nothing else (no headings, lists, images). The source is HTML-escaped first, so raw HTML in these fields is shown literally, not rendered. The CMS widgets for these fields are `text` with a hint saying the same.

## Build

**Local:** `npm run build` (or `node build.js`; no npm dependencies needed)
**Cloudflare Pages:** build command `node build.js`, output directory `dist`

`build.js` parses every content file and template first and exits 1 (leaving `dist/` untouched) on invalid JSON, a missing template, a missing content file, a missing partial, or an unclosed `{{#section}}`.

The Decap CMS bundle (`static/admin/decap-cms.js`, **decap-cms-app 3.3.3**, unminified license file not vendored) is served locally to avoid CSP conflicts — update it by downloading `https://unpkg.com/decap-cms-app@<version>/dist/decap-cms-app.js` and replacing the file; record the version here.

## Accessing the admin

**URL:** https://utahciviccompact.org/admin/
**Login:** GitHub account (must have repo access to CatAuditor/uccsite)

The admin always commits to the `main` branch, which auto-deploys — there is no preview step. Staging (`staging.uccsite.pages.dev`) is for design/code experiments only.

## Auth — OAuth Worker

Decap authenticates via a Cloudflare Worker at `https://uccsite-auth.cothv.workers.dev`.

**Worker:** `workers/auth/index.js` — deployed as `uccsite-auth`
**Config:** `workers/auth/wrangler.toml` — `CLIENT_ID` and `GITHUB_SCOPE` are `[vars]`; `CLIENT_SECRET` is a secret.

Flow: `/auth` generates a random `state`, stores it in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/callback`, and redirects to GitHub. `/callback` rejects unless `state` matches the cookie (login-CSRF protection), exchanges the code (with `redirect_uri`), and redirects to `/admin/callback.html#authorization:github:success:{...}` — the token only ever travels in the URL fragment. Any failure redirects with a fixed error code (`missing_code`, `state_mismatch`, `token_exchange_failed`, `auth_failed`).

`GITHUB_SCOPE` defaults to `public_repo`. If the content repo is ever made private, set it to `repo`.

**GitHub OAuth App settings:**
- Client ID: `Iv23lifWTq1jKRvmzuLX`
- Callback URL: `https://uccsite-auth.cothv.workers.dev/callback`
- Managed at: github.com/settings/developers → OAuth Apps

To redeploy the worker after changes: `cd workers/auth && npx wrangler deploy`
To rotate the client secret: generate a new one on GitHub, then `echo "NEW_SECRET" | npx wrangler secret put CLIENT_SECRET` from `workers/auth/`.

## Template syntax (`build.js` `render()`)

- `{{var}}` — HTML-escaped. Any key named `url` or `*_url` is additionally passed through `safeUrl()` (only `http(s):`, `mailto:`, `/`, `#` allowed; otherwise `#`).
- `{{{var}}}` — raw HTML. Only for values the build itself produced (`{{{body}}}`, `{{{bio}}}` after `mdToHtml`, hero headline with `<em>`).
- `{{#key}}…{{/key}}` — loop if array (non-empty), else render once if truthy. `{{#articles.length}}` is the idiom for "only if the list has items".
- `{{^key}}…{{/key}}` — inverted: render when empty/falsy.
- `{{> header}}` — include `templates/partials/header.html` with the same data.
- Nested paths: `{{hero.title}}`.
- Single pass: values inserted by the engine are never re-scanned, so `{{` inside content is safe.

Data available to every page besides its content files: `page` (template name without `.html`), `is_home`, `current.<page>` (for `aria-current`).
