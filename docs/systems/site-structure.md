# Site Structure

Static HTML site deployed via Cloudflare Pages. No build step.

## Pages
- `index.html` — homepage (hero, pillars, issues, join form, donate section, modal)
- `team.html` — team bios
- `theory.html` — theory of change (coming soon placeholder)
- `blog.html` — news & blog
- `stratos.html` — Stratos Project campaign page (donate section + updates)
- `success.html` — post-donation confirmation

## Assets
- `css/styles.css` — single stylesheet
- `js/main.js` — single JS file (nav, animations, join form, donate form, modal)

## Nav pattern
All pages share identical nav HTML. To add/change a nav link, update all 5 pages manually. Nav includes: Mission, About (dropdown), Our Work (dropdown), Stratos, Get Involved (CTA).

## Backend
Cloudflare Pages Functions in `functions/api/`:
- `subscribe.js` — writes to D1 `subscribers` table, sends welcome email via Resend
- `create-checkout-session.js` — creates Stripe Checkout session, writes pending member to D1 `members`
- `create-portal-session.js` — creates Stripe billing portal session (looks up customer by email)
- `webhook.js` — handles Stripe webhook events, updates D1 `members`, `subscriptions`, `donations`

## Environment variables required
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `DB` (D1 binding)
