# 2026-10-06 — publish run failed: `page.content is not iterable` (newsletter archive)

**Where:** PublishFn (staging), run `operator:newsletters-index`, status `failed`,
error `page.content is not iterable`. Surfaced in `publish_runs.error` and the
admin's Publish & Status run table.

**Cause:** `packages/render/newsletters.js` pushed sitemap entries
(`sitemapExtra`) for `/newsletters` without a `content` list and, for the
empty index, with `lastmodAt: undefined`. `aws/publish/render-db.js`'s
`lastmod(page)` falls back to `makeDbLastmod(meta)(page)` when `lastmodAt`
is missing, and that iterates `page.content`. A newsletter row with an
unparsable `sent_at` would have hit the sibling failure in `makeSitemap`
(`toISOString` on an Invalid Date).

**Fix:** every archive sitemap entry carries `content: []` and
`lastmodAt: validIso(...)` (a real ISO string, now() when the source date is
missing or invalid). Regression test in
`packages/render/test/newsletters.test.mjs`.

**What would have caught it earlier:** rendering the whole site from the
database locally before deploying (the ad-hoc script in this session; worth
keeping as `scripts/render-check.mjs` next time the pipeline changes). The
unit test exercised `buildNewsletterArchive` alone, not `buildSite` with its
output.
