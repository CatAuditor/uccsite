# Debug logging — project files

Prefix: `[files]`. Feature doc: docs/systems/files.md.

| Where | Event | Log | Normal | Broken |
|---|---|---|---|---|
| apps/admin/lib/files.js `createUpload` | presigned PUT issued | `[files] <actor> upload begun <id> <key> <mime> <bytes>B project=<slug|-> folder=<path|/>` | one per file | absent → the action threw first (role, extension not in FILE_TYPES, size, unknown project) |
| same `confirmUpload` | object verified | `[files] <id> ready <bytes>B` | follows each "begun" | missing → HeadObject failed (PUT never landed: CORS origin, presign expired, Content-Type differs from the signed one) or size mismatch; the row stays `pending` and shows "(incomplete)" |
| same `publishFile` | copy made | `[files] <actor> published <id> → files/<id>/<name>` | one per publish | CopyObject error → action error ("AccessDenied" = the admin principal lacks GetObject/PutObject on the media bucket) |
| same `unpublishFile` | copy removed | `[files] <actor> unpublished <id> (<key>)` | | a DeleteObjects failure AFTER the row update leaves a stray public object — re-publish then unpublish, or delete the key by hand |
| apps/admin/app/files/uploader.js (browser console) | PUT or action failed | `[files] upload failed <Error>` | none | see "begun"/"ready" above |
| apps/admin (server) | every mutation | `[admin] <actor> files.upload/update/publish/unpublish/delete file/<id>` | audit trail | — |

Row state first: `SELECT id, status, project_slug, folder, public_key,
updated_at FROM project_files ORDER BY created_at DESC`. `pending` = the
PUT or the verification failed; `public_key` set but the URL 404s = the
copy is missing (CloudFront maps S3 403 to the 404 page) — check the bucket
policy grants `files/*` and the object exists.
