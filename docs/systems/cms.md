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

## Accessing the admin

**URL:** https://utahciviccompact.org/admin/  
**Login:** GitHub account (must have repo access to CatAuditor/uccsite)

The admin always commits to the `main` branch regardless of what URL you access it from. Use it on the production domain for real content edits. Staging is for design/code experiments only.

## GitHub OAuth App (already configured)

- **App ID:** 3942868
- **Callback URL:** `https://utahciviccompact.org/admin/`
- Stored in `static/admin/config.yml` → `app_id`

If the callback URL ever needs to change (e.g. to support a different domain), update it at github.com/settings/developers → OAuth Apps.

## Template syntax

- `{{var}}` — HTML-escaped value (safe for text content)
- `{{{var}}}` — raw HTML (used for headline with `<em>`, bios after markdown conversion)
- `{{#list}}...{{/list}}` — loop over an array (press cards, team members, videos)
- Nested: `{{hero.title}}` resolves `data.hero.title`

Markdown bio fields (`team.json`) are converted to `<p>` tags by `build.js` before rendering.
