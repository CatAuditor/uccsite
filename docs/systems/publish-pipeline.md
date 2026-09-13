# Publish Pipeline (AWS rebuild, Phase 4)

Render-all → hash-diff → put-changed → invalidate → verify. Spec: `docs/build-spec-aws.md` §7.

## Code Map

```
functions/publish/core.js       pipeline core: diff vs live S3 metadata, PUT changed
                                (Cache-Control + sha256 metadata), delete removed,
                                one CreateInvalidation (wildcard if >15 paths), poll
                                Completed (5 min timeout), GetObject read-back verify,
                                publish_runs row. Fail-fast: render errors abort
                                before any write.
functions/reconcile-drift/      hourly Lambda: latest publish_runs manifest vs live
                                object hashes; restores drifted/missing objects from
                                S3 version history, invalidates, SNS alert.
scripts/publish.mjs             CLI driver (pre-Phase-7 the repo is the content
                                source): packages/render + static files → core.
                                Sitemap lastmod = last git commit date per input.
scripts/staging-check.mjs       25-check e2e verification of a deployed distribution.
packages/db/index.js            DSQL connect (IAM presign w/ backdated signingDate for
                                skewed dev clocks), withConnection, withRetry(40001).
```

## Data flow

1. `node scripts/publish.mjs --env staging` renders every page (fail-fast — any
   render error exits before AWS is touched) and collects the static files.
2. `core.publish()` lists the bucket, HEADs manifest keys, and diffs each
   output's sha256 against the object's `x-amz-meta-sha256`. Objects without
   the metadata (e.g. hand-synced) always count as changed and get rewritten
   with it — the pipeline is self-healing from any bucket state.
3. Changed keys PUT with `Cache-Control: public, max-age=0, s-maxage=31536000,
   must-revalidate` (browsers revalidate; CloudFront holds until invalidated).
   Keys no longer produced are deleted.
4. One invalidation covers every touched path — pages get BOTH spellings
   (`/x.html` and `/x`; `index.html` → `/`). >15 paths collapses to `/*`
   (counts as one path against the 1,000/month free tier).
5. After the invalidation reports `Completed`, every written key is read back
   and re-hashed; a mismatch fails the run.
6. A `publish_runs` row records trigger, status (`noop`/`succeeded`/`failed`),
   changed paths, the full manifest, invalidation id, timestamps.

## publish_runs (DSQL)

`id UUID PK, trigger_source, status, changed_paths TEXT(json), manifest
TEXT(json), invalidation_id, error, started_at, finished_at`. Created
on-demand (`CREATE TABLE IF NOT EXISTS`, one DDL per transaction per DSQL).

## Drift reconciler

EventBridge hourly → `functions/reconcile-drift`. Expected state = latest
successful/noop run's manifest. For each path: HEAD; on hash mismatch or
missing object, scan version history for the version whose metadata hash
matches, CopyObject it back to the top, invalidate both URL spellings, and
publish an SNS incident to the `OpsAlerts` topic (subscribe an email —
`docs/for-conner.md`). Verified on staging: a corrupted `theory.html`
(garbage bytes + wrong metadata) was detected and restored within one run.

## Verified on staging (2026-09-12)

- noop run: re-publish with no changes writes nothing, records `noop`.
- changed-only: metadata dropped on one object → exactly 1 put, 2 invalidation
  paths, verify pass, `succeeded` row.
- corruption drill: rogue PUT → reconciler `drift:1`, restored from version
  history, next run `drift:0`; page served correct content after.

## Not yet

- Asset fingerprinting + `immutable` caching — Phase 8 (with per-page CSS).
- Lambda-triggered publish from admin + DB content source — Phase 7 (the core
  is already shaped for it: pure inputs, injected clients).
