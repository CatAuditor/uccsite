# 2026-10-10 — Press & coverage: save lands, "Request publish" says nothing to publish

## Error

After saving a new story on Press & coverage (admin `/press`), "Request publish"
returned:

```
Nothing to publish — no saves since the site last went live.
```

Publish & Status listed no unpublished changes either. The save itself had
succeeded: `audit_log` rows `press.save` at 01:47:58Z, 01:48:06Z, 01:48:07Z,
01:52:29Z (prod), `press` table 17 → 18 rows. Reported as "new news entries
failing to save and publish".

## Route / component

`apps/admin/lib/publish.js` `requestPublish` → `changesSince` in
`packages/db/publish-requests.js`, which filters `audit_log` by
`CONTENT_ACTION_RE`. The same filter drives `publishState().unpublished`.

## Reproduction

1. Admin → Press & coverage → Add from link (or + Add) → Save. Save reports OK.
2. Press "Request publish" → "Nothing to publish".

## Root cause

The press list (docs/systems/press.md, 2026-10-09) records `press.save`, and
`CONTENT_ACTION_RE` had no `press` alternative — only the legacy `blog`,
`blog-*`, `coverage`, `coverage-*` prefixes that press replaced. The test that
guards the list (`packages/db/test/publish-requests.test.mjs`) did not include
`press.save`.

## Fix

- `press` added to the collection group in `CONTENT_ACTION_RE`; `press.save`
  added to the test.
- `ADMIN_PAGE.press = '/press'` in `apps/admin/lib/change-detail.js` so the
  "What will change" section links to the editor.
- Prod published by hand (`scripts/publish.mjs --env prod --source db`) so the
  saved story went live before the admin redeploy.

## What would catch it earlier

The regex test enumerates action names by hand. A boot-time check that every
`COLLECTIONS` key in `apps/admin/lib/collections.js` matches
`CONTENT_ACTION_RE` with `.save` would have failed the admin build on
2026-10-09. Not built.
