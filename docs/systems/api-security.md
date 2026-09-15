# API Security

## Code Map

```
functions/api/
  _lib.js                    shared: json(), escapeHtml(), isValidEmail(), str(), checkRateLimit(),
                             rateLimitOr429(), signToken()/verifyToken(), STRIPE_API_VERSION
  _middleware.js             stamps nosniff / Referrer-Policy / X-Robots-Tag / no-store on every /api/* response
  subscribe.js               POST — join form → D1 subscribers + welcome email (Resend)
  unsubscribe.js             GET|POST ?token= — removes subscriber, sets members.newsletter_opt_in=0
  tip.js                     POST — tipline → Airtable (Cloudflare only; the AWS port writes the `tips` table — see tipline.md)
  create-checkout-session.js POST — Stripe Checkout session
  create-portal-session.js   POST (request link) / GET ?token= (open portal) — see Billing Portal
  webhook.js                 POST — Stripe events → D1
  donations/stats.js         GET — public donation totals (see donation-tracker.md)
```

Files prefixed `_` are not routed. `static/_headers` only applies to static assets; API responses get their headers from `_middleware.js`.

## AWS port (Phase 5 — serves staging now, prod at cutover)

`aws/api/` is the line-by-line Lambda port of this directory (one function,
CloudFront `/api/*` → Function URL): `lib.js` (= `_lib.js` + header stamping
from `_middleware.js`; token code byte-compatible so TOKEN_SECRET carries
over), `webhook.js`, `routes.js`, `stripe.js`, `index.mjs` (router + origin
lock), `secrets.js` (runtime Secrets Manager loads — `ucc/<env>/<NAME>`).
Behavioral deltas, all deliberate: client IP = last `X-Forwarded-For` entry
(was `CF-Connecting-IP`); subscribe's welcome email sends inline (no
`waitUntil`); the portal magic-link lookup runs in a constant-shape async
self-invocation (timing-safe 202 preserved); Turnstile verification on
subscribe + tip (fail-open, skipped until keys exist); stats returns `recent`
only. Everything below (rate limits, tokens, webhook semantics) applies to
both stacks until Cloudflare retires.

## Rate Limiting
D1-based, implemented once in `_lib.js` (`checkRateLimit`, wrapped by `rateLimitOr429`). Table: `rate_limits (id, ip, endpoint, timestamp)`.

| endpoint key | route | limit |
|---|---|---|
| `subscribe` | `/api/subscribe` | 5 / IP / hour |
| `tip` | `/api/tip` | 5 / IP / hour |
| `checkout` | `/api/create-checkout-session` | 10 / IP / hour |
| `portal` | `POST /api/create-portal-session` | 5 / IP / hour |

Uses `CF-Connecting-IP`. Old rows deleted on each check. **Fails open**: if D1 errors, the check is logged and the request proceeds (documented trade-off — availability over strictness for a low-value target).

## Signed Tokens
`signToken(secret, purpose, email, ttl)` / `verifyToken(secret, purpose, token)` in `_lib.js` — HMAC-SHA256 over a JSON payload `{p, e, x}`, base64url, constant-time compare via WebCrypto `verify`. Purposes in use: `portal` (15 min), `unsubscribe` (1 year). `scripts/send-periodical.js` signs the same format with Node crypto. Secret: `TOKEN_SECRET`.

## Webhook Verification
`webhook.js` verifies Stripe signatures using HMAC-SHA256 via Web Crypto. Constant-time compare; accepts any of multiple `v1=` signatures (secret rotation); rejects events older than 300 s. Event IDs are recorded in `processed_events` (`INSERT OR IGNORE`) so redeliveries return 200 without reprocessing; on handler error the row is removed so Stripe's retry is reprocessed.

## Billing Portal (magic link)
1. `POST /api/create-portal-session {email}` → always `202 {ok:true}`. After responding, if the email matches a member with a real `cus_` customer ID, a 15-minute signed link is emailed via Resend. No enumeration — same response and timing whether or not the email exists.
2. `GET /api/create-portal-session?token=` → verifies token, mints a Stripe Billing Portal session, `302` to it. Invalid/expired → `400`.

