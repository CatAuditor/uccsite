# ADR: petitions are a collection, one row per petition, always under a project

**Date:** 2026-10-10 · **Status:** accepted · **Supersedes:** petition-copy-in-homepage-group.md

## Decision

A petition is a row in the `petitions` table (slug, project, status, featured,
copy), edited on its own admin page, rendered at
`/projects/<project path>/<slug>` with its thank-you page under it, listed on
`/petitions`, shown as a card on its project's hub, and — for the one open
row ticked `featured` — as the homepage hero. Several petitions may be open
at once. Every petition **must** belong to a project (org decision
2026-10-10: "petitions always belong to a project"). Signatures stay in
`petition_signatures` keyed by the slug.

## Alternatives considered

1. **Keep the homepage group** and add a second group / a "next campaign"
   slot. Rejected: still one-at-a-time in practice, and the copy would keep
   living on a page that is not about petitions.
2. **A flat `/petitions/<slug>` address** for every petition. Rejected: the
   rest of the site files things under projects (documents, press, files),
   and the hub is where a visitor meets the petition.
3. **One petition per project at `/projects/<path>/petition`**. Rejected:
   a project can need a second petition while the first is closed but still
   worth reading.
4. **A shared `/petition-thanks` page** choosing copy client-side. Rejected:
   the thank-you copy and donation ask are per petition and should render
   server-side like everything else.

## Consequences

- The API Lambda reads one more content table (`GRANT SELECT ON petitions`).
  It refuses signatures on a **closed** petition (409) and still records a
  signature under an unknown slug without a project (the 2026-10-05
  behaviour; drafts count as unknown to the public route).
- A slug is unique across projects and is **locked once signed**: the count
  and the CSV are per slug, so a rename would orphan the signatures.
- `/petition` and `/petition-thanks` are 301s to the featured petition
  (`aws/publish/render-db.js petitionRedirects`), so printed links keep working.
- The homepage's `petition` column is no longer read or written; it is the
  pre-migration backup and can be dropped in a later cleanup.
- Reversing this (back to a homepage group) would need the group's fields
  restored to `HOMEPAGE_GROUPS` + `HOMEPAGE_GROUP_COLS`, the old templates,
  `derivePetitionShare` / `derivePetitionProject`, and the API's
  `petitionCampaign` reading `homepage` again — and would lose every
  petition but one.
