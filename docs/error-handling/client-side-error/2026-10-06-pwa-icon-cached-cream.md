# 2026-10-06 — Installed admin PWA kept the old cream/transparent icon

**Symptom.** After commit b3c3073 (icons flattened onto navy `#1b2f4e`,
manifest `background_color` navy) was deployed, uninstalling and reinstalling
the admin on a phone still showed the mark on a cream tile.

**Route.** `/icon.png`, `/apple-icon.png` (Next `app/icon.png` metadata
conventions) referenced from `app/manifest.js`.

**Repro.** `curl -sI https://admin.utahciviccompact.org/icon.png` →
`Cache-Control: public, immutable, no-transform, max-age=31536000`,
`X-Cache: Hit from cloudfront`. The manifest's `icons[].src` is the bare
`/icon.png`; only Next's own `<link rel="icon">` / `apple-touch-icon` tags
get a `?<content-hash>` query. The phone's HTTP cache (and CloudFront) served
the year-old transparent PNG to the install flow, so reinstalling changed
nothing.

**Root cause.** Next serves static metadata icons as immutable for one year
and the manifest cannot carry the content hash, so changing the icon's bytes
without changing its URL is invisible to installers.

**Fix.** Renamed to the numbered conventions `app/icon1.png` /
`app/apple-icon1.png` (served at `/icon1.png`, `/apple-icon1.png`); updated
`manifest.js`, middleware `PUBLIC_PATHS`, and the `<img src>` in `layout.js`,
`nav.js`, `login/page.js`. Any future artwork change bumps the number.

**What would catch it earlier.** Checking the response headers of a
replaced static asset before telling someone to reinstall.
