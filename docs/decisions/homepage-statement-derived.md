# Homepage featured statement derived from statements.json

**Date:** 2026-08-23

## Decision
`build.js` sets `homepage.statements` to the first entry of `content/statements.json` at build time. The duplicate `statements` array was removed from `content/homepage.json` and from the Homepage CMS collection.

## Why
The two copies had to be kept in sync by hand and could silently diverge (different title linking to the same slug). Press on the homepage stays hand-curated because it mixes articles and videos and editors choose which to feature.

## What breaks if reversed
Re-adding `statements` to `homepage.json` will be overwritten by the build; the CMS collection would need the field back too.
