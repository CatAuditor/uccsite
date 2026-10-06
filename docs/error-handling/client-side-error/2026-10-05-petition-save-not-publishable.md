# 2026-10-05 — "Nothing to publish" right after saving petition copy

**Error (admin, inline Request publish on /petition):**
`Nothing to publish — no saves since the site last went live.` — shown after a
real save of the petition copy. Same for Donation appeals.

**Route/component:** `lib/publish.js requestPublish` → `packages/db/publish-requests.js
changesSince`. Also affected the dashboard's "Unpublished saves" list, silently,
since 2026-09 — petition and appeals saves never appeared there either, so they
only went live when some other save prompted a publish.

**Repro:** sign in as editor, /petition → change a field → Save → Request publish.

**Root cause:** `changesSince` filters `audit_log` rows through `CONTENT_ACTION_RE`.
Petition saves are audited as `petition.save` and appeals as `appeals.save`
(entity types `homepage`/`settings`), and neither prefix was in the regex. The
regex is keyed on the ACTION name, not the entity type.

**Fix:** regex now also matches `^(petition|appeals)\.save$` (anchored so
`petition.export`, an audited CSV export, still does not count). Regression test
`packages/db/test/publish-requests.test.mjs` lists every content action.

**Would catch it earlier:** that test; and the admin.md "Unpublished" paragraph
now says a new save action must be added to the regex.
