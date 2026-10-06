# 2026-10-05 — Approved saves shown as unpublished right after approval

**Symptom (admin dashboard):** press Approve & publish → the page returns to
"Unpublished saves (N)" listing the same saves with a live **Request publish**
button, and the request table says "Approved — publish not started". Nothing
polls. 30-60 s later it flips to publishing/live. People re-requested (and
could re-approve) what was already going live.

**Route:** `app/page.js` ← `lib/publish.js publishState` ← `lib/data.js
inFlightPublish` (publish_runs `status = 'publishing'`).

**Root cause:** the publish Lambda (`aws/publish/handler.mjs` → `core.publish`)
records its `publishing` row only after rendering the whole site and HEADing
every live S3 key; a noop run writes its row only at the end. So the admin's
in-flight signal is blind for the whole first phase of every publish.

**Fix (admin only, Lambda untouched):** `busyPublish` treats an approved request
whose trigger has no run row yet, reviewed under 10 minutes ago, as in flight
(`runStatus 'starting'`; older = `'never started'`). Dashboard shows
"Publishing now…", hides the request form, polls; `requestPublish` and
`approvePublish` refuse while busy.

**Would catch it earlier:** a smoke test that approves and immediately reloads
the dashboard. Not automated (needs a browser session against staging).
