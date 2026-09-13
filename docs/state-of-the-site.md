# State of the Site — utahciviccompact.org

> **2026-09-13:** this snapshot describes the pre-migration Cloudflare stack on `main`. The `refactor` branch now carries the AWS rebuild (Phases 0–9 built; cutover pending) — see `docs/changelog.md`, `docs/build-spec-aws.md`, and `docs/systems/{admin,documents,media,projects,publish-pipeline,content-export}.md` for the current state.

Snapshot of the **working tree** as of 2026-09-12, branch `refactor`. This describes what exists in the code right now, including staged-but-uncommitted changes. It contains no roadmap or future plans.

**Git state:** `refactor` sits at the same commit as `main` (`923568c`). The entire refactor is **staged but uncommitted**: 51 files, +1,525/−2,365 lines, plus 13 untracked paths (new files/dirs). The only unstaged change is a small CLAUDE.md addition. Nothing described below as "new this cycle" has been pushed or deployed yet — production still runs the pre-refactor code.

---

## 1. Stack at a glance

- **Hosting:** Cloudflare Pages, output dir `dist/`, `main` auto-deploys to production (no preview step).
- **Frontend:** hand-rolled static-site generator (`build.js`, zero dependencies) rendering `templates/*.html` + `templates/partials/` with `content/*.json` data.
- **Backend:** Cloudflare Pages Functions in `functions/api/` + one D1 database (`ucc-members`) + one standalone Worker (`workers/auth/`, Decap CMS OAuth).
- **CMS:** Decap CMS 3.3.3 (self-hosted vendored bundle) at `/admin`, committing JSON to GitHub repo `CatAuditor/uccsite` on `main`.
- **Payments:** Stripe (checkout, subscriptions, billing portal, webhook) — hand-rolled API calls, no SDK.
- **Email:** Resend (transactional, from Functions); Mailgun (bulk periodical, from a manually-run Node script).
- **Tipline:** Airtable, proxied through a Pages Function.
- **Dependencies:** `package.json` (new, untracked) has exactly one devDependency (`wrangler ^4`). No lockfile, no node_modules, no bundler, no framework.

**Important:** CLAUDE.md contains a large "AWS (Amplify migration)" section describing Vite, `src/config.ts`, `amplify/` functions, `customHttp.yml`, Cognito, etc. **None of that code exists in this repo.** A repo-wide search confirms no `amplify/`, no `src/`, no Vite, no TypeScript, no `import.meta.env`. The live stack is 100% Cloudflare. Treat that CLAUDE.md section as describing a different/planned system, not this codebase.

---

## 2. Build pipeline (`build.js`, ~264 lines)

`npm run build` → `node build.js` → `dist/`. `npm run dev` builds then runs `wrangler pages dev dist`.

- **Page manifest:** a `PAGES` array (16 entries) maps each template to the `content/*.json` files merged into it, with optional sitemap `priority` and `sitemap: false` (used by `tip.html`, `success.html`).
- **Template engine:** hand-rolled Mustache subset, single pass. `{{var}}` (HTML-escaped; names matching `/(^|_)url$/` are additionally run through `safeUrl()`), `{{{var}}}` (raw), `{{#sec}}`/`{{^sec}}` (loops/conditionals with nesting support), `{{> partial}}` (from `templates/partials/`, memoized), dot-path resolution.
- **Markdown:** only fields declared in `MARKDOWN_FIELDS` (`members.bio`, `statements.body`, `issues.body`) get the markdown subset (escape-first, then `**bold**`, `*italic*`, `[link](url)`, paragraphs, `\n` → `<br />`).
- **Sanitizers:** `escapeHtml()`, `safeUrl()` (allows only `http(s):`, `mailto:`, `/`, `#`; anything else → `#`).
- **Fail-fast validation:** JSON parse errors, missing templates/content/partials, unclosed sections — all abort with exit 1 **before** `dist/` is touched.
- **Derived content:** `content.homepage.statements` is overwritten at build time with the newest entry of `content/statements.json`, mapped to `{slug, date, title, snippet}` (see decision `docs/decisions/homepage-statement-derived.md`, and the known bug in §11).
- **Sitemap:** generated in-memory (root `sitemap.xml` was deleted this cycle); `<lastmod>` from template+content mtimes.
- **Static copy:** `css/`, `js/`, `assets/`, `robots.txt`, `llms.txt`, favicon, plus everything in `static/` copied to `dist/` root (so `static/_headers` → `dist/_headers`, `static/admin/` → `dist/admin/`).
- No minification, hashing, or bundling.

