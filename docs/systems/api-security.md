# API Security

## Rate Limiting
D1-based. Table: `rate_limits (id, ip, endpoint, timestamp)`.

Limits:
- `subscribe` — 5 req / IP / hour
- `checkout` — 10 req / IP / hour
- `tip` — 5 req / IP / hour

Uses `CF-Connecting-IP` header for IP. Old rows deleted on each check (cleanup-on-read).

Required migration:
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ip        TEXT    NOT NULL,
  endpoint  TEXT    NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON rate_limits (ip, endpoint, timestamp);
```

## Webhook Verification
`webhook.js` verifies Stripe signatures using HMAC-SHA256 via Web Crypto API. Comparison is constant-time (XOR loop). Rejects events older than 300 seconds.

## Billing Portal
`create-portal-session.js` accepts `email`, looks up `stripe_customer_id` from D1 `members`. Client cannot supply arbitrary customer IDs.

## Input Handling
- All DB queries use parameterized statements (no SQL injection)
- `firstName` HTML-escaped before interpolation into welcome email
- Field length caps in `subscribe.js`: name 100 chars, address 200, zip 10
