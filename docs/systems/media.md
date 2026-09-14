# Media Library (spec §13 — Phase 7)

Admin image uploads → private S3 original → S3 event → `media-process` Lambda
(sharp) → AVIF + WebP variants at 400/800/1200/1600/2400px, fingerprinted and
served at `/media/*` with a one-year immutable cache → `media_assets.variants`.
Alt text is required before an asset can be placed on a page.

`/assets/*` (the repo's existing images) is untouched: it still ships from the
site bucket via the publish pipeline. Moving it into the media bucket is an
optional post-migration task (plan item 135).

## Code Map

```
packages/db/media.js         SHARED, pure: key layout (uploads/<id>/<file>,
                             media/<id>/<hash>-<w>.<ext>), VARIANT_WIDTHS,
                             ACCEPTED_MIMES (no SVG), MAX_UPLOAD_BYTES (25 MB),
                             parseUploadKey, assetIdFromPath, pickVariant,
                             rowToAsset / ASSET_COLUMNS
packages/db/content-schema.js  media_assets DDL
aws/media-process/index.mjs  S3-event Lambda: sharp variants + row update
                             (status pending → processing → ready | failed)
infra/cdk/lib/ucc-stack.js   MediaBucket (private, versioned, CORS PUT from
                             admin origins), /media/* CloudFront behavior
                             (OAC with a HAND-WRITTEN bucket policy scoped to
                             media/* — originals under uploads/ are never
                             readable by CloudFront; CACHING_OPTIMIZED, site headers policy,
                             viewer fn for staging basic auth), MediaProcessFn
                             (x86_64, 1536 MB, 2 min; sharp cross-installed
                             for linux-x64 in an afterBundling hook, external
                             to esbuild), ObjectCreated(uploads/) notification,
                             crash alarm → OpsAlerts; output MediaBucketName
apps/admin/lib/media.js      listAssets (+presigned GET thumbnails), createUpload
                             (row first, then presigned PUT), deleteAsset,
                             mediaOptionsFor (ready + alt only), assertAltText
apps/admin/app/media/        page.js (grid, alt form, delete), uploader.js
                             (client: presign → browser PUT → finishUpload),
                             actions.js (beginUpload/finishUpload/saveAlt/
                             removeAsset — every one calls requireRole('editor'))
apps/admin/app/list-editor.js  widget 'media' = text input + picker <select>
apps/admin/lib/collections.js  team.photo is widget 'media', targetWidth 400
apps/admin/lib/collection-save.js  alt-text gate on save (assertAltText)
scripts/admin-env.mjs        writes MEDIA_BUCKET from the stack output
```

## Data flow

1. Editor picks files on `/media`. For each: `beginUpload({filename, mime,
   bytes})` → role check → presigned PUT (15 min) for exactly
   `uploads/<id>/<safe-filename>` with Content-Type AND Content-Length
   SIGNED (the presigner leaves headers unsigned unless asked; a mismatched
   type or size is a 403 from S3 — the 25 MB limit is enforced by S3) →
   `INSERT media_assets (status 'pending')`. Presign first so a config or
   credential failure leaves no orphan row.
2. Browser `PUT`s the file to S3 directly (bucket CORS allows PUT from the
   admin origins). `finishUpload(id)` writes the `media.upload` audit row.
3. S3 `ObjectCreated` (prefix `uploads/`) invokes `MediaProcessFn`. It looks
   up the row by the id in the key (no row → warn + skip), sets `processing`,
   HeadObjects the original and rejects >25 MB / non-image content types
   BEFORE reading the body (defense in depth behind the signed length; an
   oversized read would OOM the function and strand the row) — a rejected
   original is DELETED from the bucket, the row keeps the reason — reads it, hashes the
   bytes (sha256, 12 hex), reads dimensions (EXIF-rotated), and for every
   width ≤ the original's width (or the original width if it is smaller than
   400) writes `media/<id>/<hash>-<w>.avif|webp` with
   `Cache-Control: public, max-age=31536000, immutable`. Then
   `status='ready'`, `width/height/bytes/mime`, `variants` JSON
   `[{format,width,height,path,bytes}]`.
   Any failure → `status='failed'`, `error` (shown on the card), NOT rethrown
   (S3 → Lambda retries would fail identically; the alarm is for crashes only).
   Idempotent: a duplicate event rewrites identical keys. Row updates are
   wrapped in `withRetry` (40001) so an alt save racing the final `ready`
   write cannot flip a finished asset to failed.
