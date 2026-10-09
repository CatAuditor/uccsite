# Document builder (blocks) — in progress, 2026-10-08

The Documents editor is being rebuilt around **blocks**: a document is header
fields (eyebrow, headline, summary, byline, contents list) plus sections, each
an h2 with an ordered list of typed blocks (text, quotation, callout, key
figures, image, table, files, …). The editor edits the blocks; on save the
serializer writes the body HTML the ingest already expects into
`body_html_raw`, so compose, publish, styling rules, revisions and archiving
(docs/systems/documents.md) are unchanged. Decision record:
docs/decisions/document-builder-blocks.md.

Status: **shipped on staging 2026-10-08**: model, site CSS group, database
column, admin builder, upload-first, convert-to-blocks, the eight legacy
documents converted (pixel-identical), authoring-kit markers. Production
needs the column and the conversion run (docs/for-conner.md §13).

## Code Map

```
packages/doc-blocks/              ES module (the admin's client bundle imports schema.js)
  schema.js                       BLOCK_TYPES registry (label, description, fields,
                                  variants, empty(), sample), HEADER_FIELDS,
                                  SECTION_FIELDS, emptyBody/newBlock/newSection,
                                  slugify (anchors), validateBody, fullWidth
  serialize.js                    serialize(body, {title, author}, {authorHref})
                                  → body_html_raw; renderBlock, sampleHtml (picker previews)
  parse.js                        parse(html, {classAliases}) → { title, author, authorHref,
                                  body, report }: markers → site markup → heuristics;
                                  unknown → raw block
  convert.js                      rewritePageCss (legacy wrapper selectors → .doc-body/
                                  .doc-inner), aliasClasses
  test/                           serializer, parser, and a round-trip of every tracked
                                  legacy document (docs/migration/documents/*.document.json)
scripts/blocks-roundtrip.mjs      the same round-trip as a report: raw-block counts,
                                  first text/tag difference, --html <dir> dumps blocks + HTML
packages/db/content-schema.js     ALTER documents ADD body_blocks TEXT (JSON; NULL = legacy)
packages/db/documents.js          body_blocks in DOCUMENT_FIELDS / JSON_COLS (so revisions,
                                  exports and restores carry it)
css/styles.css                    "Document blocks" group (+ "Document block parts")
apps/admin/lib/documents.js       blocksToRaw (validate + serialize, the save path),
                                  authorHrefFor (/team/<slug> for the byline link),
                                  previewBlocksFor (live preview: serialize → ingest →
                                  rules/overrides → compose), previewSrcdoc (shared with the
                                  Styling tab), blockGallery (picker srcdoc), editorData adds
                                  gallery / coverageKeys / publishedFiles
apps/admin/lib/convert-upload.mjs uploadToHtml(file) (images kept), finishHtml({keepImages})
apps/admin/app/documents/actions.js
                                  saveDocument reads `bodyBlocks` JSON → body_html_raw;
                                  createDocument accepts a file (upload-first); parseUpload
                                  (builder "Start from a file"); previewBlocks; convertToBlocks
apps/admin/app/documents/[id]/builder.js      the builder (client): header groups, sections,
                                  block cards, add bars, picker, live preview, report
apps/admin/app/documents/[id]/field-editors.js Field/Fields by kind (text, inline, html, code,
                                  bool, select, coverage, file, image, cells, rows, list)
apps/admin/app/documents/[id]/rich-text.js    contenteditable editor + cleanHtml
apps/admin/app/documents/[id]/block-picker.js the "Add a block" dialog (types + gallery iframe)
apps/admin/app/documents/[id]/page.js         Builder when doc.bodyBlocks, else HtmlEditor +
                                  "Convert to blocks"
apps/admin/app/documents/page.js  New document form: optional file, title/slug from the file
apps/admin/next.config.js         transpilePackages: ['@uccsite/doc-blocks']
apps/admin/app/globals.css        .builder*, .bsection, .bcard, .bf*, .rt*, .picker-*
```

## Editor (admin, `[id]/builder.js`)

Mounted inside the document form instead of the HTML box when the row has
`body_blocks`. State is the body JSON; a hidden `bodyBlocks` input carries it
to `saveDocument`, which validates (`validateBody`), serializes with the
form's title/author (byline link via `authorHrefFor`) and stores both
`body_blocks` and the generated `body_html_raw`; the rest of the save (ingest,
a11y gate, tokens, revision, audit) is unchanged.

- **Page header**: three groups (Hero: top-of-page layout, eyebrow, headline,
  summary, hero buttons with icon, hero note; Byline: badge, status, date,
  author title, byline link, note; Contents). The form's Title/Author inputs
  are the h1 and the byline name; the builder listens to them for the preview.