---

## 3. Templates and partials

16 page templates. 13 use the new partials (`{{> header}}` / `{{> footer}}`, both files **untracked/new** in `templates/partials/`):

| Template | Purpose |
|---|---|
| `index.html` | Homepage: hero, mission, featured statement (build-derived), featured press, projects grid, about, join form, donate block + modal. Organization JSON-LD. |
| `team.html` | Team bios from `team.json` (markdown bios, headshot `photo` field). |
| `blog.html` | News & Press: article cards + YouTube embeds from `blog.json`. |
| `statements.html` | Full statements list from `statements.json`. |
| `issues.html` | Policy Positions (7 numbered positions) from `issues.json`. |
| `projects.html` | Projects with nested press/videos from `projects.json`. |
| `theory.html` | Theory of Change narrative. |
| `privacy.html` | Privacy Policy (git-renamed from root `privacy.html` this cycle). |
| `tip.html` | Confidential tipline form; noindex, out of sitemap; only page loading `js/tip.js` (renamed from root `tip.html`). |
| `success.html` | Post-checkout thank-you. No header/footer at all. |
| `alpr.html` | ALPR/Flock Weber County long-form report (47 KB, big inline style block, JSON-LD, `coverage.alpr_coverage`). |
| `stratos.html` | Stratos / MIDA Box Elder data-center briefing (59 KB, `coverage.stratos_coverage`). |
| `weber-county.html` | Weber County election-law complaint page. |
| `privacy-report.html` | "The Denigration of Modern Private Space" surveillance report. |
| `how-did-this-happen.html` | Sept 2026 long-form policy paper. **Legacy: hardcoded header/footer, relative `js/main.js` path.** |
| `dignity-index-statement.html` | Dignity Index 25th-anniversary statement page. **Same legacy pattern.** |

`partials/header.html` carries the skip link, sticky header, mobile toggle, "About Us" dropdown (Team / Theory / Policies / Privacy Report), dark+light logo variants, `aria-current` via `{{#current.<page>}}`, and the opening `<main id="main">`. `partials/footer.html` carries the closing `</main>`, 501(c)(4) disclaimer, registered-lobbyist disclosure, link columns, and settings-driven org fields.

---

## 4. Content model (`content/*.json`)

| File | Drives |
|---|---|
| `settings.json` | Global (merged into every page): orgName, email, instagram, footerTagline, copyright. |
| `homepage.json` | `index.html` hero/mission/about/join/donate/modal + hand-curated `press[3]`. `statements` key is build-injected, not stored. |
| `team.json` | 3 members: name, title, `photo`, markdown bio. |
| `statements.json` | 1 statement (slug, date, topic, author, title, snippet, markdown body, signoff); also feeds the homepage featured card. |
| `issues.json` | 7 policy positions. |
| `projects.json` | 3 projects with nested articles/videos; also feeds homepage project cards. |
| `blog.json` | 9 articles + 4 videos. |
| `coverage.json` | Media-coverage strips for `alpr.html` and `stratos.json` pages. |

**Hard rule:** every key in these files must be declared in `static/admin/config.yml`, or Decap deletes it on save. Config.yml declares 8 file-collections (one per JSON), all `format: json`, with pattern validation (slugs, hex colors, YouTube IDs, URLs, emails) and editor hints. One known gap — see §11.

---

## 5. Client JS (no build step, plain scripts)

- **`js/main.js`** (~428 lines, all pages): sticky header + hero parallax; mobile nav; shared IntersectionObserver scroll-reveal system (`data-animate`); join form → `POST /api/subscribe`; donate flow (monthly/one-time toggle, tiers, custom amount, `publicDonor` checkbox) → `POST /api/create-checkout-session` → redirect to Stripe; eased stat counters; dropdown nav with full keyboard support; scroll-spy nav highlighting; donation modal (7.5 s delay, sessionStorage dismiss gate, focus trap, inert/aria handling); donation tracker → `GET /api/donations/stats` (donor names inserted via `textContent`, never innerHTML).
- **`js/tip.js`** (new, untracked; `tip.html` only): anonymous checkbox clears/disables name; client-side validation; `POST /api/tip`; submit button stays disabled after success to prevent duplicates.

---

## 6. CSS

