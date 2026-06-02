# CMS — Decap CMS + Static Build

Editors can change site copy at `/admin` without touching code. Changes commit to git and Cloudflare Pages rebuilds automatically.

## Architecture

```
content/*.json   ← editor changes these via /admin
templates/*.html ← HTML with {{placeholders}}
build.js         ← merges content into templates → dist/
static/admin/    ← Decap CMS UI (copied to dist/admin/ at build)
dist/            ← Cloudflare Pages serves this (.gitignored)
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
**Cloudflare Pages:** set build command to `node build.js`, output directory to `dist`

## One-time setup: GitHub OAuth App

Decap uses PKCE OAuth to authenticate editors via their GitHub account.

1. Go to **github.com/settings/developers → OAuth Apps → New OAuth App**
2. Fill in:
   - Homepage URL: `https://utahciviccompact.org`
   - Authorization callback URL: `https://utahciviccompact.org/admin/`
3. Copy the **Client ID**
4. Paste it into `static/admin/config.yml` → `app_id`
5. Commit and redeploy

After that, anyone with repo access can log into `/admin` with their GitHub account.

## Template syntax

- `{{var}}` — HTML-escaped value (safe for text content)
- `{{{var}}}` — raw HTML (used for headline with `<em>`, bios after markdown conversion)
- `{{#list}}...{{/list}}` — loop over an array (press cards, team members, videos)
- Nested: `{{hero.title}}` resolves `data.hero.title`

Markdown bio fields (`team.json`) are converted to `<p>` tags by `build.js` before rendering.
