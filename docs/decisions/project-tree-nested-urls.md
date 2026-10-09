# Projects as a tree: hub pages, nested document URLs, internal notes

**Status (2026-10-09):** adopted. Built in steps (docs/systems/projects.md tracks which are live).

## Decision

1. **A project is a stable record with an optional parent.** `projects.id` survives saves (upsert by id or slug, no more wipe-and-reinsert), `projects.parent_slug` nests one project under another, depth two at most. The slug stays the link key everywhere (`documents.project_slug`, `project_files.project_slug`, `project_notes.project_slug`, `projects.parent_slug`); a slug rename cascades to every reference inside the save transaction, and a project with anything still under it cannot be deleted.
2. **Every project has its own page**: `/projects/<slug>`, a sub-project at `/projects/<parent>/<slug>`. The hub carries the project's status, tagline, summary, button, sub-projects, documents grouped by category, published files by folder, press and video. `/projects` becomes a card index. The old `#project-<slug>` anchors stay on the index cards.
3. **Documents under a project take nested URLs**: `/projects/<project path>/<slug>`. A document with no project keeps `/<slug>`. Slugs are unique per project (two projects may each have a `report`), and a document slug may not collide with a sub-project slug under the same parent or, at the root, with a fixed page.
4. **Short links survive.** `documents.short_path` (optional, one segment, e.g. `/alpr`) publishes as a 301 to the nested URL. Every publish also records `documents.live_path`; when a document's URL changes (moved project, renamed, nested for the first time) the next publish emits a 301 from the old path automatically, and an archived document's 410 lands on its last live path. All of this rides on the existing KeyValueStore sync; the redirects table is untouched.
5. **Project notes are internal.** `project_notes` (markdown body, title, folder, author, pinned) live only in the admin: typed in a text box or uploaded as `.md` / `.docx` (converted to markdown). Never rendered to the site. A note can be turned into a draft Document.
6. **Press unification is deferred.** Project articles/videos, `coverage_entries` and `blog_*` stay as they are until the tree, hub pages and notes are confirmed on staging.

## Why nested URLs (the user's call, over the author's flat vote)

Ranking signal from URL shape is negligible either way; `BreadcrumbList` JSON-LD drives the search-result breadcrumb, not the path. Nested wins on operations and structure: Search Console can report on `/projects/alpr/` as one campaign, sitelinks cluster under Projects, the URL tells a reader what a page is part of when pasted bare, deleting the last segment lands on the hub, and editors reason about one tree in the admin and on the site. Flat wins on memorability and zero migration. The short-path alias keeps the memorable form for press citation, so both are had. Cost accepted: a one-time 301 for the five live report URLs, and a redirect hop on every printed short link.

## Why slugs stay the link key (not `project_id`)

Switching every reference to ids would touch the files page, the document chooser, the render index, the export and the restore path at once. Stable ids plus a cascading rename give the same safety (no orphans on rename, no accidental re-parenting) with a fraction of the churn, and the URL is made of slugs anyway. If a foreign key is ever wanted, it is an ALTER plus a backfill from the existing slugs.

## Why `weber-county` stops being a project

The Weber County election-law complaint is one document of the license-plate investigation, not a campaign of its own (the owner's correction, 2026-10-09). The migration deletes the project row, nests the document under `alpr`, and gives it `short_path /weber-county` so the live link keeps working.

## Alternatives considered

- **Hub = the report itself** (project chrome around the main document, zero clicks to the report). Rejected: the hub also carries files, sub-projects and press, and the report would be the only document that cannot be moved or renamed.
- **Documents at `/projects/<slug>/` only, no short alias.** Rejected: press outlets have already printed `/alpr`.
- **Automatic redirects from a `redirects` table row per move.** Rejected: an admin would have to remember to add it. `live_path` makes the redirect a consequence of publishing.
- **Notes as HTML.** Rejected: the admin renders them with the safe mini-markdown renderer already used for the Development notes tab; HTML from a .docx would need the full ingest to be safe among admins.

## What breaks if reversed

- Dropping `parent_slug` orphans sub-projects (they render as top-level projects).
- Going back to wipe-and-reinsert on `projects` breaks the rename cascade: a slug change silently orphans every document, file and note under it.
- Removing the `live_path` bookkeeping leaves moved documents with no redirect; the old URL 404s.
- Rendering documents at `/<slug>` again collides with the short paths (a page and a 301 for the same path; the KeyValueStore wins and the page becomes unreachable).
