# Documents & Styling (spec §3.2, §5, §6, §12 — Phase 8)

A Document is a long-form page an editor creates without a developer: a
pasted **body fragment** (`body_html_raw`, never mutated), its own **page
CSS** (published as a fingerprinted file — no inline `<style>`), and
**structured SEO fields** (the `<head>` is generated; author HTML never
reaches it). Styling is stored separately (rules + overrides) and applied at
compose time, so re-pasting a revised page keeps its styling.

The eight long-form pages (`alpr`, `stratos`, `weber-county`,
`privacy-report`, `how-did-this-happen`, `dignity-index-statement`, `theory`,
`privacy`) were migrated into Documents on 2026-09-13
(`scripts/migrate-documents.mjs`, 0 hard differences vs the template render).
The templates stay in the repo for the git/`build.js` path until cutover; on
the database publish path a Document REPLACES the same-slug template.

## Code Map

```
packages/db/content-schema.js     documents, style_rules, style_overrides,
                                  foreign_class_map DDL
packages/db/documents.js          DOCUMENT_FIELDS, row⇄object, list/get/upsert/
                                  delete, rules/overrides/foreign-map CRUD,
                                  loadPublishBundle, markDocumentLive/PublishError
packages/render/documents.js      composeDocument / buildDocuments: ingest →
                                  applyStyles → stripNids → tokens → shell; SEO
                                  block + JSON-LD generation; pageCssKey
templates/documents/report.html   the 'report' shell (developer-owned head/body
                                  wrapper; header/footer partials carry <main>)
templates/partials/coverage-strip.html  rendered by the {{coverage:key}} token
packages/html-ingest              §5 sanitize/nids/partition/a11y (allowlist
                                  widened: docs/decisions/ingest-allowlist-widening.md)
packages/style-apply              applyStyles, explainStyles (element tree rows),
                                  validateSelector, matchCount, orphanedOverrides
packages/style-kit                parseStyleKit(css) → catalog (+ undocumented)
aws/publish/render-db.js          THE database render (collections + Documents)
                                  shared by the Lambda and scripts/publish.mjs
scripts/migrate-documents.mjs     template → Document extraction + parity proof
apps/admin/lib/documents.js       editor data: site sources (live css from the
                                  site bucket, partials/shells from the repo /
                                  site-src), Style Kit, explainStyles rows,
                                  preview srcdoc, ruleMatchCounts
apps/admin/app/documents/         list (by category) + create; [id]/ editor
                                  (metadata, HTML/CSS editors + ingest report,
                                  SEO panel with SERP preview, styling split
                                  view), actions.js (all server actions)
apps/admin/app/styles/            rules with match counts, foreign class map,
                                  Style Kit catalog (+ rule-form.js)
apps/admin/app/revisions/page.js  restore path for entity_type 'document'
```

## Compose (every publish, `packages/render/documents.js`)

```
body_html_raw ─ingest(knownClasses = site css ∪ page css, foreignClassMap,
                     previousNormalized)─▶ normalized (+ a11y gate: img alt,
                     one h1, no heading skips → publish error if violated)
  ─applyStyles(template rules for template_key + page rules for id,
               overrides for id)─▶ styled
  ─stripNids─▶ ─replaceTokens─▶ body
      {{coverage:alpr}} → coverage-strip partial from coverage_entries
      {{video:ID}}      → youtube-nocookie iframe (id validated)
  ─render(shell, { ...settings, page: slug, current, seo_block,
                   jsonld_block, page_css_link, body })─▶ <slug>.html
page_css ─▶ css/pages/<slug>.<sha256[0:8]>.css (linked from the head)
```

SEO fallback chain (§12): document → template default → settings. Empty
title or description is a render ERROR (the save action refuses to publish
without a meta description). JSON-LD: `{@context, @type: jsonld_type,
headline, description, url, publisher}` merged under `jsonld_overrides`.

## Publish integration (`aws/publish/render-db.js`)

`loadSiteFromDb` → `renderSiteFromDb({ inputs, siteCss, content, meta, bundle })`:
`buildDocuments` for every `status='published'` document; `PAGES` minus
same-slug templates; one sitemap (`sitemapExtra`), document lastmod =
`updated_at`. After the run `recordDocumentPublish` writes `live_hash` /
`live_at` or `last_publish_error` per document. Any document error aborts
the whole run (fail-fast, §7) and names the document.

## Admin editor

- **Save** (`saveDocument`): one transaction — baseline (`updated_at`) lost-
  update check, slug uniqueness/reserved check, ingest with the template's
  foreign-class map, refuse `published` when the a11y gate fails or the meta
  description is empty, upsert, revision snapshot (fields + `body_html_raw`
  + resolved overrides), audit. Returns the ingest summary; the page shows
  the full report (removed tags/attributes, foreign classes, a11y, warnings,
  re-paste match, orphaned overrides).
- **Styling split view**: element tree (`explainStyles` rows: paste chips /
  rule chips with the source selector on hover / override chips / unstyled)
  ↔ live preview (`iframe srcdoc` = composed page with nids kept, stylesheets
  inlined, `<base href=PUBLIC_ORIGIN>`; click → selects the row, hover →
  outline). Class picker grouped by Style Kit group, filtered by `applies`
  (show-all toggle), hover shows description + declarations. Bulk: siblings
  with the same tag / every element with the tag. **Promote to template
  rule**: generated `parent > tag` selector, live match count across the
  template's documents, saves a `template` rule.
- **Styles page**: rules (scope, selector, classes, priority, live match
  counts per document, delete), rule form with count preview, foreign class
  map (from → to | drop, per template or global), Style Kit catalog with the
  undocumented count.
- **allow_scripts**: owner-only checkbox, stored; the sanitizer admits no
  script yet (reserved, spec §5 escape hatch).

## Env vars (admin)

`SITE_BUCKET` (live `css/styles.css` for the Style Kit; falls back to the
repo copy with a warning), `PUBLIC_ORIGIN` (preview `<base>`),
`SITE_SRC_ROOT` (where `templates/partials`, `templates/documents`, `css/`
are read; default = monorepo root from `apps/admin`; Amplify copies them to
`apps/admin/site-src`, see amplify.yml). Amplify SSR role additionally needs
`s3:GetObject` on `<site bucket>/css/styles.css`.

## Data

`documents` columns: see content-schema.js. Nothing personal. Revisions for
`entity_type='document'` carry the full raw body (§9) — the 20-per-entity
prune keeps them bounded.

## Error handling / logs

- Actions return `{ error }` inline (lib/actions.js). `[documents]` warn when
  the site bucket CSS is unreadable (fallback used). `[admin] nav categories
  unavailable` if the layout's category query fails (nav degrades, page
  still renders).
- Publish: `[publish] RENDER ERROR: document <slug>: …` in CloudWatch + the
  document's `last_publish_error` shown on the list and editor.

## Status / not yet

Built 2026-09-13: model, compose, migration (staging published from the DB
with the 8 Documents, parity gate OK), editor, styles page, restore, export
(§14.2), **CSP tightened to `style-src 'self'` / `font-src 'self'`** with
self-hosted fonts and `css/colors.css` (see docs/systems/api-security.md),
25 Style Kit annotations. Not yet: `<script src>` escape hatch in the
sanitizer, pagination of the tree for very long pages.