Single global stylesheet `css/styles.css` (~1,584 lines). Design tokens in `:root`: navy `#1B2F4E` / red `#C0392B` / cream `#F5F1EA` palette, gray ramp, Inter (sans) + Playfair Display (serif) via Google Fonts CDN `<link>` in each template head. ~24 commented sections; fluid type via `clamp()`; the `data-animate` reveal system. No dark mode, no `prefers-reduced-motion`, no self-hosted fonts. Breakpoints inconsistent (900/860/768/640/600/480/1000px mix, all max-width). Long-form report pages additionally carry large per-page inline `<style>` blocks (allowed: CSP permits `unsafe-inline` for styles only).

---

## 7. Backend — Pages Functions (`functions/api/`)

Shared infrastructure (both files new/untracked):
- **`_lib.js`**: `json()` response helper (`Cache-Control: no-store` default), `escapeHtml`, `isValidEmail`, `str()` cap/trim, D1 sliding-window rate limiting (`rateLimitOr429` — **fails open** on DB errors by design), HMAC-SHA256 signed tokens (`signToken`/`verifyToken`, purpose-bound so token types can't be cross-replayed), pinned `STRIPE_API_VERSION = '2024-06-20'`.
- **`_middleware.js`**: stamps every `/api/*` response with nosniff, Referrer-Policy, `X-Robots-Tag: noindex`, and default `Cache-Control: no-store` (because `_headers` only covers static assets).

Routes:

| Route | Method | Rate limit | Does |
|---|---|---|---|
| `/api/subscribe` | POST | 5/hr | Upserts `subscribers`; sends Resend welcome email in `waitUntil` with RFC 8058 one-click unsubscribe headers (1-year signed token). |
| `/api/unsubscribe` | GET+POST | none | Verifies token; deletes from `subscribers` + sets `members.newsletter_opt_in = 0`; returns self-contained HTML page. New file, untracked. |
| `/api/tip` | POST | 5/hr | Proxies to Airtable (base/table hardcoded). Confidential: never logs request or upstream response bodies — status codes only. "Anonymous" replaces name with literal `"Anonymous"`; email still collected. Attachments not implemented. |
| `/api/create-checkout-session` | POST | 10/hr | Stripe Checkout with inline `price_data` ($1–$100k bounds), subscription or one-time; donor prefs in metadata (copied to `subscription_data.metadata` for recurring). |
| `/api/create-portal-session` | POST | 5/hr | Magic-link flow: always returns 202, lookup + Resend email deferred to `waitUntil` (anti-enumeration, timing-safe). 15-min portal token. |
| `/api/create-portal-session?token=` | GET | none | Verifies token, mints Stripe Billing Portal session, 302 redirect. |
| `/api/webhook` | POST | none | Stripe webhook. Hand-rolled signature verify (constant-time, 300 s skew window, multi-`v1` rotation support). Idempotent via `processed_events` (`INSERT OR IGNORE`; row deleted + 500 returned on handler error so Stripe retries). Handles checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.deleted/updated. Compatibility shims for both old and new Stripe invoice shapes. |
| `/api/donations/stats` | GET | none | Public: 3 most recent `public=1` donors only; `Cache-Control: public, max-age=60`. (Total/goal removed 2026-09-12 by org policy — see docs/systems/donation-tracker.md.) |

Deleted this cycle: `functions/auth.js` — `/auth` now 302s via `static/_redirects` to the standalone Worker.

---

## 8. Auth Worker (`workers/auth/`)

Standalone Cloudflare Worker `uccsite-auth` (default workers.dev hostname, reached via `static/_redirects`): GitHub OAuth proxy for Decap. `GET /auth` sets an HttpOnly state cookie and redirects to GitHub; `GET /callback` does a constant-time state check, exchanges the code, and redirects back to `/admin/callback.html` with the token **only in the URL fragment**. The admin pages relay it same-origin via BroadcastChannel / localStorage / postMessage. Config: `CLIENT_ID` public var, `GITHUB_SCOPE=public_repo`, `CLIENT_SECRET` as a Worker secret. Opaque fixed error codes.

---

## 9. Database (D1 `ucc-members`, `schema.sql`)

| Table | Purpose |
|---|---|
| `members` | Donors keyed to `stripe_customer_id` (UNIQUE); newsletter opt-in flag. |
| `subscriptions` | Recurring memberships: stripe sub/price IDs, amount, status, period end. |
| `donations` | One-time + recurring payments; `public` flag drives donor ticker. |
| `subscribers` | Newsletter/join-form list (separate from members). |
| `rate_limits` | Sliding-window rate limiting (ip, endpoint, timestamp). |
| `processed_events` | Stripe webhook idempotency. |

All DDL is `IF NOT EXISTS`. Indexes on members email/stripe, subscription status, subscriber email, rate-limit lookup. No index on `donations`.

---

## 10. Config, secrets, email

- **`wrangler.toml`:** Pages project `uccsite`, D1 binding `DB`. Secrets (set via `wrangler pages secret put`, inventoried in comments): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AIRTABLE_TOKEN`, `RESEND_API_KEY`, `TOKEN_SECRET`. No KV/R2/queues/cron. (`DONATION_GOAL_CENTS` removed 2026-09-12.)
- **Transactional email:** Resend, from `hello@utahciviccompact.org` (welcome + portal magic link + receipts implicit in flows above).
- **Bulk periodical:** `scripts/send-periodical.js` — manually run Node script using **Mailgun** (not Resend), reads recipients from D1 via `wrangler d1 execute`, requires a literal `{{unsubscribe_url}}` placeholder in the HTML, sends one-at-a-time with resume logging. Needs `MAILGUN_API_KEY` + `TOKEN_SECRET` in `.env` (gitignored). It re-implements `_lib.js`'s token signing in Node crypto (deliberate mirror).
- **`robots.txt`:** allows all incl. AI crawlers explicitly; disallows `/admin/` and `/api/`. **`llms.txt`:** org summary with key-pages list and active-investigation figures.

---

## 11. Security posture

- **CSP (new `static/_headers`, replacing deleted root `_headers`):** site-wide `script-src 'self' https://static.cloudflareinsights.com` — **no unsafe-inline for scripts** (all JS is external; inline `<script>` tags are JSON-LD only). `style-src` allows `unsafe-inline` (needed for per-page style blocks). `object-src 'none'`, `frame-ancestors 'none'`, YouTube-only frames, HSTS preload, X-Frame-Options DENY, Permissions-Policy lockdown. Separate looser CSP for `/admin/*` only (Decap needs `unsafe-inline`/`unsafe-eval` + GitHub connect-src); rationale in `docs/decisions/csp-split-admin.md`.
- **Rate limiting:** D1-backed, keyed on `CF-Connecting-IP`; fails open on DB errors. No CAPTCHA/Turnstile/honeypot anywhere — rate limiting is the only form-abuse control.
- **Tokens:** all HMAC-SHA256 WebCrypto, purpose-bound. Unsubscribe tokens are 1-year single-factor links. If `TOKEN_SECRET` unset: subscribe degrades unsubscribe link to `/#join`; portal POST 503s.
- **SQL:** fully parameterized everywhere.
- **Tipline confidentiality:** enforced in `tip.js` by policy comment + status-only error logging; Airtable token server-side only.
- **Anti-enumeration:** portal POST always 202, work deferred past the response.

---

## 12. Docs system

- `docs/systems/` (8 files): accessibility, api-security, bylines, cms, donation-tracker, site-structure, style-guide, tipline — Code Maps + data flow per system.
- `docs/decisions/` (14 ADRs, 4 new this cycle): incl. csp-split-admin, homepage-statement-derived, portal-magic-link, template-partials, rate-limiting-d1-vs-kv, tipline-proxy-not-client-api.
- `docs/error-handling/` (new): `build-failures/2026-08-23-template-engine-regex-loop.md`.
- Also: `docs/non-technical-editing-guide.md`, `docs/emails/`. Deleted: `docs/plan-site-elevation.md`.

---

## 13. Known defects / inconsistencies in the current tree

These exist in the code as of this snapshot:

1. **Homepage featured-statement card renders a dead link.** `templates/index.html` renders `href="{{url}}"` and `{{more}}`, but `build.js`'s derived-statement mapping only passes `{slug, date, title, snippet}` — so the built card is `href="#"` with an empty "read more" line. The two decision docs (`homepage-statement-card-links.md` vs `homepage-statement-derived.md`) contradict each other on this.
2. **CMS will strip team photos on save.** `content/team.json` has a `photo` field per member; `static/admin/config.yml`'s team collection declares only name/title/bio. First CMS save of Team deletes `photo` from all three members and breaks the headshots.
3. **Three un-migrated templates.** `how-did-this-happen.html` and `dignity-index-statement.html` still hardcode header/footer (and load `js/main.js` via relative path); `success.html` has no header/footer. Their nav will drift from the partials.
4. **Donation total includes private donations.** `/api/donations/stats` SUMs all rows regardless of the `public` flag; only the recent-donor list respects it. (May be intended; noted as data-exposure behavior.)
5. **CLAUDE.md's Amplify section describes code that does not exist** (see §1). Any session following it will look for files that aren't there.
6. **`assets/uploads/` exists but is empty and untracked** — Decap's media target; uploads won't be tracked until the dir has content and is committed.
