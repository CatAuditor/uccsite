# 2026-10-07 — Search Console rejects sitemap.xml: "Incorrect namespace"

## Error

Google Search Console → Sitemaps → `https://utahciviccompact.org/sitemap.xml`:

```
Sitemap can be read, but has errors
Incorrect namespace — 1 instance
Your Sitemap or Sitemap index file doesn't properly declare the namespace.
Line 2   Tag: urlset
```

21 pages were still discovered.

## Cause

`packages/render/site.js` `makeSitemap` wrote

```xml
<urlset xmlns="http://www.sitemaps.org/schema/sitemap/0.9">
```

The protocol's namespace is `http://www.sitemaps.org/schemas/sitemap/0.9` —
**schemas**, plural. Search engines match the namespace as an exact string.

The sitemap test (`parity.test.mjs` "sitemap: structure…") checked the XML
declaration, locs, exclusions and lastmod, but never the namespace.

## Fix

- `makeSitemap`: `schema` → `schemas`.
- `parity.test.mjs`: asserts the exact `urlset` namespace. Verified the
  assertion fails with the typo restored and passes with the fix.

Goes live on: push → `cdk deploy UccProd` (PublishFn renders the sitemap) →
publish. Then Search Console → Sitemaps → open the sitemap → **Resubmit** (or
wait for Google's next read).

## What would have caught it earlier

A test on the one string Google validates first. Any generated XML that an
outside service parses (sitemap, RSS, structured data) should have its
namespace or schema asserted exactly in a test.
