# CMS — Decap CMS + Static Build

Editors can change site copy at `/admin` without touching code. Changes commit to git and Cloudflare Pages rebuilds automatically.

## Architecture

```
content/*.json      ← editor changes these via /admin
templates/*.html    ← HTML with {{placeholders}}
build.js            ← merges content into templates → dist/
static/admin/       ← Decap CMS UI + local decap-cms.js bundle
workers/auth/       ← Cloudflare Worker: GitHub OAuth proxy
dist/               ← Cloudflare Pages serves this (.gitignored)
```

## What's editable

| Page | Content file | Editable fields |
|------|-------------|----------------|
| Homepage | `content/homepage.json` | Hero, mission quote, about section, join section, donate section, modal, featured press cards |
| Team & Bios | `content/team.json` | All team members (name, title, bio — markdown) |
| News & Press | `content/blog.json` | Press articles and video cards |

Pillars, issues grid, stats, and nav/footer are hardcoded in templates (change rarely).

## Build

**Local:** `node build.js` (zero npm dependencies)  
**Cloudflare Pages:** build command `node build.js`, output directory `dist`

The Decap CMS JS bundle (`static/admin/decap-cms.js`) is served locally to avoid CSP conflicts — update it by downloading a new version from unpkg and replacing the file.

## Accessing the admin

**URL:** https://utahciviccompact.org/admin/  
**Login:** GitHub account (must have repo access to CatAuditor/uccsite)

The admin always commits to the `main` branch. Use it on the production domain for real content edits. Staging (`staging.uccsite.pages.dev`) is for design/code experiments only.

## Auth — OAuth Worker

Decap authenticates via a Cloudflare Worker at `https://uccsite-auth.cothv.workers.dev` that handles the GitHub OAuth exchange. This replaces the Netlify auth service.

**Worker:** `workers/auth/index.js` — deployed as `uccsite-auth`  
**Secrets stored in Cloudflare (not in git):** `CLIENT_ID`, `CLIENT_SECRET`

**GitHub OAuth App settings:**
- Client ID: `Iv23lifWTq1jKRvmzuLX`
- Callback URL: `https://uccsite-auth.cothv.workers.dev/callback`
- Managed at: github.com/settings/developers → OAuth Apps

To redeploy the worker after changes: `cd workers/auth && npx wrangler deploy`  
To rotate the client secret: generate a new one on GitHub, then `echo "NEW_SECRET" | npx wrangler secret put CLIENT_SECRET` from `workers/auth/`.

## Template syntax

- `{{var}}` — HTML-escaped value (safe for text content)
- `{{{var}}}` — raw HTML (used for headline with `<em>`, bios after markdown conversion)
- `{{#list}}...{{/list}}` — loop over an array (press cards, team members, videos)
- Nested: `{{hero.title}}` resolves `data.hero.title`

Markdown bio fields (`team.json`) are converted to `<p>` tags by `build.js` before rendering.
