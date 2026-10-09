# Document builder (blocks) — in progress, 2026-10-08

The Documents editor is being rebuilt around **blocks**: a document is header
fields (eyebrow, headline, summary, byline, contents list) plus sections, each
an h2 with an ordered list of typed blocks (text, quotation, callout, key
figures, image, table, files, …). The editor edits the blocks; on save the
serializer writes the body HTML the ingest already expects into
`body_html_raw`, so compose, publish, styling rules, revisions and archiving
(docs/systems/documents.md) are unchanged. Decision record:
docs/decisions/document-builder-blocks.md.

Status: **model + serializer + parser shipped with tests; site CSS group,
database column, admin UI, upload action, legacy conversion and authoring-kit
markers follow** (see "Status" at the bottom).

## Code Map

```
packages/doc-blocks/schema.js     BLOCK_TYPES registry (label, description, fields,
                                  variants, empty(), sample), HEADER_FIELDS,
                                  SECTION_FIELDS, emptyBody/newBlock/newSection,
                                  slugify (anchors), validateBody, fullWidth
packages/doc-blocks/serialize.js  serialize(body, {title, author}, {authorHref})
                                  → body_html_raw; renderBlock, sampleHtml (picker previews)
packages/doc-blocks/parse.js      parse(html) → { title, author, authorHref, body, report }
                                  markers → site markup → heuristics; unknown → raw block
packages/doc-blocks/test/         serializer, parser, and a round-trip of every tracked
                                  legacy document (docs/migration/documents/*.document.json)
scripts/blocks-roundtrip.mjs      the same round-trip as a report: raw-block counts,
                                  first text/tag difference, --html <dir> dumps blocks + HTML
```

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
- [ ] `css/styles.css` "Document blocks" group (promote the per-page classes: release-meta, paper-toc, scope-box, finding-box, stats-grid, pull-quote, evidence-figure, table-scroll, btn-file, related-cta, sources-*, parts-nav, part-header, ask-item, join-grid, contact-cta, doc-body/doc-inner typography modelled on how-did-this-happen)
- [ ] `documents.body_blocks` column; save path serializes; revisions carry it
- [ ] admin builder UI: header fields, sections, block editors (contenteditable text), block picker with rendered previews, live preview without saving, add bars
- [ ] `parseUpload` server action; New document = upload first
- [ ] convert the legacy documents (page CSS selectors rewritten to the new frame), pixel-compare old vs new
- [ ] authoring kit: the marker vocabulary
