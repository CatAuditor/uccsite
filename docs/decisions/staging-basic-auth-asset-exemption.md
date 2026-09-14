# Staging basic auth gates pages, not static assets

**Date:** 2026-09-13

## Decision
The staging CloudFront Function (`infra/cdk/cf-fn/viewer-request.js`) skips the
basic-auth check for URIs under `/css/`, `/assets/` and `/media/`. Every other
path (pages, `/files/*`, `/api/*`, `/admin`) still returns 401 without the
`preview:` credential. Prod is unaffected (`BASIC_AUTH` is empty there).

## Why
The admin's Documents editor previews a report in a sandboxed `srcdoc` iframe
with `<base href=PUBLIC_ORIGIN>` and a `<link>` to `PUBLIC_ORIGIN/css/fonts.css`.
On staging every one of those subresource requests got a 401 with
`WWW-Authenticate: Basic`, and the browser answered with a native sign-in
dialog on top of the admin — for a user already signed in through Cognito.
Cognito sessions cannot satisfy a CloudFront basic-auth gate; the two are
unrelated.

Alternatives considered:
- **Proxy the assets through the admin** (a Next route reading S3). More code,
  and the route would have to be unauthenticated because the sandboxed frame
  sends no cookies — which publishes the same bytes from a different origin.
- **Inline `fonts.css` like the other stylesheets.** Does not cover the font
  files it references, nor `/assets/*` and `/media/*` images inside a document.
- **Drop the gate entirely.** The gate exists to keep unfinished staging pages
  out of casual view and search; CSS, fonts and images are not what it protects.

## What breaks if reversed
Re-gating those prefixes brings the sign-in dialog back on every document
preview on staging (and any other admin surface that embeds site assets).
`scripts/staging-check.mjs` asserts `/css/styles.css` is 200 without auth.
