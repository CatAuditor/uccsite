# ADR: Widening the Document ingest allowlist for the migrated reports

**Date:** 2026-09-13 · **Status:** accepted · Spec: §5.3 ("do not widen without an ADR")

## Decision

`packages/html-ingest` admits, beyond the spec's list:

| Addition | Why | Safety |
|---|---|---|
| `cite abbr q kbd var dfn address ins del wbr` | The six reports use `<cite>` 9–18 times each; the rest are the same class of inert text-level semantics. | No URL, no script, no style capability. |
| `<a target rel download>` | Every external link on the reports opens in a new tab; the ALPR page offers dataset downloads. | `target` is restricted to `_blank` and `rel` is forced to include `noopener` (`transformAnchor`); `download` is a boolean/filename. |
| `<details open>` | Stratos/Weber pages ship expanded sections. | Boolean. |
| `svg g path polyline polygon line circle rect` with `viewbox xmlns preserveaspectratio` + paint/geometry attributes (`fill stroke stroke-* d points x1..y2 cx cy r x y rx ry opacity fill-rule clip-rule transform focusable`) | Stratos has three decorative inline icons; stripping them leaves empty buttons. | No `href`/`xlink:href`, no `<use>`, `<foreignObject>`, `<animate>`, `<script>`, `<style>`, no `on*`, no `style`. Shape data only. |
| Serializer `encodeEntities: 'utf8'` | The default numeric-encoded every non-ASCII character (em dashes, curly quotes), bloating pages and making the migration comparison fail on bytes. | Markup-significant characters are still entity-encoded; sanitization happens before serialization. |

## Alternatives

- Keep the spec list and strip these on migration: loses new-tab links, the
  downloads, and the icons on pages that are live today — a visible
  regression on cutover for no security gain.
- Allow `style` attributes: rejected (spec §20, CSP tightening depends on it).

## What breaks if reversed

Reverting the list makes the eight migrated Documents lose `<cite>` text
wrappers (text survives), external-link targets, downloads, expanded
`<details>` and the Stratos icons on the next publish, and the migration
comparison in `scripts/migrate-documents.mjs` reports the differences.
