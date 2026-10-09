# A dedicated `/donate` page, built from the homepage donate group

**Date:** 2026-10-10. **Status:** accepted.

## Decision

Add one static page, `templates/donate.html` (`/donate`), and point every
"give" link at it: the nav's red Donate button, the footer link, the homepage
timed modal, the download modal, the petition thank-you email's "Chip in"
fallback, and Stripe's `cancel_url` / billing-portal `return_url`. The homepage
donate section stays where it is.

The page's copy lives in the existing homepage `donate` JSON group, extended
with `page_headline`, `page_intro`, `points_heading` and `point1..3_title/_body`,
so it is edited on the admin's **Donation appeals** page with the rest of the
donation copy and needs no DDL (JSON column). The form is the homepage form's
markup verbatim, so `js/main.js initDonate()` runs on both pages; the only
addition is `data-source="donate-page"` on the submit button, sent as `source`
to `/api/create-checkout-session` (already accepted) so Stripe metadata and the
admin's Donations list show where a gift came from.

## Alternatives

- **`/give/<slug>` pages from a "payment options" collection**
  (docs/proposals/payment-options.md). The right long-term shape, but it is a
  new table, editor, slot system and renderer; the ask here was one landing
  page. When payment options are built, `/donate` becomes the first slot and
  the extra `donate` fields move into the option.
- **A `content/donate.json` + `donate` table.** A new content file means a
  new export file, restore path, collection and drift-guard entry for eight
  strings that already have a home.
- **Keep the homepage anchor and just redesign the section.** A section at the
  bottom of a long page cannot be the target of a nav button, a newsletter or
  a social post without the visitor losing the context of the ask.

## What breaks if reversed

- Removing the `PAGES` entry leaves nav, footer, both modals, the email
  fallback and Stripe's return URLs pointing at a 404 (`DEFAULT_NAVIGATION`,
  `templates/index.html`, `templates/partials/footer.html`, `aws/api/emails.js`,
  `aws/api/routes.js`). Change them back to `/#donate` in the same commit.
- Dropping the `page_*` / `point*` fields from `HOMEPAGE_GROUPS` while the
  template still reads them makes the admin wipe them on save (the group-level
  guard does not see fields).
- A saved `site_settings.navigation` on prod (NULL as of 2026-10-09) would
  keep whatever Donate href it holds; the default only applies while it is NULL.
