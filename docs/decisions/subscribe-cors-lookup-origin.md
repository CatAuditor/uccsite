# CORS on /api/subscribe for the officials lookup only

**Date:** 2026-10-08 · approved by Conner

## Choice
Allow exactly `https://lookup.utahciviccompact.org`, on `/api/subscribe` only
(`aws/api/lib.js withLookupCors`, `routes.js subscribePreflight`, `cors` flag in
the `index.mjs` route table). The visitor's browser posts the opt-in directly.

## Alternatives
- **Lookup backend calls our API server-to-server.** No CORS, but every request
  would come from the lookup Lambda's IP: the 5/IP/hour limit would throttle
  all lookup visitors together, and Turnstile's `remoteip` would be wrong.
- **`*` or reflecting any Origin.** Lets any website sign people up from a
  visitor's browser. Only one app needs it.
- **CORS on all `/api/*`.** Only subscribe is needed; tip, petition, checkout
  and portal stay same-origin.

## What breaks if reversed
Removing it makes the lookup's newsletter checkbox fail in the browser
(blocked by CORS); its signups stop reaching `subscribers`. Widening it (more
origins or routes) widens who can post to the API from a visitor's browser —
turn on Turnstile first.
