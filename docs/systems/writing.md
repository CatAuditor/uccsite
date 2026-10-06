# Writing page (`/writing`)

Built 2026-10-07. One list of everything Utah Civic Compact has published —
statements, reports, papers — newest first, with type filters. Nothing is
stored for it: it is derived at render time, so a newly published Document or
Statement appears with no extra step.

## Code Map

```
packages/render/writing.js        deriveWriting(content, authorUrl) → { items, count, types }
packages/render/site.js           PAGES entry writing.html (content ['settings','writing'],
                                  priority 0.8); buildSite derives content.writing =
                                  { writing: deriveWriting(...) } after deriveTeam
aws/publish/render-db.js          documents_index gains `summary` (= metaDescription)
templates/writing.html            list + filter buttons (hidden without JS)
js/writing.js                     filters; /writing#reports (#statements, #papers) preselects
css/pages/writing.css             same card and type scale as /statements
packages/render/navigation.js     DEFAULT_NAVIGATION: header "Writing" dropdown (All writing ·
                                  Statements · Reports · Newsletters) + footer Organization link
packages/render/test/writing.test.mjs  4 tests
```

## What is listed

- **Published Documents** from `documents_index`, except category **Legal**
  (the privacy policy). Type comes from the document's **Category**: Reports →
  Report, Whitepapers → Paper, Statements → Statement, Newsletters →
  Newsletter, anything else → Report. Editors change a document's type by
  changing its Category.
- **Statements** (the Statements collection). A statement whose `url` points
  at a Document is merged into that document's entry (one line, the document's
  title; the statement supplies the date and summary when the document has
  none). Others link to `/statements#<slug>`.
- **Date**: document `publishedAt`, else JSON-LD `datePublished` override, else
  the matching statement's date. Undated items sort last (alphabetical).
- **Summary**: document meta description, else statement snippet.
- **Author** links to the team page when the name matches a member.

URLs are clean (`/alpr`, not `/alpr.html`).

## Not listed (deliberate)

News & Media (press *about* UCC) and the newsletter archive — linked at the
bottom of the page and in the Writing menu instead.

## Tests / verification

`writing.test.mjs`: ordering, Legal excluded, statement→document merge, types,
author links, empty state. Rendered from the production database 2026-10-07:
8 items (6 reports, 1 statement, 1 paper), filters with counts, no unresolved
template tags.

The golden test only checks that `writing.html` exists (it is listed in
`expected-diffs.json`, as are the other site pages).
