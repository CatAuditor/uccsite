# Billing portal access via emailed magic link

**Status (2026-09-13):** still in force on AWS — ported to `aws/api` with the same `TOKEN_SECRET` (never rotated, spec §20).

**Date:** 2026-08-23

## Decision
`POST /api/create-portal-session` no longer returns a Stripe Billing Portal URL directly. It always responds `202` and, only if the email is on file, emails a 15-minute HMAC-signed link (`GET /api/create-portal-session?token=`) that opens the portal.

## Alternatives
- **Keep email-only lookup (previous):** anyone who knows a donor's email could open their portal — see card last-4, invoices, cancel the subscription. Rejected: IDOR.
- **Require login:** the site has no accounts. Rejected: heavy.
- **Rate-limit only:** does not stop a targeted attacker who knows one email. Rejected.

## What breaks if reversed
Reverting to direct URL issuance reintroduces the IDOR. Any client that expects a `url` in the POST response must instead tell the user to check their email.

## Dependencies
`TOKEN_SECRET` (Pages secret) and `RESEND_API_KEY`. Token helpers in `functions/api/_lib.js`.
