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
All pages share identical nav HTML. To add/change a nav link, update all 5 source pages **and** all 5 templates in `templates/` (the build script uses templates to generate `dist/`).

Current links: Mission, About Us → `/team.html`, Theory of Change → `/theory.html`, News & Media → `/blog.html`, Stratos, **Donate** (red CTA → `/#donate`), Get Involved (red CTA → `/#join`).

Torch SVG logo (`/torch.svg`) is displayed at far right of nav bar on desktop, and at far right of the nav bar on mobile (36px). Favicon also uses `torch.svg`.

No dropdowns — all links are flat.

Mobile nav: panel slides down from `top: var(--nav-h)` with white background. CTAs are full-width. Torch stays visible in the bar for branding.

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
