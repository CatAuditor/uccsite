# Site Structure

Static site built via `node build.js` and deployed on Cloudflare Pages.

## Build pipeline

```
templates/*.html + content/*.json → build.js → dist/
```

Cloudflare Pages build command: `node build.js`, output dir: `dist`.  
Local: `node build.js` (zero npm dependencies).

## Pages

Editable pages use templates + content JSON. Passthrough pages are copied as-is.

| File | Template | Content file |
|------|----------|-------------|
| `index.html` | `templates/index.html` | `content/homepage.json` |
| `team.html` | `templates/team.html` | `content/team.json` |
| `blog.html` | `templates/blog.html` | `content/blog.json` |
| `statements.html` | `templates/statements.html` | `content/statements.json` |
| `stratos.html` | `templates/stratos.html` | — (passthrough) |
| `alpr.html` | `templates/alpr.html` | — (passthrough; Weber County ALPR investigation, data hosted at archive.org/details/weber-county-alpr-records) |
| `theory.html` | `templates/theory.html` | — (passthrough) |
| `success.html` | `templates/success.html` | — (passthrough) |

## Assets

- `css/styles.css` — single stylesheet
- `js/main.js` — nav, animations, join form, donate form, donation tracker, modal
- `static/admin/` — Decap CMS admin UI (copied to `dist/admin/` at build)

## Statements

Official org statements live in `content/statements.json` (`statements` array: `slug`, `date`, `title`, `snippet`, `body` in markdown paragraphs, `signoff`). `build.js` converts `body` to HTML via `mdToHtml`. Rendered in full on `/statements.html`, one `<article>` per statement with `id={{slug}}` for deep links. The homepage "Statements" section reads a separate snippet copy from `homepage.json` (`statements` array) — same duplication pattern as press. New statements go at the top of `statements.json` AND get a snippet entry in `homepage.json`.

## Nav pattern

All templates share identical nav HTML, plus the two passthrough pages `privacy.html` and `tip.html` at repo root (copied as-is, not templated). To add/change a nav link, update every one of those files manually — there's no shared partial/include.

Nav links: Mission, **About Us** (dropdown: Team & Bios, Theory of Change, Policies), News & Media, Projects, Submit a Tip, **Donate** (red → `/#donate`), **Get Involved** (red → `/#join`).

The About Us dropdown uses `.nav-dropdown` / `.nav-dropdown-toggle` / `.nav-dropdown-menu` (CSS in `css/styles.css`, behavior in `js/main.js`) — hover-opens on desktop, click/tap-toggles on mobile and via keyboard. See [nav-about-us-dropdown.md](../decisions/nav-about-us-dropdown.md).

## Branches

- `main` — production, auto-deploys to utahciviccompact.org
- `staging` — design/code sandbox at https://staging.uccsite.pages.dev

To sync staging with main: `git checkout staging && git merge main && git push origin staging`

## Backend

Cloudflare Pages Functions in `functions/api/`:
- `subscribe.js` — writes to D1 `subscribers` table, sends welcome email via Resend
- `create-checkout-session.js` — creates Stripe Checkout session, writes pending member to D1 `members`
- `create-portal-session.js` — creates Stripe billing portal session
- `webhook.js` — handles Stripe webhook events, updates D1 `members`, `subscriptions`, `donations`
- `donations/stats.js` — `GET /api/donations/stats` — returns total raised, goal, recent public donors

## Environment variables required

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `DONATION_GOAL_CENTS` (optional, defaults to 100000 = $1,000)
- `DB` (D1 binding — database: ucc-members)
