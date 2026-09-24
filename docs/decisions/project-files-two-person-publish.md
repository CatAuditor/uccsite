# Project file publishing goes through the two-person rule

**Date:** 2026-09-24

## Decision
An editor's "Publish" on `/files` now records a **request**. The S3 copy that
makes the file reachable at `/files/<id>/<name>` happens in `approvePublish`,
when a *different* admin approves a site publish.

Two columns carry it: `project_files.publish_requested_at` and
`publish_requested_by`, cleared when the approval fills `public_key`.

**Unpublish stays one-click, deliberately.** The rule exists to stop things
going up, not coming down; taking a document off the internet fast is a safety
valve. Unpublish also clears any outstanding request, so it cannot be undone by
the next approval.

## Why
`publishFile` copied the object immediately. The *listing* on `/projects` waited
for a two-person publish, but the file itself was downloadable at its URL the
moment one editor clicked — so a single person could put a document on the
internet. `docs/systems/admin.md` recorded it as "an open gap against the rule,
not a design choice".

Promotion runs **before** the Lambda invoke because `listPublishedFiles` selects
on `public_key IS NOT NULL`. A file promoted after the render would be live but
missing from the project listing until the next publish.

It runs **outside** the approval transaction because these are S3 copies, which
do not belong inside a database transaction.

## Alternatives
- **A second approval queue just for files.** Smaller diff, but a parallel
  review flow with its own states, notifications and edge cases, for the same
  guarantee the existing one already provides.
- **Promote inside the publish Lambda.** The natural home on paper, but the
  Lambda writes the site bucket; project files live in the media bucket, so it
  would need a new grant and the file code copied across a package boundary.

## Consequences
- A file cannot go live without a site publish. Files and content ship together.
- Validation (upload complete, under the 50 MB cap) runs at request time, so the
  writer hears about a problem then rather than at approval.
- Per-file promotion failures are collected, not thrown: one unreadable object
  cannot block a site publish. Failed files keep their request and retry on the
  next approval, and the failure is written to the audit row.
- New audit actions: `files.publish_request`, `files.publish_cancel`,
  `files.publish_approve`.

## What breaks if reversed
Restoring the immediate copy re-opens the gap: one editor, one click, a public
URL. If file publishing ever has to be independent of site publishing, give it
its own request/approve pair — do not give it none.
