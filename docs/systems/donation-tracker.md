# Donation Tracker

Live progress bar and recent-donor list displayed in the donate section of `index.html`.

## Data flow

1. Donor checks out — `publicDonor` boolean sent from the form to `/api/create-checkout-session`, stored in Stripe metadata
2. Stripe fires `checkout.session.completed` → `functions/api/webhook.js` reads `publicDonor` from metadata and inserts into `donations` with `public = 1|0`
3. Frontend fetches `GET /api/donations/stats` on page load → renders bar + list

## API: GET /api/donations/stats

`functions/api/donations/stats.js` — returns:
```json
{ "totalCents": 25600, "goalCents": 100000, "recent": [{ "firstName": "Alex", "amountCents": 5000 }] }
```

- `goalCents` comes from env var `DONATION_GOAL_CENTS` (default: 100000 = $1,000). Change it in Cloudflare Pages env vars — no code deploy needed.
- Only donations with `public = 1` appear in `recent`. Donors opt out via checkbox at checkout.
- Response is cached for 60 seconds (`Cache-Control: public, max-age=60`).

## Schema change

Added `public INTEGER NOT NULL DEFAULT 1` to the `donations` table. Apply to existing D1 database:
```sql
ALTER TABLE donations ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
```

## Opt-out

Checkbox "Show my first name and amount on the public donor list" defaults to checked. Unchecking sets `public = 0` — that donation is excluded from `recent` and still counted in `totalCents`.
