# Strict site-wide CSP, relaxed only under /admin/*

> **The /admin/* half is retired (2026-09-23).** Decap was deleted from the AWS
> site before cutover, taking its relaxed policy with it — see
> decap-removed-before-cutover.md. /admin now serves the site policy and 404s.
> Cloudflare still serves both policies from `main` until the DNS flip. The
> strict site-wide policy below stands.

**Date:** 2026-08-23

## Decision
`static/_headers` serves `script-src 'self' https://static.cloudflareinsights.com` for the whole site (no `unsafe-inline`, no `unsafe-eval`) and a separate relaxed policy for `/admin/*` where Decap CMS requires both.

## Why
Two stored-XSS sinks were found in review (donor first name via `innerHTML`; CMS-controlled `href="{{{url}}}"`). Both are fixed at the source, but the old site-wide `unsafe-inline` meant any future slip was exploitable on the production origin — the same origin where the Decap GitHub token briefly lives. The only first-party inline script (`tip.html`) was moved to `js/tip.js`.

## Consequences
- Any new `<script>` with inline code is blocked by the browser. Put it in `js/`.
- `<script type="application/ld+json">` is fine (not executed).
- Inline `style` attributes and `<style>` blocks still work (`style-src 'unsafe-inline'` retained) — **on Cloudflare only. Superseded on AWS (2026-09-13):** the CloudFront policy is `style-src 'self'`; see docs/systems/api-security.md. The `/admin/*` relaxed block retires with Decap.

## What breaks if reversed
Adding `unsafe-inline` back to the `/*` policy re-enables the XSS class. Removing the `/admin/*` block breaks CMS login (Decap needs eval).
