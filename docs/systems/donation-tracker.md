# Donation Tracker

Recent-donor list displayed in the donate section of `index.html` and on the
`/donate` page.

**Org policy (2026-09-12):** the public site shows **no running total, goal, or
progress bar** — how much is coming in is not public unless the org posts a
specific fundraising-goal campaign. Only the opt-in recent-donor list renders.
(Full per-donation detail — amount, donor, contact info — becomes visible to
staff in the Phase 7 admin; see `docs/build-spec-aws.md` planning addendum 2.)

## Donate page (`/donate`, 2026-10-10)

`templates/donate.html` + `css/pages/donate.css`; `PAGES` entry
`{ template: 'donate.html', content: ['settings', 'homepage'], priority: '0.8' }`.
The nav's red Donate button, the footer Donate link, the homepage timed modal,
the download modal, the petition thank-you email's "Chip in" fallback and the
Stripe `cancel_url` / portal `return_url` all point here (they pointed at the
homepage anchor `/#donate` before; the homepage section itself stays).

- **Copy**: the homepage `donate` group (admin → Donation appeals). `label`;
  `page_headline` (HTML, `<em>` = red; blank → `title`); `page_intro` (blank →
  `body`); `points_heading` (blank → "Where your money goes"); `point1..3_title`
  / `_body` — no `point1_title` = no list. The FAQ, the form, the amounts and
  the 501(c)(4) line are in the template.
- **Form**: the same ids as the homepage (`#donate-submit`, `.tier-btn`, …), so
  `js/main.js initDonate()` runs unchanged; the submit button carries
  `data-source="donate-page"`, which `initDonate` sends as `source` → Stripe
  metadata (`aws/api/routes.js createCheckoutSession`) → visible in admin →
  Financial → Donations. The homepage form sends no source.
- **Recent donors**: `#donation-tracker` below the fold (same markup, same fetch).
- No timed modal on this page (`#donate-modal` is homepage-only).
- Deploy: template + CSS changes need `cdk deploy UccProd` (PublishFn bundles
  `site-src`) before a publish; the `routes.js` URL change ships with the API in
  the same deploy.

## Data flow

1. Donor checks out — `publicDonor` boolean sent from the form to `/api/create-checkout-session`, stored in Stripe metadata
2. Stripe fires `checkout.session.completed` → `functions/api/webhook.js` reads `publicDonor` from metadata and inserts into `donations` with `public = 1|0`. Checkout sets `customer_creation: 'always'` for one-time payments so a `members` row always exists to attach the donation to (without it `session.customer` is null and the donation was silently skipped — fixed 2026-08-23).
2b. Recurring: `publicDonor` is also copied to `subscription_data.metadata` at checkout; `invoice.paid` reads it from `invoice.subscription_details.metadata` so renewals honor the opt-out.
2c. (AWS, 2026-10-09) After the rows are written, `checkout.session.completed` dispatches the **donation thank-you / receipt** email as the self-invoke job `donation-thanks` (`aws/api/webhook.js` → `routes.js donationThanksJob` → `emails.js`); one-time and the first monthly charge only, never renewals. Copy: admin Appeals → Homepage donate section → Thank-you email fields. Details: docs/systems/email.md.
3. Frontend fetches `GET /api/donations/stats` on page load → renders the recent-donor list (hidden entirely when the list is empty)

## API: GET /api/donations/stats

`functions/api/donations/stats.js` (Cloudflare) and `aws/api/routes.js`
`donationStats()` (AWS, serves staging now) — identical response; the DSQL
side is backed by the new `donations(public, created_at)` index. Returns:
```json
{ "recent": [{ "firstName": "Alex", "amountCents": 5000 }] }
```

- Only donations with `public = 1` appear in `recent` (limit 3, newest first). Donors opt out via checkbox at checkout.
- `totalCents` / `goalCents` were REMOVED 2026-09-12 (org policy above). The `DONATION_GOAL_CENTS` env var is no longer read and can be deleted.
- Successful responses are cached for 60 seconds (`Cache-Control: public, max-age=60`); error responses are `no-store`.
- `firstName` is user-supplied. `js/main.js` renders it with `textContent`, never `innerHTML`.

## Admin view (2026-10-10)

Staff read every donation under **Financial → Donations** (filters, the
donor's monthly-plan state) and the money side under **Financial → Costs**
— docs/systems/finance.md.

## Schema change

Added `public INTEGER NOT NULL DEFAULT 1` to the `donations` table. Apply to existing D1 database:
```sql
ALTER TABLE donations ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
```

2026-10-10 (DSQL, `packages/db/schema.js`): `stripe_subscription_id TEXT`,
written by `invoice.paid` so a monthly payment is distinguishable from a
one-time gift (`recordDonation({ subscriptionId })` in `aws/api/webhook.js`).

## Opt-out

Checkbox "Show my first name and amount on the public donor list" defaults to checked. Unchecking sets `public = 0` — that donation is excluded from `recent`. (All donations, public or not, remain in the `donations` table for staff/admin reporting.)
