# Donation Tracker

Recent-donor list displayed in the donate section of `index.html`.

**Org policy (2026-09-12):** the public site shows **no running total, goal, or
progress bar** — how much is coming in is not public unless the org posts a
specific fundraising-goal campaign. Only the opt-in recent-donor list renders.
(Full per-donation detail — amount, donor, contact info — becomes visible to
staff in the Phase 7 admin; see `docs/build-spec-aws.md` planning addendum 2.)

## Data flow

1. Donor checks out — `publicDonor` boolean sent from the form to `/api/create-checkout-session`, stored in Stripe metadata
2. Stripe fires `checkout.session.completed` → `functions/api/webhook.js` reads `publicDonor` from metadata and inserts into `donations` with `public = 1|0`. Checkout sets `customer_creation: 'always'` for one-time payments so a `members` row always exists to attach the donation to (without it `session.customer` is null and the donation was silently skipped — fixed 2026-08-23).
2b. Recurring: `publicDonor` is also copied to `subscription_data.metadata` at checkout; `invoice.paid` reads it from `invoice.subscription_details.metadata` so renewals honor the opt-out.
3. Frontend fetches `GET /api/donations/stats` on page load → renders the recent-donor list (hidden entirely when the list is empty)

## API: GET /api/donations/stats

`functions/api/donations/stats.js` — returns:
```json
{ "recent": [{ "firstName": "Alex", "amountCents": 5000 }] }
```

- Only donations with `public = 1` appear in `recent` (limit 3, newest first). Donors opt out via checkbox at checkout.
- `totalCents` / `goalCents` were REMOVED 2026-09-12 (org policy above). The `DONATION_GOAL_CENTS` env var is no longer read and can be deleted.
- Successful responses are cached for 60 seconds (`Cache-Control: public, max-age=60`); error responses are `no-store`.
- `firstName` is user-supplied. `js/main.js` renders it with `textContent`, never `innerHTML`.

## Schema change

Added `public INTEGER NOT NULL DEFAULT 1` to the `donations` table. Apply to existing D1 database:
```sql
ALTER TABLE donations ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
```

## Opt-out

Checkbox "Show my first name and amount on the public donor list" defaults to checked. Unchecking sets `public = 0` — that donation is excluded from `recent`. (All donations, public or not, remain in the `donations` table for staff/admin reporting.)