- **Sections**: heading input, "Section options" (anchor, contents label,
  eyebrow, standfirst, new band, extra band classes), move/remove, and an
  **add bar** before the first block and after every block (thin dashed
  line with one small button) plus "Add a section here" between sections.
- **Block card**: type label, variant select (the curated look), Style
  (chips of Utilities + Document blocks classes → `block.classes`), move,
  remove, then the type's fields. Field kinds: text/url inputs; `inline` and
  `html` use the rich-text editor; `image` has the Media library inline
  upload (alt first); `file` offers the published Files; `coverage` the
  known keys; `list` repeats a field group; `cells`/`rows` edit a table.
- **Picker** (`block-picker.js`): dialog, types left, gallery iframe right
  (`blockGallery`: every sampled type rendered with the live site CSS in the
  document frame, `sandbox="allow-scripts"`, opaque origin). Hover a type →
  the gallery scrolls to it; click either → block inserted at the add bar.
- **Live preview**: `previewBlocks` 600 ms after the last change (nothing
  stored): the same composed page the Styling tab shows, with
  `data-block`/`data-section` kept. Click a piece → its card is selected and
  scrolled to; hover a card → outline in the preview; scroll position
  survives re-renders (the frame posts `scroll`, the builder posts
  `scrollTo` on load). The ingest report of the preview (a11y, foreign
  classes, warnings) shows under the frame as it would block publishing.
- **Start from a file**: `parseUpload` → confirm → body replaced, title/author
  filled if blank; the note lists sections/blocks/raw/images pending.
- **Advanced: page CSS** stays available (collapsed).
- Viewer role: everything disabled, no add bars.

Rich text (`rich-text.js`): contenteditable with Bold/Italic/Link (Ctrl+K)
and, for `html` fields, paragraph/H3/H4/lists. `cleanHtml` keeps
strong/em/a/br/code/sub/sup and p/h3/h4/ul/ol/li/blockquote/hr, renames
b/i/div/h1/h2, unwraps spans, drops style/class, forces `rel="noopener"` on
external links. Paste is plain text. The ingest sanitises again on save.

## Upload-first and conversion

- **New document** (`/documents`): the form takes an optional file; title
  and slug may be left blank (taken from the file's h1 / slugified title).
  `createDocument` → `parseUploadFile` → `blocksToRaw` → row with
  `body_blocks` + generated HTML → redirect to the builder. Every new
  document is a builder document (empty blocks when no file).
- `parseUploadFile`: `uploadToHtml` (docx via mammoth with images kept, md via
  marked, html as-is; 8 MB cap) → `parse()`; a figure whose `src` is a
  `data:` URL becomes an Image block with empty src, `pending: true` and a
  numbered caption, so the editor uploads it through the Media library.
- **Convert to blocks** (legacy document, editor+): `parse(bodyHtmlRaw)`,
  `headline` set when the h1 differs from the title, page CSS through
  `rewritePageCss`, body regenerated from the blocks, ingest re-run, one
  transaction with the pre-conversion snapshot (`document.convert_blocks`
  audit) so Revisions can undo it. The migration script (next step) does the
  same per slug with class aliases and a pixel comparison.

Logs: `[documents] upload-first "<file>" …`, `[documents] parse upload …`,
`[documents] convert to blocks <id>: …` (counts only, never content).

## Model (`body_blocks`, JSON)

```
{ v: 1,
  header: { layout: 'hero'|'none', eyebrow, eyebrowTag?: 'p', headline (blank = title),
            summary (html), ctas: [{ label, href, kind: 'primary'|'secondary', icon: ''|'download' }],
            ctasBare?: true, provenance (inline), badge, status, date, authorTitle,
            metaLinkLabel, metaLinkHref, note (inline), toc: 'auto'|'none',
            frame: [] (blank = ['doc-body', 'doc-inner']) },
  sections: [{ id, heading, anchor, tocLabel, eyebrow, dek, band, bandClasses[], classes[],
               blocks: [ { id, type, variant?, classes?: [], legacyClass?, ...fields } ] }] }
```

The `?` fields exist for converted legacy pages only (see "Legacy conversion"):
they let the serializer write exactly the markup the page's own CSS expects.

The document's `title` and `author` columns stay the source for the h1 (unless
`headline` is set: legacy pages whose h1 is not the SEO title) and the byline
name (linked to `/team/<slug>` when the author is a team member; the caller
resolves `authorHref`). `layout: 'none'` is for letterhead-style pages that
draw their own top (the Dignity Index statement).

