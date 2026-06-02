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
| `stratos.html` | `templates/stratos.html` | — (passthrough) |
| `theory.html` | `templates/theory.html` | — (passthrough) |
| `success.html` | `templates/success.html` | — (passthrough) |

## Assets

- `css/styles.css` — single stylesheet
- `js/main.js` — nav, animations, join form, donate form, donation tracker, modal
- `static/admin/` — Decap CMS admin UI (copied to `dist/admin/` at build)

## Nav pattern

All templates share identical nav HTML. To add/change a nav link, update all 5 templates manually (index, team, blog, stratos, theory). No dropdowns — all links are flat.

Nav links: Mission, About Us, Theory of Change, News & Media, Stratos, **Donate** (red → `/#donate`), **Get Involved** (red → `/#join`).

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
