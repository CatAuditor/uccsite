# 2026-10-09 — Prod admin: "An error occurred in the Server Components render"

**Symptom (prod admin):** pages failed with Next's production-redacted
"An error occurred in the Server Components render … digest …" (two digests,
e.g. refs 1335521145 and 126356685). Public site unaffected.

**Route:** any admin page that reads the petitions collection — `/petitions`,
`/homepage` (hero status), `/projects/[slug]`, `/revisions`, Outgoing emails —
via `packages/db/petitions.js listPetitions` (`SELECT * FROM petitions`).

**Root cause:** v0.27.0 (petitions collection) was pushed to `refactor`, which
Amplify builds as the PROD admin, while the prod database still lacked the
`petitions` table (changelog: "Staging migrated and published; prod pending").
The new admin code queried a table that did not exist.

**Fix:** ran the for-conner.md §11 steps against prod from a clean checkout of
`20b0137`: `migrate-schema.mjs --env prod`, `migrate-petitions.mjs --env prod
--apply` (row `725394c9…`, 7 signatures kept, legacy `petition-thanks` email
re-keyed to `petition-thanks:udot-alpr-permits`), `cdk deploy UccProd`, then a
publish from the admin. `/petition` and `/petition-thanks` 404'd for about a
minute after the publish until the KeyValueStore redirects propagated; both
now 301 to `/projects/alpr/udot-alpr-permits` (and `/thanks`).

**Would catch it earlier:** a push to `refactor` that needs a prod schema
change must have the prod migration run first (or in the same sitting). The
admin has no schema-version check; one that compares `packages/db/schema.js`
against `information_schema.tables` at startup would turn this into a clear
"run migrate-schema" message instead of a redacted digest.