### Block types (schema.js `BLOCK_TYPES`)

| type | variants | markup it writes |
|---|---|---|
| prose | | `div[data-block] > p/h3/h4/ul/ol…` (rich text) |
| quote | | `blockquote > span.quote-source + p… + cite` |
| pullquote | | `div.pull-quote > p + cite` |
| callout | callout, callout-dark, scope-box, finding-box, violation-box, update-note, draft-def | `div.<variant> > label + p…` (label element per variant) |
| stats | cards, band | `div.stats-grid > div.stat-card…` or `section.impact > impact-grid` (full width) |
| figure | | `figure.evidence-figure > img + figcaption` |
| table | doc-table, own-table, rank-table, timeline-table | wrapper div + `table.<variant>` (rank-table in `.table-scroll`) |
| files | | `div.table-downloads > a.btn-file…` |
| cta | related-cta, download-cta, contact-cta | `div.<variant> > h3 + p + a.btn-file / btn-download / btn-contact` |
| sources | list, grid | `div.sources-list` or `div.sources-grid > div.source-item` |
| accordion | | `div.doc-accordion > details > summary + div.section-body` |
| partsnav | | `div.parts-nav > a.part-card…` (full width) |
| asks | | `div.ask-list > div.ask-item > h3 + p` |
| cards | | `div.join-grid > div.join-card > strong + p` |
| byline | | the release-meta strip at this position instead of under the hero |
| video / coverage | | `<p>{{video:ID}}</p>` / `<p>{{coverage:key}}</p>` (existing tokens) |
| raw | | the HTML verbatim inside `div[data-block]` |

Every block root carries `data-block="<id>"` (sections `data-section`), kept by
the ingest, so the live preview can point back at the block being edited.

### Frame the serializer writes

```
div.subpage-hero > div.section-label, h1, p (summary), div.hero-ctas > a.hero-download|hero-secondary, p.hero-provenance
div.doc-body > div.doc-inner            ← one white "band"; the reading column
  div.release-meta > release-badge, release-badge-status, release-date, release-author, a.download-inline
  p.paper-provenance
  nav.paper-toc > paper-toc-label + ol > li > a#anchor   (toc: 'auto', ≥2 headings)
  h2#anchor … blocks …                   (or div.part-header > eyebrow + h2 + p when eyebrow/dek set)
```

A section with `band: true` closes the band and opens a new one carrying
`bandClasses`; `classes` wraps the section in a div inside the column; a
full-width block (`fullWidth()`: partsnav, stats band) is written between
bands. Multi-part pieces (stratos) need this. **Text blocks write their
children bare**, each tagged `data-block`, so `:first-of-type` and
`:last-child` rules behave as on a hand-written page; the contents box is a
`div` (the ingest allowlist has no `nav`).

## Parsing (`parse.js`)

One pass over the fragment's flow (legacy wrappers paper-body/paper-inner,
briefing-*, report-*, theory-*, privacy-body, container, and the migration's
scoped `.s-xxxxxx` classes are unwrapped; a `*-body` wrapper starts a band,
a scoped class rides on the section):

1. **Markers** (what the authoring kit will teach a writing tool):
   `<!-- ucc:header eyebrow="…" date="…" author="…" author-title="…" -->`,
   `<!-- ucc:section eyebrow="…" dek="…" -->` before an h2, and
   `<!-- ucc:TYPE key="v" … --> … <!-- /ucc -->` around one block's content
   (stats accept `<li>number — description</li>`, accordion `h3 + content`).
