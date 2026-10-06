# Debug logging — Documents & styling

Prefixes: `[documents]` (admin), `[publish]` (Lambda / CLI). Feature doc: docs/systems/documents.md.

| Where | Log | Normal | Broken |
|---|---|---|---|
| apps/admin/lib/documents.js `loadSiteSources` | `could not read css/styles.css from the site bucket (<ErrorName>); falling back to the repo copy` | never | `AccessDenied` = SSR role / profile lacks s3:GetObject on the site bucket; `NoSuchKey` = site never published |
| apps/admin/app/documents/actions.js `convertUpload` | `convert <kind> "<file>" <bytes>B -> <chars> chars, <n> images omitted[, warnings: …]` | one line per .docx/.md upload; images omitted = embedded pictures replaced by placeholders | missing line after an upload = the action never ran (file > 8 MB is refused with an `{ error }`; a 413 from Next = bodySizeLimit lower than the file); `warnings:` lists Word styles mammoth could not map (content still converted as plain paragraphs) |
| apps/admin/app/documents/authoring-kit/route.js | `authoring kit for <email>: N classes, N template rules, N coverage keys, N chars` | N classes ≈ the Style Kit size; template rules > 0 once rules exist | 0 classes = site CSS unreadable (see loadSiteSources warning above); 403 with no log = signed out |
| apps/admin/app/layout.js | `nav categories unavailable: <message>` | never | DB unreachable — every page would also fail |
| lib/actions.js (all document actions) | `action failed: <message>` | validation refusals: slug taken, a11y gate, meta description missing, conflict | `Not in the Style Kit: …` from the picker = stylesheet changed since the page loaded |
| aws/publish (CloudWatch) | `RENDER ERROR: document <slug>: accessibility gate: …` / `empty meta description` / `unknown coverage key` / `invalid video id` | never | the named document blocks the whole publish; fix it in the editor (its `last_publish_error` shows the same text) |
| aws/publish | `rendered N files (X fixed pages, Y documents)` | Y = published documents | Y=0 with documents published = render-db not loading the bundle |

First check for a broken document page: `SELECT slug, status, last_publish_error, live_at FROM documents`. For an empty tree/preview in the editor: `body_html_normalized IS NULL` → the document was never saved/ingested (re-run `scripts/migrate-documents.mjs --apply` for migrated rows, or save it once).
