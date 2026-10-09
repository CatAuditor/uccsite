# Press unification: one table, every placement derived

**Status (2026-10-09):** adopted and applied (staging, then prod). System doc docs/systems/press.md.

## Decision

Every story about the organisation is ONE row in `press`. Where it appears is
derived at render time (`packages/render/press.js derivePress`):

| placement | rule |
|---|---|
| project hub "In the Press" / "On Television" | `project_slug` = that project |
| `{{coverage:<slug>}}` strip inside a report | articles with that `project_slug` |
| News & Media (`/blog`) | every row unless `hide_from_news` |
| homepage "Recent Coverage" | rows ticked `featured`, the first three in list order |

The six tables that used to hold copies — `project_articles`, `project_videos`,
`coverage_entries`, `blog_articles`, `blog_videos`, `homepage_press` — were
emptied by `scripts/migrate-press.mjs` (their DDL stays until a later cleanup;
a snapshot of what they held is in `revisions` as `press-legacy/collection`).
The content export's `blog.json`, `coverage.json` and `homepage.press` are
replaced by `press.json` (export schema 3); `saveContent` still accepts a
schema ≤ 2 export by unifying the legacy files the same way.

## Why

The same KSL story was pasted up to four times, four editors drifted in
outlet names and badge colours, and a new project got no coverage strip until
a developer added a key. One list, one "Add from link", one place to fix a
typo, a per-project coverage strip for free.

## Alternatives considered

- **Keep the tables, add "copy to…" buttons.** Rejected: still four copies to
  keep in step; the drift problem is the copies, not the typing.
- **Auto-pick the homepage cards (newest three).** Rejected: the homepage
  strip is curated; a `featured` tick keeps that control. Capped at three so
  the layout cannot overflow.
- **Store the placements as separate link tables.** Rejected: three flags
  cover every current placement; a many-to-many model can come when a story
  genuinely belongs to two projects (today such a row is reported and kept
  under the first project).

## What breaks if reversed

- Re-adding rows to the legacy tables does nothing: nothing reads them.
- Removing `derivePress` from the front of `buildSite` makes `blog.html`,
  `alpr.html`/`stratos.html` (git path) and the homepage cards fail their
  content checks or render empty, and `{{coverage:…}}` tokens error on publish.
- Renaming a project slug without the save's cascade (projects.md) orphans
  its press (`press.project_slug` is in `PROJECT_SLUG_REFS`).
