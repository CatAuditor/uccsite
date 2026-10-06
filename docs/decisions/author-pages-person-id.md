# Author pages and a single Person `@id` per team member

**Date:** 2026-10-05. Supersedes the "Not done" note in [byline-attribution.md](byline-attribution.md).

## Decision

- Every team member gets a page at `/team/<slug>` (one template, expanded per
  member at render time) listing everything bylined to them.
- The site has exactly one identifier per person,
  `https://utahciviccompact.org/team/<slug>#person`, used as the Person `@id`
  on the author page, in every `Article`'s `author`, and in the homepage
  `Organization.member` list.
- Bylines are links to the author page.
- Public profile URLs live on the team member (`links`, one per line) and are
  emitted as `sameAs`.

## Why

Search for a team member's name returned their outside history (a campaign,
old press) and nothing from this site until deep in the results. The site
mentioned the name on two URLs and gave search engines no entity to attach it
to — each page's author was free text. One `@id` plus `sameAs` lets Google
reconcile "the person in the news" with "the author of these reports" instead
of treating them as two unrelated strings.

## Alternatives considered

- **Person schema on the shared `/team` page only.** Cheaper, but a single URL
  cannot be the canonical page for four people, and there would be nothing to
  link bylines to.
- **Author field on Documents only, no pages.** Gives the markup but no
  landing page, so no "all work by X" and nothing for outside sites to link to.
- **Slug as a required editor field.** Rejected: deriving it from the name
  means the pages exist with zero editor action; the optional field covers a
  rename or a collision.

## What breaks if reversed

- Removing the `each` PAGES entry drops four URLs that will be indexed and
  linked from bylines, statements, and (once editors add them) external
  profiles → 404s. Add redirects first.
- Changing the `@id` scheme splits the entity again; every Article's author
  reference and the Organization member list must change in the same commit
  (`authorIndex` is the one place for fixed pages and Documents, but the five
  long-form templates hardcode the URL for the git build).