Requires `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `TOKEN_SECRET`.

## Input Handling
- All DB queries use parameterized statements.
- `str(value, max)` in `_lib.js` coerces to string, trims, and caps length — used for every user-supplied string in every function (names 100, address 200, zip 10, email 254, tip body 100 000).
- `isValidEmail()` applied to every email field server-side (checkout included).
- Anything rendered into HTML from user data is escaped (`escapeHtml` in emails) or inserted via `textContent` (donor names in `js/main.js`).
- Checkout: `customer_creation: 'always'` for one-time payments so the webhook can always link a donation to a member; `publicDonor` is copied to `subscription_data.metadata` so recurring invoices honor the opt-out.
- Stripe requests pin `Stripe-Version` (`STRIPE_API_VERSION` in `_lib.js`). `webhook.js` reads both the pinned and newer invoice shapes (`invoice.subscription` / `invoice.parent.subscription_details`).

## Headers / CSP (`static/_headers` on Cloudflare; `infra/cdk/lib/ucc-stack.js` SITE_CSP on AWS)
- Site-wide: `script-src 'self' https://static.cloudflareinsights.com` — **no `unsafe-inline`/`unsafe-eval`**. Any new inline `<script>` will be blocked; put it in `js/`. JSON-LD blocks are fine (not executed).
- **AWS (2026-09-13, Phase 8): `style-src 'self'` and `font-src 'self'`** — no
  `unsafe-inline`, no Google Fonts. Every stylesheet is a file: `css/styles.css`,
  `css/fonts.css` (self-hosted woff2 in `assets/fonts/`, regenerate with
  `scripts/fetch-fonts.mjs`), `css/colors.css` (generated at render from content
  `badge_color`/`status_color` values → `.c-<hex>` classes), `css/pages/<page>.css`
  (the fixed pages' former inline `<style>` blocks) and each Document's
  `css/pages/<slug>.<hash>.css`. **No `style="…"` attributes in templates** — use
  a class (utilities at the bottom of `css/styles.css`). Scripts may still set
  `element.style.*` (CSSOM writes are not governed by CSP). The Cloudflare
  `_headers` file keeps `unsafe-inline` until cutover; a git-source publish to
  AWS would render the old inline styles, which the AWS CSP now blocks — publish
  AWS from the database (`--source db`).
- `/admin/*`: relaxed CSP (Decap needs `unsafe-inline`/`unsafe-eval`), `X-Robots-Tag: noindex`, `Cache-Control: no-store`.
- `X-Frame-Options: DENY` matches `frame-ancestors 'none'`; `object-src 'none'`.

## Secrets / vars (Cloudflare Pages)
See the comment block in `wrangler.toml` for the full inventory: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AIRTABLE_TOKEN`, `RESEND_API_KEY`, `TOKEN_SECRET` (secrets). The AWS stack (`aws/api/secrets.js`) has no `AIRTABLE_TOKEN` — tips go to DSQL. Missing `TOKEN_SECRET` → portal returns 503, unsubscribe links fall back to the homepage. (`DONATION_GOAL_CENTS` removed 2026-09-12 — no total/goal in the stats endpoint.)

## DSQL access (AWS stack)

The API Lambda is the only internet-facing DB client and connects as the
custom role **`api`** with a `dsql:DbConnect` token (`DSQL_USER` env,
`packages/db` `connect({ user })`). It never holds `admin`. Grants
(`packages/db/schema.js` `API_GRANTS`, applied by `scripts/migrate-schema.mjs`,
which also creates the role and maps it to the Lambda's IAM role via
`AWS IAM GRANT … TO '<ApiRoleArn>'`):

| Table | api may | Used by |
|---|---|---|
| `rate_limits` | SELECT, INSERT, DELETE | every rate-limited route |
| `subscribers` | SELECT, INSERT, UPDATE, DELETE | subscribe (upsert), unsubscribe |
| `members` | SELECT, INSERT, UPDATE | webhook, portal magic link, unsubscribe opt-out |
| `subscriptions` | SELECT, INSERT, UPDATE | webhook |
| `donations` | SELECT, INSERT | webhook, `/api/donations/stats` |
| `processed_events` | SELECT, INSERT, DELETE | webhook idempotency |
| `tips` | **INSERT only** | `/api/tip` (write-only from the internet, docs/systems/tipline.md) |
| content tables, `audit_log`, `revisions`, … | nothing | — |

A route that needs more fails with SQLSTATE 42501 `permission denied for
table …`: extend `API_GRANTS`, re-run `migrate-schema.mjs`. Never grant the
API `DbConnectAdmin` again (`docs/decisions/api-dsql-least-privilege.md`).

## Schema
`schema.sql` is the source of truth. Apply new tables to the live DB with `wrangler d1 execute ucc-members --remote --file schema.sql` (all statements are `IF NOT EXISTS`). Added 2026-08-23: `processed_events`.
