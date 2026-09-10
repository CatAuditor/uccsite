# Homepage statement cards link anywhere

**Date:** September 9, 2026

## Decision

The homepage Statements loop in `templates/index.html` renders `href="{{url}}"` and `{{more}}` instead of the hardcoded `/statements.html#{{slug}}` and "Read the full statement →". Every entry in `homepage.json`'s `statements` array now carries both fields.

## Why

The September 2026 policy paper "If Weber County Followed the Law, How Did This Happen?" needed to appear under Statements on the homepage, but it lives on its own page (`/how-did-this-happen.html`) rather than as an entry in `statements.json`. It is a long-form paper with its own byline, statutory citations, and appendices — not a short org statement in the Clark Dice voice that `statements.json` holds.

## Alternatives considered

- **Add it to `statements.json`.** Rejected: it would render the whole paper inline on `/statements.html`, break the author convention documented in [byline-attribution.md](byline-attribution.md), and duplicate content that already has a page.
- **Add a conditional to the template engine.** Rejected: `build.js` deliberately supports only `{{var}}`, `{{{var}}}`, and `{{#list}}`. Making both fields required on every entry costs two JSON lines per card and keeps the engine as-is.

## Consequence

`url` and `more` are required, not optional — a missing field renders as an empty string, not a fallback.
