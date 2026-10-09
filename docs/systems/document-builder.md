# Document builder (blocks) — in progress, 2026-10-08

The Documents editor is being rebuilt around **blocks**: a document is header
fields (eyebrow, headline, summary, byline, contents list) plus sections, each
an h2 with an ordered list of typed blocks (text, quotation, callout, key
figures, image, table, files, …). The editor edits the blocks; on save the
serializer writes the body HTML the ingest already expects into
`body_html_raw`, so compose, publish, styling rules, revisions and archiving
(docs/systems/documents.md) are unchanged. Decision record:
docs/decisions/document-builder-blocks.md.

Status: **model, site CSS, database column, admin builder, upload-first and
convert-to-blocks shipped; legacy conversion with pixel comparison and the
authoring-kit markers follow** (see "Status" at the bottom).

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
  header: { layout: 'hero'|'none', eyebrow, headline (blank = title), summary (html),
            ctas: [{ label, href, kind: 'primary'|'secondary', icon: ''|'download' }],
            provenance (inline), badge, status, date, authorTitle,
            metaLinkLabel, metaLinkHref, note (inline), toc: 'auto'|'none' },
  sections: [{ id, heading, anchor, tocLabel, eyebrow, dek, band, classes[], blocks: [
    { id, type, variant?, classes?: [], ...fields } ] }] }
```

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

A section with `band: true` (or with `classes`) closes the band and opens a
new `div.doc-body[.classes]`; a full-width block (`fullWidth()`: partsnav,
stats band) is written between bands. Multi-part pieces (stratos) need this.

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

## Legacy conversion check

`node scripts/blocks-roundtrip.mjs [slug…] [--html <dir>]` parses each
tracked document, serializes it back, runs both through the ingest and
compares text and tag sequence. State on 2026-10-08: all eight documents
**text-identical**; raw blocks 0 everywhere except the Dignity Index statement
(letterhead: masthead, date line, the-ask, footer kept verbatim). Tag
sequences differ only by the block wrapper divs. Pixel comparison (headless
Chrome) comes with the conversion script. The same check runs as a test in
`packages/doc-blocks/test/blocks.test.mjs`.

## Status / not yet

- [x] model, serializer, parser, tests, round-trip report
- [x] `css/styles.css` "Document blocks" group: the one canonical copy of every class the serializer writes (54 annotated entries; the inner pieces are group "Document block parts", hidden from the authoring kit like chrome). Where the legacy pages disagreed, how-did-this-happen wins: `finding-box` is the navy box; the grey red-bar box is `violation-box` (stratos's name), and alpr/weber-county's `finding-box` must be converted as `violation-box`. `details`/`summary` are scoped under `.doc-accordion`, `blockquote` under `.doc-inner`, so the group styles nothing outside a builder document. `.doc-inner h2` has `scroll-margin-top` so contents-list jumps clear the fixed nav.
- [x] `documents.body_blocks` column (applied to staging 2026-10-08; prod with the next migrate-schema); save path serializes; revisions carry it
- [x] admin builder UI: header fields, sections, block editors (contenteditable text), block picker with rendered previews, live preview without saving, add bars
- [x] `parseUpload` server action; New document = upload first; Convert to blocks on legacy documents
- [ ] convert the legacy documents (page CSS selectors rewritten to the new frame), pixel-compare old vs new
- [ ] authoring kit: the marker vocabulary
