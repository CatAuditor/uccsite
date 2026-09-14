# Project Files (admin `/files`)

A signed-in file store inside the admin, organised by **project** (the
Projects collection) and then by a free-text **folder** path, with a
per-file **Publish** that copies the file to the live site at
`/files/<id>/<filename>`. Built 2026-09-13 on the media library's
plumbing (same bucket, same presigned-PUT upload, same audit trail).

## Code Map

```
packages/db/files.js            SHARED, pure: key layout (private-files/<id>/<name>,
                                files/<id>/<name>), FILE_TYPES allow-list (ext → mime),
                                MAX_FILE_BYTES (250 MB), INLINE_TYPES, safeFilename,
                                mimeForFilename, normalizeFolder, contentDisposition,
                                rowToFile / FILE_COLUMNS
packages/db/content-schema.js   project_files DDL (+ idx_project_files_project)
apps/admin/lib/files.js         listProjects, listFiles (+ presigned GET per row),
                                createUpload (presign → pending row), confirmUpload
                                (HeadObject size check → ready), updateFile,
                                publishFile (CopyObject → files/), unpublishFile,
                                deleteFile
apps/admin/app/files/page.js    project tabs, folder chips, uploader, table with
                                Download / Publish / Unpublish / Delete / Move-note
apps/admin/app/files/uploader.js  client: beginFileUpload → browser PUT (server's
                                mime) → finishFileUpload
apps/admin/app/files/actions.js beginFileUpload, finishFileUpload, saveFileDetails,
                                publish, unpublish, remove — every one
                                requireRole('editor')
apps/admin/app/layout.js        nav: Site Main → Files
infra/cdk/lib/ucc-stack.js      '/files/*' CloudFront behavior on the shared media
                                origin (OAC); bucket policy grants media/* AND files/*
```

## Bucket layout (media bucket, per env)

| Prefix | What | Who can read |
|---|---|---|
| `private-files/<id>/<safe-name>` | the upload (presigned PUT target) | admin only, via presigned GET (15 min, `attachment`) |
| `files/<id>/<safe-name>` | the published copy | anyone, at `https://<site>/files/<id>/<safe-name>` via CloudFront |

Neither prefix is `uploads/`, so the S3 event that drives the media-process
Lambda never fires for files. The CloudFront bucket-policy statement is the
ONLY public path and is scoped to `media/*` + `files/*`; `private-files/`
(and the media library's `uploads/`) are never reachable from the edge.
The key IS the URL path (no `originPath` on the behavior — CloudFront
prepends an origin path to the whole URI, it does not strip the pattern).

## Data flow

1. **Upload** (editor+): the uploader picks project + folder, then files.
   Per file `beginFileUpload({filename, bytes, projectSlug, folder})` →
   role check → mime from the EXTENSION (`FILE_TYPES`; unknown → refused;
   the browser's `file.type` is ignored) → project slug must exist (or be
   empty = General) → folder normalised → presigned PUT (30 min) with
   Content-Type + Content-Length SIGNED → `INSERT project_files (status
   'pending')`. The browser PUTs with the server's mime. `finishFileUpload
   (id)` → `HeadObject` must find the key with exactly the declared size →
   `status='ready'` → audit `files.upload`. A PUT that never lands leaves a
   `pending` row shown as "(incomplete)" — deletable.
2. **Download** (any role, signed in): `listFiles` presigns one GET per
   ready row (`ResponseContentDisposition: attachment`). Not audited.
3. **Organise**: "Move / note" per row → `saveFileDetails` (project, folder,
   note; one transaction with the `files.update` audit row carrying
   before/after). Project tabs count files per slug; a slug with files but
   no project (renamed/deleted project) still gets a tab marked `slug?` so
   the files can be moved. Folder chips are the distinct folders in the
   selected project; selecting one also shows its subfolders.
4. **Publish** (editor+): `publishFile` → `CopyObject` `private-files/…` →
   `files/<id>/<name>` with `MetadataDirective: REPLACE`, the row's mime,
   `Content-Disposition` (`inline` for `INLINE_TYPES`, else `attachment`)
   and `Cache-Control: public, max-age=300` → `public_key`, `published_at`,
   `published_by` → audit `files.publish`. The page shows the live link
   (`PUBLIC_ORIGIN` + path) and the path to paste into a Document or a
   project's CTA.
5. **Unpublish**: row first (`public_key` NULL), then `DeleteObjects` on
   the public key (delete marker on the versioned bucket). Cached edge copies
   can serve for up to 5 minutes (no invalidation from the admin).
6. **Delete**: row first, then original + public copy. Bytes are
   recoverable for 90 days (noncurrent-version lifecycle).

## project_files (DSQL)

| column | notes |
|---|---|
| id UUID PK | client-generated, part of every key |
| project_slug | soft link to `projects.slug` ('' = General). NOT an FK: projects are wiped and re-inserted with new ids on every save |
| folder | normalised path, '' = root (max 5 segments × 60 chars) |
| original_filename, mime, bytes | as uploaded (mime from the extension) |
| note | ≤ 500 chars |
| s3_key | `private-files/<id>/<safe-name>` |
| public_key, published_at, published_by | set while a published copy exists |
| uploaded_by | admin email |
| status | pending / ready |
| created_at, updated_at | |

## Roles

viewer: list + download. editor/owner: everything. Every server action
calls `requireRole('editor')`; the read-only UI is cosmetic.

## Env vars / IAM

Admin: `MEDIA_BUCKET`, `PUBLIC_ORIGIN` (live link), `UCC_REGION`. The admin
principal (local profile / Amplify SSR role) needs `s3:PutObject`,
`s3:GetObject`, `s3:DeleteObject` on the media bucket — CopyObject is a GET
on the source + PUT on the destination. Same grant the media library
already documents (`<MediaBucketName>/*`).

## Security notes

- Type allow-list by extension, signed into the PUT and rewritten on the
  public copy: nothing a browser executes on the site origin (html, svg,
  js, …) can be published, whatever the bytes are. `X-Content-Type-Options:
  nosniff` comes from the site headers policy on `/files/*`.
- Public URLs contain the row's UUID — not guessable, but not secret once
  shared; unpublish to revoke (≤ 5 min lag).
- Uploads are not malware-scanned. If outsiders' files start landing here,
  GuardDuty Malware Protection for S3 on the media bucket is a one-resource
  CDK addition.
- The `/files/*` behavior keeps the viewer function, so staging's basic
  auth gate applies to published files there too.

## Error handling

- Client: per-file try/catch; failures listed in the uploader message and
  `console.error('[files] upload failed')`.
- Server actions return `{ error }` through `runAction`; every mutation is
  audited (`files.upload/update/publish/unpublish/delete`).
- Logs: `[files]` prefix — docs/error-handling/debug/files.md.

## Status

Built 2026-09-13. Staging: schema applied, stack deployed, e2e verified
(see changelog). Not built: listing published files on the project pages
(paste the `/files/…` path into a project's CTA or a Document), share links
for people without an admin login, malware scanning.
