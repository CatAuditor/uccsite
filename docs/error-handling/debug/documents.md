# Debug logging — Documents & styling

Prefixes: `[documents]` (admin), `[publish]` (Lambda / CLI). Feature doc: docs/systems/documents.md.

| Where | Log | Normal | Broken |
|---|---|---|---|
| apps/admin/lib/documents.js `loadSiteSources` | `could not read css/styles.css from the site bucket (<ErrorName>); falling back to the repo copy` | never | `AccessDenied` = SSR role / profile lacks s3:GetObject on the site bucket; `NoSuchKey` = site never published |
| apps/admin/app/layout.js | `nav categories unavailable: <message>` | never | DB unreachable — every page would also fail |
| lib/actions.js (all document actions) | `action failed: <message>` | validation refusals: slug taken, a11y gate, meta description missing, conflict | `Not in the Style Kit: …` from the picker = stylesheet changed since the page loaded |
| aws/publish (CloudWatch) | `RENDER ERROR: document <slug>: accessibility gate: …` / `empty meta description` / `unknown coverage key` / `invalid video id` | never | the named document blocks the whole publish; fix it in the editor (its `last_publish_error` shows the same text) |
| aws/publish | `rendered N files (X fixed pages, Y documents)` | Y = published documents | Y=0 with documents published = render-db not loading the bundle |

First check for a broken document page: `SELECT slug, status, last_publish_error, live_at FROM documents`. For an empty tree/preview in the editor: `body_html_normalized IS NULL` → the document was never saved/ingested (re-run `scripts/migrate-documents.mjs --apply` for migrated rows, or save it once).
