# Shared header/footer partials in build.js

**Status (2026-09-13):** still in force — `packages/render` renders the same partials; Documents compose into them via `templates/documents/report.html`.

**Date:** 2026-08-23

## Decision
`build.js` supports `{{> name}}` includes from `templates/partials/`. The header (with skip link and the opening `<main id="main">`) and footer (closing `</main>`) are partials used by every page except `success.html`.

## Why
Nav/footer were copy-pasted into 14 files and had already drifted (ARIA attributes on 1/14, `<main>` on 1/14, logo on different sides, different labels for the same page). The docs acknowledged the burden.

## Alternatives
- A real template library (Handlebars/Eleventy): more power, but a dependency for a 250-line build. Rejected: keep zero-dep build.
- Leave as-is and lint for drift: still 14 edits per nav change. Rejected.

## Consequences
- Per-page state is passed via data: `is_home`, `current.<page>`.
- The engine is now single-pass (values are never re-scanned) and supports `{{^key}}`.
- `templates/success.html` is deliberately excluded (Stripe return page, no nav).

## What breaks if reversed
Inlining the header again re-creates the drift; anything that relies on `current.*` or `is_home` in a partial must be duplicated per page.
