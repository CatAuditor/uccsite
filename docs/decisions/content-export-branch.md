# ADR: Nightly content export commits to a dedicated branch, not `main`

**Date:** 2026-09-13 · **Status:** accepted (revisit at cutover)

## Decision

The §14.2 content export commits to `content-export` (prod) /
`content-export-staging` (staging), set by `EXPORT_BRANCH` on
`ExportContentFn` in `infra/cdk/lib/ucc-stack.js`. Not `main`.

## Why

- `main` auto-deploys Cloudflare Pages **production** with no preview. Until
  cutover (Phase 6), a nightly bot commit to `main` would redeploy the live
  site from whatever the AWS database holds — a staging test edit could ship.
- A bot-owned branch keeps the export history clean: every commit on it is
  "content changed", exactly the property §14.2 wants (a diff shows a content
  change and nothing else), unmixed with code commits.
- The export is still where §14.2 puts it: the same repo, same
  `content/*.json` shapes, `git log -p content/` works.

## Alternatives

- Commit to `main`: correct AFTER cutover (git is no longer a deploy
  trigger). Rejected for now because of the Pages auto-deploy.
- Separate repo: loses "same place it lived before" and needs a second App
  installation. Rejected.

## What breaks if reversed without reading this

Setting `EXPORT_BRANCH=main` before Phase 6 makes the nightly export a
production deploy of the database's content through Cloudflare Pages.
After Phase 6 it is safe and probably desirable; update the stack env, this
ADR, and docs/systems/content-export.md together.
