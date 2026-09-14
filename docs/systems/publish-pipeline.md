# Publish Pipeline (AWS rebuild, Phase 4)

Render-all → hash-diff → put-changed → invalidate → verify. Spec: `docs/build-spec-aws.md` §7.

## Code Map

```
aws/publish/core.js         pipeline core: diff vs live S3 sha256 metadata,
                            parallel PUT changed (Cache-Control + hash metadata),
                            batched DeleteObjects, ONE invalidation via
                            invalidationPaths() (URL-encoded, both page
                            spellings, wildcard past 15 paths), poll Completed
                            concurrently with GetObject read-back verify,
                            publish_runs lifecycle rows. Guards: refuses empty
                            outputs; refuses deleting >5 live keys without
                            --allow-bulk-delete.
aws/publish/store.js        publish_runs persistence (DSQL) + in-memory test
                            store + THE PUBLISH MUTEX (publish_lock singleton
                            row; acquireLock = conditional UPDATE serialized
                            by DSQL OCC, stale after 30 min). Lifecycle:
                            'publishing' row with the intended manifest is
                            written BEFORE any S3 mutation, flipped to
                            succeeded/noop/failed after; EVERY failure path
                            records a 'failed' row, including render errors
                            and pre-S3 refusals (empty outputs, bulk delete);
                            a run that lost the mutex records 'refused'.
                            latestState() returns the newest UNFINISHED run
                            if one exists (a later finished run can't hide
                            it). Index idx_publish_runs_started.
aws/publish/inputs.js       THE shared repo-input loader (COPY_FROM_ROOT,
                            render inputs, static files, git/mtime lastmod
                            providers) used by BOTH build.js and publish.mjs —
                            the file list can never diverge between them.
aws/publish/handler.mjs     PUBLISH LAMBDA (Phase 7): the admin's Publish
                            button and Restore async-invoke it (retryAttempts
                            0 — a retry would be a duplicate run); it takes
                            publish_lock FIRST (refused → 'refused' row),
                            releases it in finally; content from DSQL
                            (packages/db/content loadContent), site sources
                            bundled into the asset via infra/cdk/
                            copy-site-src.js (list = inputs.js SITE_SRC_*),
                            sitemap lastmod from content updated_at
                            (makeDbLastmod). Known limitation: template-only
                            changes don't advance lastmod, and removing the
                            newest row can lower it.
aws/reconcile-drift/        hourly Lambda (see below). Also flips an
                            abandoned 'publishing' run to failed so the
                            admin's publish button unblocks.
packages/db/content.js      content tables ⇄ renderer JSON (FIELD_MAPS,
                            COLLECTION_TABLES, loadContent/contentMeta,
                            transactional replaceCollectionRows, insertRow);
                            content-schema.js holds the DDL;
                            saveContent = the inverse write path shared by
                            scripts/migrate-content.mjs (initial migration)
                            and scripts/restore-from-export.mjs (§14.4);
                            both verify the round trip (deepStrictEqual).
scripts/publish.mjs         CLI driver; resolves bucket/distribution/DSQL at
                            RUN TIME from the UccStaging/UccProd stack
                            outputs. --source git|db picks the content
                            source (validated; PROD requires it explicitly —
                            a git-source publish after cutover would revert
                            admin edits). db mode uses the same DB lastmod
                            as the Lambda, so the two paths produce
                            identical sitemaps.
scripts/staging-check.mjs   e2e verification of a deployed distribution.
packages/db/index.js        DSQL connect (IAM presign w/ backdated signingDate
                            for skewed dev clocks), withConnection,
                            withRetry(40001) — used by every DB caller.
```

AWS code lives under `aws/`, never `functions/` — Cloudflare Pages compiles
everything under `functions/` as live routes.

## Data flow

1. `node scripts/publish.mjs --env staging|prod` loads inputs via
   `aws/publish/inputs.js`, renders every page (fail-fast — any render or
   input error exits before AWS is touched), resolves the target stack's
   outputs, and hands a complete `Map<key, Buffer>` to the core.
2. `core.publish()` lists the bucket and HEADs manifest keys (concurrency 16),
   diffing each output's sha256 against `x-amz-meta-sha256`. Metadata-less
   objects always count as changed — self-healing from any bucket state.
3. A `publishing` row with the full intended manifest is recorded BEFORE the
   first write (the reconciler stands down while one is fresh).
4. Changed keys PUT in parallel (8) with `Cache-Control: public, max-age=0,
   s-maxage=31536000, must-revalidate`; removed keys deleted via batched
   DeleteObjects — but a removal of more than 5 keys aborts unless
   `--allow-bulk-delete` was passed (a swallowed fs error upstream must not
   empty the live bucket).
