# Projects (spec §3.1 nested collection — Phase 9)

A project is a structured record with two nested child lists (press
articles, videos). One collection feeds two pages: `/projects` (the generated
project index) and the homepage "Active Fights" cards. Publishing the
collection updates both.

## Code Map

```
packages/db/content-schema.js   projects, project_articles, project_videos
packages/db/content.js          loadProjects (nested shape = projects.json),
                                replaceProjects (parent + children in ONE
                                transaction; tx:false when the caller owns it),
                                used by loadContent / saveContent
apps/admin/lib/collections.js   COLLECTIONS.projects: nested: true, fields with
                                widget 'list' (articles, videos) + childTables;
                                boot-time drift guard covers the child tables
apps/admin/lib/collection-save.js  sanitizeItems recurses into list fields;
                                loadCollectionItems/saveCollection use
                                loadProjects/replaceProjects for nested specs
apps/admin/app/list-editor.js   recursive editor (nested lists inside an item),
                                top-level filter box, Sort A–Z / newest first
apps/admin/app/projects/page.js makeCollectionPage('projects')
apps/admin/app/revisions/page.js  restore of a projects snapshot → replaceProjects
packages/render/site.js         deriveProjectFilters: project_statuses,
                                project_regions (distinct, first-seen order),
                                date_ts per project (Date.parse of the free-text
                                date; '' when unparseable)
templates/projects.html         filter/sort controls (hidden until JS runs),
                                data-name/status/region/date on each block;
                                {{#files}} list of published project files
                                (docs/systems/files.md — DB render only)
js/projects.js                  client-side filter (status, region) + sort
                                (featured order = admin order, newest, A–Z)
css/pages/projects.css          control styling
```

## Editing

The admin list order IS the site order (featured order on `/projects`, card
order on the homepage). "Sort A–Z" / "Sort newest first" reorder the list
before saving; the filter box only narrows what is shown. Saves follow the
collection rules (one transaction, baseline lost-update stamp on the
`projects` table, revision snapshot of the whole nested tree, audit).

Dates are free text ("August 2026", "June 4, 2026"); "newest first" on the
site (server-computed `date_ts`) and in the admin (client-side) both use
`packages/render/dates.js` `parseFreeDate` — month-year, month-day-year,
ISO, or a bare year; unparseable dates sort last. Blank nested entries are
dropped on save. `PROJECT_CHILDREN` in packages/db/content.js is the single
mapping of child list → table; the collections drift guard asserts the
editor's list fields equal it and every child field matches `FIELD_MAPS`.

## Site behaviour

Without JavaScript the page is the plain featured-order list (controls stay
`hidden` — `css/styles.css` has `[hidden] { display: none !important }` so an
author `display` rule cannot un-hide them). With it, `js/projects.js` reveals the controls, filters by exact
status/region values (the option lists come from the content), re-orders the
blocks in the DOM, and announces "N of M projects". No inline styles or
scripts (CSP `script-src 'self'`, `style-src 'self'`).

## Debugging

No runtime logging: the site script is pure DOM state, the editor is client
state serialized into the `payload` hidden input, and saves log through
`[admin] <actor> projects.save` (docs/error-handling/debug/admin.md).

## Status

Built 2026-09-13; staging published, parity OK. Published project files
(admin Files page) list under each block since 2026-09-13. Not yet:
per-project detail pages (projects link to their report Document via
`cta_url`).
