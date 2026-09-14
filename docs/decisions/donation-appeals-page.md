# Donation copy is edited on one admin page, stored where it renders

**Date:** 2026-09-13. **Status:** accepted.

## Decision

Every donation ask on the site is edited on the admin's **Donation appeals**
page (`apps/admin/app/appeals`): the homepage donate section, the homepage
timed modal, and the download modal that appears after any published
project-file download. The data stays where the renderer already reads it:

- homepage `donate` + `modal` JSON groups → `homepage` table (index.html)
- download modal title/body/cta/dismiss → four `site_settings` columns
  (`downloadModal*`), because the footer partial renders it on every page
  and `settings` is the one content file every page receives.

Ownership is declared in `apps/admin/lib/collections.js`: `HOMEPAGE_GROUPS`
entries flagged `appeals: true` and `APPEAL_SETTINGS_FIELDS`. The Homepage
and Site Settings editors skip those fields in their forms and save
`{ ...current, ...ownFields }` so a save from either page never nulls the
other's columns; the appeals page does the same in reverse and checks BOTH
singleton stamps in one transaction.

## Alternatives

- **A new `appeals` singleton table + `content/appeals.json`.** One table,
  one editor — but every page's `PAGES` entry would need the new content
  file, the export Lambda a new file, `config.yml` a new collection, and the
  homepage template two moved groups. More moving parts for the same
  editing experience.
- **Leave the fields on Homepage / Site Settings.** Cheapest, but the ask
  was one place for all donation copy; editors would have to know that the
  download modal lives under "Site Settings".

## What breaks if reversed

- Removing the `appeals` flag from a homepage group without adding it back
  to the Homepage form makes the drift guard pass while the group is
  editable nowhere.
- Dropping the `{ ...before, ...next }` merge in Site Settings or Homepage
  saves reintroduces Decap's delete-on-save hazard for the other page's
  fields (the guards only prove the columns are declared somewhere).
- Old `settings` revision snapshots predate the `downloadModal*` keys; a
  restore of one nulls the download modal copy (re-enter it on /appeals).
