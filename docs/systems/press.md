# Press & coverage (2026-10-09)

One list of every story about the Compact. Where a story shows is derived at
render from three fields: its **project**, the **Homepage card** tick and the
**Hide from News & Media** tick. Decision record: docs/decisions/press-unification.md.

## Code Map

```
packages/db/press.js            PRESS_FIELDS, isOn, isVideo, normalizeUrl, itemKey,
                                unifyPress (the one-time merge of the legacy sources;
                                also saveContent's fallback for a schema ≤ 2 export)
packages/db/content-schema.js   press DDL (+ idx_press_project); the six legacy tables stay (empty)
packages/db/content.js          FIELD_MAPS.press (= PRESS_FIELDS); COLLECTION_TABLES blog /
                                coverage / homepage / projects → press (lastmod); loadContent
                                → content.press.items; loadHomepage no longer loads press;
                                PROJECT_CHILDREN = {} (no nested lists); saveContent writes press
                                (or unifies repo.blog/coverage/homepage.press from an old export);
                                PROJECT_SLUG_REFS includes press (rename cascade, delete guard)
packages/db/export.js           SCHEMA_VERSION 3; COLLECTIONS …, 'projects', 'press';
                                LEGACY_COLLECTIONS blog, coverage (read by restore only)
packages/render/press.js        derivePress(content): blog.articles/videos, homepage.press,
                                coverage['<slug>_coverage'], projects[].articles/videos
packages/render/site.js         buildSite runs derivePress FIRST (before the content checks)
aws/publish/render-db.js        derivePress before buildDocuments (the coverage strips)
templates/blog.html, index.html, project.html, partials/coverage-strip.html  unchanged shapes
apps/admin/lib/collections.js   COLLECTIONS.press (select / checkbox widgets, optionsFrom
                                'projects'); blog-*, coverage-*, HOMEPAGE_PRESS_FIELDS and the
                                projects' nested lists are gone
apps/admin/app/press/page.js    the editor (makeCollectionPage('press'))
apps/admin/app/list-editor.js   widget 'select' (static options or selectOptions[field]) and
                                'checkbox' ('1' / '')
apps/admin/app/collection-page.js  selectOptions for optionsFrom 'projects' (listProjects, indented)
apps/admin/app/homepage/page.js the press list is gone from the Homepage editor
apps/admin/lib/documents.js     coverageFromPress (editor preview + save validation);
                                coverageKeys = project slugs; authoring-kit route the same
packages/doc-blocks/schema.js   coverage block: "Project" select
scripts/migrate-press.mjs       the one-time unification (dry run / --apply / --force)
scripts/migrate-content.mjs, restore-from-export.mjs   press.json; legacy files accepted
content/press.json              the git/export copy (blog.json, coverage.json, homepage.press removed)
packages/db/test/press.test.mjs, packages/render/test/press.test.mjs
```

## Row

`type` ('' = article, `video`), `outlet`, `badge_color`, `date` (free text,
"newest first" uses `parseFreeDate`), `region`, `headline`, `excerpt`, `url`,
`read_more`, `lang_attr`, `youtube_id`, `embed_params`, `youtube_title`,
`project_slug` ('' = general), `featured` ('1'), `hide_from_news` ('1').
Strings only, like every collection; blanks are dropped on save.

## Placement rules (`derivePress`)

| where | rows |
|---|---|
| News & Media `/blog` | articles then videos, in list order, unless `hide_from_news` |
| homepage "Recent Coverage" | `featured`, first **three** in list order (`HOMEPAGE_CARDS`) |
| `{{coverage:<slug>}}` strip | **articles** whose `project_slug` is `<slug>` (any project slug is a valid key; an empty project renders an empty strip) |
| project hub | that project's articles ("In the Press") and videos ("On Television"), hidden-from-news ones included |

Order everywhere = the admin list order ("Sort newest first" reorders by date).

## Admin

**Press & coverage** (`/press`, Site Main): one sortable list with "Add from
link" (an outlet already in the list keeps its name and badge colour). Kind,
Project (sub-projects indented), Homepage card, Hide from News & Media. The
Homepage editor no longer has a press strip; the project list editor no
longer has nested press. A project's press is visible on its hub and in the
workspace's Folders & files tab (count + link).

Save: `press.save` (collection), lost-update stamp on the `press` table,
revision snapshot of the whole list, audit — the standard collection path.

## Migration (`scripts/migrate-press.mjs`)

Prerequisite `migrate-schema`. Dry run prints every resulting row with its
sources; `--apply` writes the rows (newest first), empties the six legacy
tables, records `press.save` + a `press-legacy/collection` revision holding
what they held. Merge rules: dedupe by normalised URL (host case, `www.`,
trailing slash, tracking params) or YouTube id; first source sets the
fields, later ones fill blanks, longest excerpt wins; a project source sets
`project_slug` (two projects → the first, reported); the homepage source sets
`featured`; a row with no project inherits the project of a row with the
same headline (the Cox interview video → alpr). Staging and prod: 32 legacy
rows → 14 press rows, 2026-10-09.

## Debugging

Saves: `[admin] <actor> press.save press/collection`. A `{{coverage:x}}`
token for a slug that is not a project fails `tokenErrors` on save and the
render on publish (`unknown coverage key`). To see placements:
`SELECT sort_order, type, project_slug, featured, hide_from_news, headline FROM press ORDER BY sort_order`.

## Not built

- A story under two projects (one `project_slug`).
- Dropping the six legacy tables (DDL kept; rows gone).
- Editing press from inside the project workspace (link to `/press`).
