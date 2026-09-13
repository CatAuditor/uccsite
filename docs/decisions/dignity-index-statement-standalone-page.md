# Dignity Index statement is its own page, not a statements.json entry

**Status (2026-09-13):** the page is now a Document (Reports category) with its own page CSS and self-hosted Newsreader / IBM Plex Sans fonts.

**Date:** September 11, 2026

## Decision

"Twenty-Five Years Later, the Compact Still Holds" is a standalone template (`templates/dignity-index-statement.html`, passthrough, `content: ['settings']`) rather than an entry in `content/statements.json`. It keeps the bespoke design (Newsreader/IBM Plex type, ink/paper/brick/gold palette, the "Our ask, concretely" callout) it was authored with, wrapped in the site's standard nav header and footer for navigability. It's linked from the homepage `statements` card list via `url`/`more` (see [homepage-statement-card-links.md](homepage-statement-card-links.md)), not from `/statements.html`.

## Why

The file arrived as a complete, uniquely designed page (uploaded directly to `content/` via GitHub, unwired). Folding its text into `statements.json`'s plain-paragraph card format would have discarded that design to fit the generic statement-card look — the same tradeoff already rejected for the ALPR policy paper in `how-did-this-happen.html`.

## Consequence

A third bespoke standalone statement/paper page (alongside `how-did-this-happen.html`) exists outside `statements.json`. Each one needs its own homepage card entry and sitemap row; there's still no shared partial for the nav/footer, so future nav changes require editing this file too (see "Nav pattern" above).
