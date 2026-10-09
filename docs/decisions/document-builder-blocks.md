# Document builder: blocks edit, HTML publishes

**Status (2026-10-08):** adopted. Package `packages/doc-blocks`; admin UI and legacy conversion follow (docs/systems/document-builder.md).

## Decision

A document is edited as **header fields + sections of typed blocks** (JSON in `documents.body_blocks`). On save the serializer turns that JSON into the body fragment and writes it to `body_html_raw`, exactly as if an author had pasted it. Everything downstream is untouched: ingest, style rules and overrides, compose, publish, revisions, archiving, author pages.

## Alternatives considered

1. **Keep the raw HTML editor and improve the upload converter.** Rejected: the upload was already "supposed to be easy" and was not. Editors need to see what they are building and change a block's look without reading HTML. Converting better still leaves a textarea as the review surface.
2. **Blocks as the publish model** (render blocks straight to the page, drop `body_html_raw`). Rejected: it rewrites the compose and publish path, the ingest's a11y gate, the Styling tab's per-element overrides, revisions and the migration parity proof, all at once. Generating `body_html_raw` keeps those as they are, and a document with no `body_blocks` keeps working.
3. **A third-party block editor.** Rejected: the site has its own component vocabulary (the "Document blocks" group in `css/styles.css`); a generic editor would emit its own markup and the ingest would strip it.

## Why the HTML is generated from blocks and not the other way round

`body_html_raw` is "exactly what was pasted and never mutated". With blocks, the paste is the serializer's output; the invariant still holds. The parser (`parse.js`) is the one-way door for uploads and legacy conversion, and anything it cannot name becomes a `raw` block (kept verbatim), so nothing is lost on the way in.

## What breaks if reversed

- Removing `body_blocks` orphans the builder: the editor falls back to the raw HTML box for every document (that path still exists).
- Changing a block's markup in `serialize.js` without the matching `parse.js` change breaks the round-trip and the legacy parity tests (`packages/doc-blocks/test`).
- Renaming a canonical class (release-meta, paper-toc, scope-box, …) without updating `css/styles.css` and the converted documents' page CSS unstyles every builder document at once.