2. **Site markup**: `div.subpage-hero` (eyebrow, h1, lead paragraphs, buttons,
   provenance), `.release-meta` (badge, status, date, "By Name, Title",
   download-inline), `p.paper-provenance`, `.paper-toc` (becomes `toc: 'auto'`
   when its links are the h2 anchors in order; shorter link text becomes the
   section's `tocLabel`; otherwise kept as a raw block), `h2` / `.part-header`
   start sections, and every class in the table above. Aliases: acknowledgment
   → scope-box, report-callout → callout, theory-stat → finding-box.
3. **Heuristics** (plain .docx/.md conversions): short line above the h1 =
   eyebrow, h1 = title, first paragraph = summary, "By Name, Title" = author,
   a date line = date; runs of p/h3/h4/ul/ol/hr/pre = one Text block;
   blockquote = quotation; simple table (no spans, equal rows) = table.

Anything else is a **raw** block, counted in `report.raw` with a note. A
legacy page with no `.release-meta` gets `badge: ''` (it printed none); a
plain upload gets the default badge and an automatic contents list.

## Legacy conversion

A converted page must look exactly as before, so the parser records what the
page's own CSS depends on and the serializer writes it back:

- **frame**: the wrapper chain around the column (`['paper-body',
  'paper-inner']`, `['report-body', 'container']`, `['page']` …) instead of
  `doc-body > doc-inner`; a `*-body` wrapper starts a band, a `.s-xxxxxx`
  scoped class rides on the band, a `*-section` wrapper on the section;
- **legacyClass** on a box or table whose class is the page's own
  (`report-callout`, `theory-stat`, `acknowledgment`, `defs-table` +
  `defs-table-wrap`): read as the nearest variant, written back unchanged (the
  editor shows "This page's own style"; picking a variant drops it);
- `eyebrowTag: 'p'`, `ctasBare`, a bare table (`bare`), icons on buttons,
  `&nbsp;` kept in text.

Page CSS is left as it is; the only rewrite is a class alias where a legacy
name means something else site-wide (alpr and weber-county's grey
`finding-box` is the site's `violation-box`; `rewritePageCss` +
`parse({ classAliases })`, per slug in the script).

**Proof**: `node scripts/convert-documents-to-blocks.mjs --env <env>
[--only slugs] [--apply] [--no-shots]` (needs Chrome; `puppeteer-core`,
`pixelmatch`, `pngjs` are dev dependencies). For each document without
blocks: parse → serialize; text must be identical; OLD (legacy HTML + page
CSS + the site CSS from commit 68dc73c, before the Document blocks group)
and NEW (blocks + current site CSS) are composed with the real shell,
screenshotted full-page at 1280px with every `<details>` open and
pixel-diffed. Output under `.tmp/blocks-conversion/<slug>/` (old/new
HTML + PNG, diff.png, blocks.json). `--apply` writes `body_blocks`,
`body_html_raw`, `page_css` with a revision snapshot and a
`document.convert_blocks` audit row (actor `scripts/convert-documents-to-blocks`).
Result 2026-10-08 (docs/migration/blocks-conversion.md): **all eight
documents 0.000% differing pixels, identical page heights, raw blocks 0**
except the Dignity Index statement (letterhead: masthead, date line, article,
footer kept as Custom HTML). Applied on staging the same day.

`node scripts/blocks-roundtrip.mjs` is the quick text/tag check without a
database or browser; the same round-trip runs as a test in
`packages/doc-blocks/test/blocks.test.mjs`.

## Authoring kit markers

`apps/admin/lib/authoring-kit.js` section 5 "Builder markers" documents the
`<!-- ucc:… -->` vocabulary (header, section, callout, quote, pullquote,
stats, figure, table, files, cta, sources, accordion, video, coverage) with a
Markdown example; `apps/admin/test/upload-blocks.test.mjs` runs that example
through `markdownToHtml` + `parse` and asserts the blocks. Section 1 now
describes the three routes as upload → builder; section 4 says how a plain
draft marks eyebrow, byline and date; the "classes copied from a live page"
warning (and `html-editor.js LIVE_PAGE_CLASSES`) now names only the private
wrappers, since the shared pieces are site classes.

## Status / not yet

- [x] model, serializer, parser, tests, round-trip report
- [x] `css/styles.css` "Document blocks" group: the one canonical copy of every class the serializer writes (54 annotated entries; the inner pieces are group "Document block parts", hidden from the authoring kit like chrome). Where the legacy pages disagreed, how-did-this-happen wins: `finding-box` is the navy box; the grey red-bar box is `violation-box` (stratos's name), and alpr/weber-county's `finding-box` must be converted as `violation-box`. `details`/`summary` are scoped under `.doc-accordion`, `blockquote` under `.doc-inner`, so the group styles nothing outside a builder document. `.doc-inner h2` has `scroll-margin-top` so contents-list jumps clear the fixed nav.
- [x] `documents.body_blocks` column (applied to staging 2026-10-08; prod with the next migrate-schema); save path serializes; revisions carry it
- [x] admin builder UI: header fields, sections, block editors (contenteditable text), block picker with rendered previews, live preview without saving, add bars
- [x] `parseUpload` server action; New document = upload first; Convert to blocks on legacy documents
- [x] convert the legacy documents, pixel-compare old vs new (0.000% on all eight; applied on staging 2026-10-08)
- [x] authoring kit: the marker vocabulary (+ test of the kit's example)
- [ ] production: `migrate-schema --env prod`, then `convert-documents-to-blocks --env prod` (check, then `--apply`), then a publish (docs/for-conner.md §13)
- [ ] later: a converted page can be moved onto the standard frame (clear Page frame + page CSS, pick variants) when its look should follow the site
