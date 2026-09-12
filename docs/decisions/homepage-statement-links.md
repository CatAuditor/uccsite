# Homepage statement card links: derived, with optional per-entry override

**Date:** 2026-09-12 · **Status:** Accepted ·
**Supersedes:** `homepage-statement-card-links.md` (2026-09-09) and the link
portion of `homepage-statement-derived.md` (2026-08-23), which contradicted
each other and together produced a live defect.

## The defect this resolves

The Sept 9 decision had `templates/index.html` render `href="{{url}}"` and
`{{more}}` from a hand-authored `homepage.json` statements array. The Aug 23
decision deleted that array and derived the card from `statements.json` — but
its derivation passed only `{slug, date, title, snippet}`. Result: the card
shipped with `href="#"` and an empty read-more line on every build.

## Decision

Both earlier intents survive:

- The card stays **derived** from the newest `statements.json` entry (Aug 23
  intent — no second copy to maintain).
- `deriveHomepage()` in `packages/render/site.js` now supplies `url` and
  `more`, honoring **optional per-entry overrides** in `statements.json`
  (Sept 9 intent — a card can point anywhere, e.g. a standalone page like
  `dignity-index-statement.html`):
  - `url`: the entry's `url` field, else `/statements.html#<slug>`
  - `more`: the entry's `more` field, else `Read the full statement →`

Both fields are declared in the CMS (`static/admin/config.yml`, optional) so
Decap does not strip them on save.

## What breaks if reversed

Removing the `url`/`more` mapping from `deriveHomepage()` silently reintroduces
the dead-link card — no build error fires, because unknown `{{var}}`s render
empty. The golden-file suite (`packages/render/test/`) pins the fixed output.