4. `/media` polls (Refresher) while any asset is pending/processing and not
   stalled (no update for 15 min → shown as stalled, polling stops).
   Thumbnails are presigned GETs of the smallest WebP (the bucket is private
   and staging CloudFront is behind basic auth, so public URLs would not
   render inside the admin).
5. Placing an image: the Team editor's Headshot field offers a picker built
   from READY assets WITH alt text; picking sets the field to the WebP variant
   nearest ≥ `targetWidth` (400 for headshots, rendered at 160 CSS px).
   `saveCollection` re-checks every `/media/<id>/…` value with
   `assertAltText` — a typed path fails the save, and `saveAlt` refuses to
   clear an alt once set. NOTE: the alt stored here is a placement policy,
   not yet rendered — `templates/team.html` emits `alt="{{name}}"` (correct
   for a headshot). Rendering `media_assets.alt` for arbitrary images is
   Phase 8 (Documents ingest, spec §5 step 6).
6. Delete first checks usage (`assetUsage`: team headshots, document
   bodies / og:image / page CSS containing `/media/<id>/`) and REFUSES while
   anything references the asset (the card shows "Used by …" and the button
   is disabled); then removes the row (retried on 40001), then the original +
   all variants (`DeleteObjects` — delete markers on this versioned bucket;
   bytes expire after 90 days); audited as `media.delete`.

## media_assets (DSQL)

| column | notes |
|---|---|
| id UUID PK | client-generated, part of every key |
| s3_key | original under `uploads/` |
| original_filename, mime, bytes | as uploaded (mime re-read from the object on process) |
| width, height | after EXIF rotation |
| alt | required for placement; edited on `/media` |
| variants TEXT | JSON array, see above |
| uploaded_by | admin email |
| status | pending / processing / ready / failed |
| error | last processing error |
| created_at, updated_at | |

## Env vars

- Admin: `MEDIA_BUCKET` (runtime; missing → loud throw on first `/media`
  render or picker load). Written by `scripts/admin-env.mjs`.
- Lambda: `MEDIA_BUCKET`, `DSQL_ENDPOINT` (set by CDK).

## IAM

- MediaProcessFn: `s3:GetObject` + `s3:DeleteObject` on `uploads/*`,
  `s3:PutObject` on `media/*`, `dsql:DbConnectAdmin`.
- Admin (local profile / Amplify SSR role): `s3:PutObject` (presign),
  `s3:GetObject` (thumbnail presign), `s3:DeleteObject` on the media bucket.
  The SSR role wire-up is still pending (docs/systems/admin.md).

## Error handling

- Client: per-file try/catch; failures listed in the uploader message and
  `console.error('[media] upload failed')`. A failed PUT leaves a `pending`
  row — visible on the grid, deletable.
- Server actions throw (Next surfaces the error); every mutation is audited.
- Lambda: per-asset errors on the row; crashes (bad env, DB unreachable) hit
  the `MediaProcessErrorsAlarm` → OpsAlerts SNS.
- Logs: `[media]` prefix — see docs/error-handling/debug/media.md.

## Hard constraints

- Key layout is shared through `packages/db/media.js` — change it there only.
  The same bucket also holds the project files prefixes `private-files/`
  and `files/` (docs/systems/files.md); the CloudFront policy statement
  grants `media/*` + `files/*`.
- The media origin passes `originAccessLevels: []` and adds its own
  `media/*` GetObject statement; restoring CDK's default grant would expose
  `uploads/` originals (with EXIF) to anyone who guesses a key.
- sharp's Lambda binaries come from the CDK `afterBundling` hook
  (`npm install --os=linux --cpu=x64 --libc=glibc sharp@<version from
  aws/media-process/package.json>`); the function must stay `X86_64`, and
  `sharp` must stay in `externalModules`.
- Bucket CORS origins come from the same list as the Cognito callback
  origins (localhost:3000, `stagingAdminOrigin` context, prod admin domain).
- SVG is not accepted (script vector; sharp would rasterize it anyway).

## Status

Built and deployed to staging 2026-09-13. E2E verified the same day (scripted:
row insert → presigned PUT 200 → Lambda ready in ~12 s → 8 variants for a
2048px JPEG (2400 skipped) → `/media/*` through CloudFront 200 with
`image/webp` + immutable cache, 401 without staging basic auth; mismatched
Content-Type PUT → 403). Review pass done (2026-09-13): size check before
body read, retried row writes, stalled detection, row-first delete, scoped
OAC policy, signed Content-Type, variants JSON guard. Not yet: usage counts / delete
protection for referenced assets, migrating `/assets/*` into the bucket,
picker on fields other than `team.photo` (Documents' image handling is
Phase 8 ingest, spec §5 step 6).