5. One invalidation from `invalidationPaths()`: URL-encoded, each page under
   both spellings (`/x.html` + `/x`, any `dir/index.html` + `/dir`,
   `index.html` + `/`), collapsed to `/*` past 15 paths. The poll to
   `Completed` runs CONCURRENTLY with the read-back verify (which hits S3,
   not the edge).
6. The row flips to `succeeded` (or `failed` with the error — every throw
   between first PUT and completion records `failed`).

## Redirects → KeyValueStore (2026-09-13)

After the site files are live (Lambda and CLI alike), `publishRedirects`
(aws/publish/render-db.js → redirects-sync.js) reads the ACTIVE rows of the
`redirects` table and reconciles the CloudFront KeyValueStore the
viewer-request function consults: puts changed keys, deletes keys not in the
table, optimistic ETag with one retry. The KVS data plane is SigV4A-signed —
`@aws-sdk/signature-v4a` is required explicitly to register the pure-JS
signer. Propagation to the edge takes ~10–30 s. A sync failure is logged as a
warning, written into the run's `error` column so the dashboard shows it
(pages stay live; the previous redirect set stays in force). An EMPTY table
never touches the store (protects the deploy-time seed). **Pre-cutover step
for prod:** `node scripts/migrate-redirects.mjs --env prod` once, so the
seeded `/auth` key is in the table; the admin's Redirects page is the source
of truth afterwards.

## Publish mutex (review fix 2026-09-13)

The admin's in-flight check (`inFlightPublish`: freshest 'publishing' row
< 30 min) only drives the button/polling. The authoritative guard is
`publish_lock` in the Lambda: two invocations (two tabs, a restore during a
publish) get exactly one winner; the loser writes a `refused` row the
dashboard shows as "Refused (another publish was running)". A crashed
holder's lock is taken over after 30 min (> the 10-min Lambda timeout).

## publish_runs (DSQL)

`trigger_source` values: `approve:<email>` (an admin approving a publish
request — the only admin path, docs/systems/admin.md "Publishing"),
whatever `scripts/publish.mjs` passes for operator runs, and the Lambda's
own `lambda-redirects-verify`. The admin's request / approve / decline
records live in `publish_requests`, not here.

`id UUID PK, trigger_source, status(publishing|noop|succeeded|failed),
changed_paths TEXT(json), manifest TEXT(json), invalidation_id, error,
started_at, finished_at`. DDL is applied once per process via the store's
`ensureSchema` (full migration story lands with the Phase 5 schema work).

## Drift reconciler

EventBridge hourly → `aws/reconcile-drift` (log group
`/aws/lambda/*ReconcileDriftFn*`). Behavior:

- Latest run `publishing` and <30 min old → stand down (never race a publish).
- Latest run `publishing` and older → abandoned publish: alert, then roll the
  partial write back to the last GOOD manifest (a partial site is never valid).
- Per manifest key (concurrency 16, per-key error isolation): on hash mismatch
  or missing object, search version history (paginated, exact-key filtered)
  for the version whose metadata hash matches and CopyObject it back.
  - Restored objects → ONE invalidation + `restored` alert.
  - Unrepairable objects → NO invalidation (would evict a possibly-good edge
    copy) + a DISTINCT `UNRESOLVED … republish needed` alert.
- Bucket keys absent from the manifest → `unexpected object(s)` alert (rogue
  writes are otherwise invisible until the next publish).
- Any handler failure → `reconciler FAILED` alert + rethrow; a CloudWatch
  alarm on the Lambda's Errors metric feeds the same OpsAlerts topic
  (subscribe an email — `docs/for-conner.md`).

## Verified on staging (2026-09-12)

- noop run writes nothing; changed-only run put exactly 1 object; corruption
  drill: rogue PUT detected, restored from version history, next run clean.
- Unit suite (`aws/publish/test/core.test.mjs`, fake S3/CF + memory store):
  lifecycle rows (intent-first), failure rows, bulk-delete guard, empty-set
  refusal, invalidation path shaping (encoding, dir-index, wildcard).

## Verified additionally (2026-09-13)

- Content byte-parity: git-source and db-source publishes both noop against
  the same bucket — the database provably reproduces content/*.json.
- Publish Lambda end-to-end from the admin path: first invoke rewrote only
  sitemap.xml (lastmod source switch, by design), second invoke noop.

## Not yet

- Asset fingerprinting + `immutable` caching — Phase 8 (with per-page CSS).
