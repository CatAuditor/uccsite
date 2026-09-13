# Debug logging — media library

Prefix: `[media]`. Feature doc: docs/systems/media.md.

| Where | Event | Log | Normal | Broken |
|---|---|---|---|---|
| apps/admin/lib/media.js `createUpload` | presigned PUT issued | `[media] <actor> upload begun <id> <key> <mime> <bytes>B` | one per file | absent → the server action threw before the row/presign (role, mime, size) |
| apps/admin/app/media/uploader.js (browser console) | PUT or action failed | `[media] upload failed <Error>` | none | S3 403 = CORS origin not allowed or presign expired; 400 = content type mismatch |
| aws/media-process (CloudWatch `/aws/lambda/UccStaging-MediaProcessFn…`) | event received | `[media] <id> <mime> <w>x<h> <bytes>B → widths 400/800… hash <12hex>` | one per upload | `ignoring key outside uploads/<id>/` = wrong key layout; `no media_assets row` = PUT happened without the admin's insert |
| same | done | `[media] <id> ready: N variants` | N = 2 × widths | missing → see failed line |
| same | failed | `[media] <id> failed: <message>` | none | message is copied to `media_assets.error` and shown on the card |
| apps/admin (server) | every mutation | `[admin] <actor> media.upload/media.alt/media.delete media/<id>` | audit trail | — |

Row-level state is the first thing to check: `SELECT id, status, error,
updated_at FROM media_assets ORDER BY created_at DESC`. `pending` forever =
the browser PUT never landed (CORS/presign); `processing` forever = Lambda
crashed mid-run (check the alarm / CloudWatch); `failed` = see `error`.
