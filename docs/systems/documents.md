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
apps/admin/app/documents/         list (by category) + authoring-kit download
                                  block + create; [id]/ editor (metadata,
                                  HTML/CSS editors + file upload + ingest
                                  report, SEO panel with SERP preview, styling
                                  split view), actions.js (all server actions,
                                  incl. convertUpload)
apps/admin/app/documents/authoring-kit/route.js
                                  GET: the authoring kit as a .md download,
                                  rebuilt per request (any signed-in role)
apps/admin/lib/authoring-kit.js   buildAuthoringKit({ kit, rules, coverageKeys })
                                  → markdown: static voice/HTML/shape sections +
                                  live Style Kit catalog + template rules + tokens
apps/admin/lib/convert-upload.mjs docxToHtml (mammoth), markdownToHtml (marked),
                                  finishHtml (image placeholders, line breaks)
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
  ─stripNids─▶ ─replaceTokens (on the TREE: text nodes only, never attribute
      values or <pre>/<code>; author text around a token is re-escaped)─▶ body
      {{coverage:alpr}} → coverage-strip partial from coverage_entries
                          (href="{{url}}" safeUrl+escaped, validated lang)
      {{video:ID}}      → www.youtube.com/embed iframe (the CSP frame-src host)
  ─render(shell, { ...settings, page: slug, current, seo_block,
                   jsonld_block, page_css_link, body })─▶ <slug>.html
page_css ─▶ css/pages/<slug>.<sha256[0:8]>.css (linked from the head)
```

SEO fallback chain (§12): document → template default → settings. Empty
title or description is a render ERROR (the save action refuses to publish
without a meta description). JSON-LD: `{@context, @type: jsonld_type,
headline, description, url, datePublished (published_at), author, publisher}` merged under `jsonld_overrides`. `author` is a Person built from the document's **Author** field; when the name matches a team member it carries that member's `@id`/`url` (`/team/<slug>#person`) so the piece is listed on their author page — docs/systems/author-pages.md.

## Publish integration (`aws/publish/render-db.js`)

`loadSiteFromDb` → `renderSiteFromDb({ inputs, siteCss, content, meta, bundle })`:
`buildDocuments` for every `status='published'` document; `PAGES` minus
every slug that has a document row of ANY status (a draft must not
resurrect the old inline-styled template — the URL 404s instead); one
sitemap (`sitemapExtra`), document lastmod = `updated_at` (style override
changes bump it too). After a SUCCESSFUL run `recordDocumentPublish` writes
`live_hash` / `live_at`; a failed run records `last_publish_error` on the
failing documents and marks nothing live. Any document error aborts the
whole run (fail-fast, §7) and names the document; the save action
pre-validates tokens, the a11y gate and the meta description so one editor
cannot wedge publishing.

## Admin editor

- **Save** (`saveDocument`): one transaction — baseline (`updated_at`) lost-
  update check, slug uniqueness/reserved check, canonical on-site / og:image
  https / sitemap priority validation, ingest with the template's
  foreign-class map (author `id`s that match site chrome or script hooks are
  stripped), refuse `published` when the a11y gate fails, a token is
  invalid, or the meta description is empty, upsert, revision snapshot
  (fields + `body_html_raw` + resolved overrides), audit. Forms dispatch
  through `ActionForm`'s onSubmit + startTransition so React 19 does not
  reset uncontrolled fields on a rejected save. Returns the ingest summary; the page shows
  the full report (removed tags/attributes, foreign classes, a11y, warnings,
  re-paste match, orphaned overrides).
- **Selectors** run against a synthetic `<main>` root (style-apply
  `rootedTree`), so `main > h1` means the top-level heading exactly as on the
  published page; `/styles` parses each document once for all match counts.
- **Styling split view**: element tree (`explainStyles` rows: paste chips /
  rule chips with the source selector on hover / override chips / unstyled —
  inert tags such as li/td/strong never count) ↔ live preview (`iframe srcdoc`
  with `sandbox="allow-scripts"` only — an OPAQUE origin, never the admin's;
  composed page with nids kept, stylesheets inlined with `</style` neutralised,
  `<base href=PUBLIC_ORIGIN>` — on staging the CloudFront basic-auth gate
  exempts `/css/*`, `/assets/*`, `/media/*` so those subresources load
  without a browser sign-in dialog (`docs/decisions/staging-basic-auth-asset-exemption.md`);
  `/css/fonts.css` is fetched from the origin, the two other stylesheets are
  inlined —, links inert; click → selects the row, hover /
  focus → outline; messages accepted only from that frame). Class toggle:
  a class ON via a rule/paste turns off through a replace-mode override; the
  replace↔append switch is visually neutral. Bulk append merges with each
  target's existing override (max 500 elements). Class picker grouped by Style Kit group, filtered by `applies`
  (show-all toggle), hover shows description + declarations. Bulk: siblings
  with the same tag / every element with the tag. **Promote to template
  rule**: generated `parent > tag` selector, live match count across the
  template's documents, saves a `template` rule.
