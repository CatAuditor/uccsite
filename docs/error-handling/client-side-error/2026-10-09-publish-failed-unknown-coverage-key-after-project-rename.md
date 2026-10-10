# 2026-10-09 — Publish failed: unknown coverage key after project rename

## Error

Two admin-approved prod publishes (publish_runs `fef46dc4…` 01:04 UTC and
`fb55e54e…` 01:16 UTC, trigger `approve:<request>:jarom.gillins@…`) recorded
`status = failed`:

```
render failed: 1 error(s): document projects/data-centers/report: unknown coverage key "stratos"
```

Thrown by `packages/render/documents.js` `replaceTokens` — the `{{coverage:KEY}}`
token looks up `content.coverage['<KEY>_coverage']`, and `derivePress`
(`packages/render/press.js`) builds those keys from the CURRENT project slugs
(+ press `project_slug`s). Nothing wrote to S3 (render is fail-fast, before
the first PUT).

## Route / component

Publish Lambda (`aws/publish/handler.mjs`) → `renderSiteFromDb` →
`buildDocuments`. Same failure path from `scripts/publish.mjs --source db`.

## Reproduction

1. Admin → Projects: rename a project's slug (here `stratos` → `data-centers`)
   while a document under it contains `{{coverage:<old slug>}}` in its body.
2. Approve the publish request. The run fails as above; the dashboard shows
   the error under the run.

## Root cause

`replaceProjects` (`packages/db/content.js`) cascades a slug rename to the
`project_slug` columns in `PROJECT_SLUG_REFS` (documents, project_files,
project_notes, press, petitions) — but not to the `{{coverage:<slug>}}`
tokens that live as plain text inside document bodies (`body_html_raw`,
`body_html_normalized`, `body_blocks`). The token kept the old slug; the
coverage map no longer had it.

## Fix

- Code: the rename loop in `replaceProjects` now also runs
  `UPDATE documents SET <col> = replace(<col>, '{{coverage:<from>}}', '{{coverage:<to>}}')`
  for the three body columns (`DOCUMENT_BODY_COLUMNS`), inside the same
  transaction.
- Data (prod, one-off, same SQL by hand): the Data Centers report's three body
  columns, one row each; then `scripts/publish.mjs --env prod --source db`.
  Staging was not renamed (still `stratos`) — nothing to fix there.

## What would catch it earlier

A publish request's "changes" preview could warn when a renamed slug still
appears as a coverage token. Not built; the publish error message already
names the document and the key.
