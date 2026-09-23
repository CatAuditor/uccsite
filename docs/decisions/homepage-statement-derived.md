# Homepage featured statement derived from statements.json

**Status (2026-09-13):** still in force — `deriveHomepage` in `packages/render/site.js`; see also homepage-statement-links.md.

> **Amended 2026-09-23:** the homepage features the newest **three** statements,
> not one (`HOMEPAGE_FEATURED` in `packages/render/site.js`). Derivation itself
> is unchanged. The live Cloudflare site had diverged to three hand-curated
> cards, two of them pointing at standalone report pages. Matching it through
> the existing `url`/`more` overrides keeps the homepage editable in the admin,
> which a stored `homepage.statements` array would not be — the admin's homepage
> editor has no list widget for it (`apps/admin/app/homepage/page.js` handles
> "six flat-string groups + the hand-curated press list"). Consequence: the two
> report pages now also appear on `/statements.html`, where the Cloudflare site
> did not list them. Recorded as a deliberate difference.

> **Partially superseded 2026-09-12** by
> [homepage-statement-links.md](homepage-statement-links.md): derivation stays,
> but the mapping now also supplies `url`/`more` (with optional per-entry
> overrides in `statements.json`).

**Date:** 2026-08-23

## Decision
`build.js` sets `homepage.statements` to the first entry of `content/statements.json` at build time. The duplicate `statements` array was removed from `content/homepage.json` and from the Homepage CMS collection.

## Why
The two copies had to be kept in sync by hand and could silently diverge (different title linking to the same slug). Press on the homepage stays hand-curated because it mixes articles and videos and editors choose which to feature.

## What breaks if reversed
Re-adding `statements` to `homepage.json` will be overwritten by the build; the CMS collection would need the field back too.