- **Styles page**: rules (scope, selector, classes, priority, live match
  counts per document, delete), rule form with count preview, foreign class
  map (from → to | drop, per template or global), Style Kit catalog with the
  undocumented count.
- **allow_scripts** (spec §5 escape hatch): owner-only checkbox. When on,
  ingest keeps `<script src="https://<host>/…">` tags whose host is in
  `SCRIPT_SRC_ALLOWLIST` (html-ingest; currently only
  `challenges.cloudflare.com`, a subset of the site CSP's `script-src`) with
  `src`/`async`/`defer` only; inline script content and other hosts are
  always dropped; the ingest report lists every kept script; every toggle
  writes a `document.allow_scripts.on/off` audit row. Adding a host means
  editing BOTH the allowlist and `SITE_CSP`.

## Authoring kit (2026-10-05)

The spec's authoring model is "write outside, paste in" (§1). The kit is the
file that makes an outside tool, Claude in particular, produce something
that lands clean: **GET `/documents/authoring-kit`** (link at the top of the
All documents page) returns `ucc-authoring-kit-<date>.md`, built on every
request by `lib/authoring-kit.js buildAuthoringKit` from

- static text in the module: how to use it (three modes: prose only →
  .docx/.md upload; HTML fragment → paste/upload; convert my draft), the
  instructions-for-Claude block, the voice rules (DOs and the DON'T list of
  machine-writing tells: em/en dashes, triplets, "it's not X it's Y",
  signposting, stock closers, buzzwords, vague attribution, invented
  specificity …), the page-fields block (title/slug/category/author/meta
  description/keywords/social title), the shape of a piece, the HTML rules
  (fragment only, allowed tags from `html-ingest ALLOWED_TAGS` minus
  SVG/chrome/presentational tags, forbidden constructs, a skeleton), and a
  hand-over checklist;
- live data: the Style Kit catalog (`styleKitFor(siteCss)`; annotated
  entries only, chrome groups such as Navigation/Forms/Donations hidden),
  every `scope='template'` style rule ("write this tag, the editor adds this
  class, do not add it yourself"), and the coverage keys that exist
  (`SELECT DISTINCT report_key FROM coverage_entries`) for the
  `{{coverage:KEY}}` token.

Dynamic strings are passed through `dash()` so the file never contains an
em/en dash (the test asserts the whole file is dash-free; the kit must obey
its own rules). Auth: `getSession()` only, any role; 403 when signed out.
No personal data in the file. Logged as `[documents] authoring kit for
<email>: N classes, N template rules, N coverage keys, N chars`.

No AI service is part of the product (spec §1); the kit is a document an
author chooses to give to their own tool.

## Upload a file (.html / .docx / .md) (2026-10-05)

The HTML box's file input accepts `.html/.htm` (read in the browser,
unchanged, as before), `.docx` and `.md/.markdown/.txt`. Non-HTML files go
to the server action **`convertUpload(formData)`** (editor+, called directly
from `html-editor.js`, not via ActionForm; 8 MB cap, matching
`next.config.js serverActions.bodySizeLimit`):

| kind | converter | notes |
|---|---|---|
| .docx (Word, Google Docs, Claude Docs export) | `mammoth.convertToHtml` with a style map adding Title→h1, Subtitle→p, Quote/Intense Quote→blockquote (Heading 1–6 are mammoth defaults) | mammoth's warnings (unmapped styles) are returned and shown |
| .md / .markdown / .txt | `marked.parse` (GFM, no `breaks`) | raw HTML in the markdown passes through |

`finishHtml` then replaces every `<img>` (data: URIs from embedded images,
which the ingest rejects) with a visible numbered placeholder paragraph
("[Image N omitted: upload it on the Media page …]") and adds a newline after
block closers so the textarea is readable. The result is placed in the Body
HTML field with a notice (characters, images omitted, warnings); **nothing is
stored** until the editor saves, which runs the normal ingest, so the
converters are not trusted and need no sanitising of their own. Errors come
back as `{ error }` and are shown in the same notice. Logged as
`[documents] convert <kind> "<name>" <bytes>B -> <chars> chars, <n> images
omitted[, warnings: …]`.

Dependencies (apps/admin): `mammoth` ^1.9, `marked` ^15. Tests:
`test/convert-upload.test.mjs`, `test/authoring-kit.test.mjs`.

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
