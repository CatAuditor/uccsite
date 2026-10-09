# Projects — the tree, hub pages, nested documents, workspace (2026-10-09)

A project is a stable record that can sit inside another project (two
levels). Every project has its own page on the site (`/projects/<slug>`, a
sub-project at `/projects/<parent>/<slug>`), the documents under it publish
at `/projects/<path>/<slug>`, and the admin gives each project a
**workspace**: its record, a folder tree of files and internal notes, and an
activity log. `/projects` is a card index; the homepage "Active Fights"
cards list the top-level projects. Decision record:
docs/decisions/project-tree-nested-urls.md.

## Code Map

```
packages/render/projects.js     THE tree logic (pure): projectOf (project_slug only),
                                projectPath / projectUrl, documentUrl, projectAnchor,
                                validateProjectTree (slugs, parents, depth 2),
                                deriveProjectTree (hub data + top_projects)
packages/render/site.js         PAGES: project.html rendered once per project to
                                projects/<path>.html (expandPages `pathKey`); derive chain
                                … → deriveProjectFiles → deriveProjectTree → deriveTeam;
                                navFields gets the top-level projects (auto dropdown);
                                deriveTeam works: project → hub url, document → d.url
packages/render/navigation.js   header item { auto: 'projects' } → dropdown "All projects"
                                + one entry per top-level project (docs/systems/navigation.md)
packages/render/documents.js    nested document addresses, canonical, BreadcrumbList +
                                isPartOf, siblings in the foot bar (docs/systems/documents.md)
packages/render/writing.js      documents_index url
packages/db/content-schema.js   projects + parent_slug, summary; project_notes; documents
                                short_path / live_path, unique index (project_slug, slug)
packages/db/content.js          FIELD_MAPS.projects (+ parent_slug, summary);
                                loadProjects(client, { ids }); replaceProjects: upsert by
                                id/slug, rename cascade (PROJECT_SLUG_REFS), delete guard,
                                validateProjectTree; children wiped + re-inserted
packages/db/project-notes.js    listNotes/getNote/upsertNote/deleteNote/noteCounts
packages/db/project-files.js    listPublishedFiles (by slug) → each hub's "Files"
aws/publish/render-db.js        documents_index carries url; fixed templates dropped for
                                every claimed address; documentRedirects (short + previous
                                live paths → 301) computed before live_path is overwritten
templates/project.html          the hub page (hero crumbs, meta, button, intro, parts,
                                documents by category, files, press, video, foot nav)
templates/projects.html         the card index (filters/sort as before, id="project-<slug>"
                                anchors kept so old #project links still land)
templates/index.html            {{#top_projects}} cards, name → hub
css/pages/projects.css          hub + card styles (.hub-*, .project-parts, .project-name-link)
js/projects.js                  unchanged client filter/sort over the cards
apps/admin/lib/files.js         listProjects → tree order, { id, slug, name, parentSlug,
                                path, url, label (indented), isSub, status }
apps/admin/lib/projects.js      workspace(client, slug) (record, parent, children,
                                documents + url, files, notes, folders), activity(),
                                noteUploadToMarkdown (.md verbatim, .docx via mammoth)
apps/admin/lib/collections.js   COLLECTIONS.projects fields (+ parent_slug, summary)
apps/admin/lib/collection-save.js  sanitizeItems keepIds for the nested spec; loadCollectionItems
                                loads projects WITH ids
apps/admin/app/projects/page.js tree table (counts, workspace links) + the list editor
apps/admin/app/projects/[slug]/page.js      workspace tabs: Overview · Folders & files · Notes · Activity
apps/admin/app/projects/[slug]/actions.js   saveProject, createNote, saveNote, deleteNote, noteToDocument
apps/admin/app/projects/[slug]/notes/[id]/page.js  one note: edit / preview / pin / delete / → document
apps/admin/app/documents/page.js            address column, bulk "Move to project"
apps/admin/app/documents/actions.js         validateAddress (slug unique per project, no clash with
                                a sub-project or a fixed page, short path), assignDocuments
scripts/migrate-project-tree.mjs   the one-time data migration (see "Migration")
packages/render/test/projects.test.mjs, packages/db/test/redirects.test.mjs, navigation.test.mjs
```

## Model

| table / column | meaning |
|---|---|
| `projects.id` | STABLE across saves since 2026-10-09 (`replaceProjects` upserts) |
| `projects.slug` | the link key everywhere; renaming cascades to `documents.project_slug`, `project_files.project_slug`, `project_notes.project_slug` and the payload's `parent_slug`s inside the save transaction |
| `projects.parent_slug` | '' / NULL = top-level; a top-level project's slug = sub-project (a sub-project cannot have children) |
| `projects.summary` | markdown intro for the hub (`summary_html`) |
| `documents.project_slug` | '' = none (never NULL: the unique index is on `(project_slug, slug)`, and NULLs are distinct) |
| `documents.short_path` | optional `/one-word` alias, published as a 301 |
| `documents.live_path` | the path the last successful publish wrote (`markDocumentLive`); the next publish 301s from it if the URL changed |
| `project_notes` | id, project_slug, folder, title, body_md, source_filename, pinned, author (admin email), created/updated |

`deleting a project`: refused (list editor or Overview) while any document,
file or note still points at it — the message names the counts. Sub-projects
in the same payload that would be orphaned fail `validateProjectTree`
("parent is not a project").

## Addresses

| thing | address |
|---|---|
| project index | `/projects` |
| project | `/projects/<slug>` |
| sub-project | `/projects/<parent>/<slug>` |
| document under a project | `/projects/<project path>/<slug>` (`documentUrl`) |
| document with no project | `/<slug>` |
| short path | `/<word>` → 301 to the document's address |
| moved / renamed document | previous `live_path` → 301 (automatic on the next publish) |
| archived document | 410 at its last live path (and its short path) |

Slugs are unique per project (`alpr/report` and `stratos/report` coexist).
A document slug may not equal a sub-project slug under the same parent, and a
root document keeps clear of the fixed pages (`RESERVED_SLUGS`). The
renderer refuses a path two things claim. A stored canonical that names one
of the page's own aliases is ignored (the address wins).

## Site

- **Hub** (`templates/project.html`, data from `deriveProjectTree`): hero with
  breadcrumb (Projects › parent › this), status / region / date, "Led by"
  (author page link when the lead is a team member), the button (`cta_url`,
  normally the main report), the intro (`summary_html`), **Parts of this
  project** (sub-projects), the published documents **grouped by category**
  (title, date, summary; DB render only — the git build has no index),
  **Files** (published project files by folder), **In the Press** / **On
  Television** (the project's child lists), a foot nav (parent, all projects).
  Head: title, tagline as description, canonical, OG; JSON-LD `@graph` of a
  `CollectionPage` (`isPartOf` the parent, `hasPart` children + documents) and
  a `BreadcrumbList`.
- **Index** (`templates/projects.html`): one card per top-level project
  (status/region/date, name → hub, tagline, byline, its sub-projects, "Open
  the project" + the project's own button). Filter/sort controls unchanged.
- **Homepage**: `top_projects` cards; the name links to the hub, the link line
  keeps the project's button text/URL (blank → "Open the project" → hub).
- **Documents**: address, canonical, `isPartOf`, `BreadcrumbList`, and the
  foot bar: path (Projects › parent › project › this), **More in <project>**
  (its other published documents), "Everything in <project> →". Nav state: a
  nested document lights **Projects**.
- **Header menu**: the Projects item lists the live top-level projects
  underneath (navigation.md "auto").
- **Author pages / Writing**: project → hub URL, document → nested URL.

## Admin

- **Projects** (`/projects`): the tree table (address, status, counts of
  documents / files / notes, "On the site") → each project's workspace;
  orphan warnings; then the list editor (add a project, reorder, bulk fields,
  press/videos). The editor carries each row's `id`, so a slug edit is a
  rename, not a delete + create.
- **Workspace** (`/projects/<slug>`):
  - *Overview*: the record (name, slug, date, lead, status + colour, region,
    button, **Part of** select — disabled when the project has sub-projects —,
    tagline, intro). Saves through `replaceProjects` with the whole list, so
    the rename cascade and the tree validation apply; lost-update stamp =
    the `projects` table stamp (the list editor shares it, so the two
    editors cannot overwrite each other silently).
  - *Folders & files*: sub-projects; documents by category with address and
    status; the file uploader (project preselected); one block per folder
    (root first, nested folders indented) listing notes (📝) and files (📄)
    with size / public state / who / when. Publish, unpublish, move and
    delete files stay on the Files page.
  - *Notes*: new note (title, folder, optional `.md`/`.txt`/`.docx` upload,
    Markdown body, pin) and the list with rendered previews. Notes are
    **internal**: never rendered to the site, not in the content export.
    `.docx` → markdown via `mammoth.convertToMarkdown` (images dropped);
    the first `# heading` becomes the title when the title is blank.
    Rendering uses `lib/mini-markdown.mjs` (escape-first; safe among admins).
  - *Activity*: audit rows for this project's documents, files and notes and
    the `projects` collection saves.
  - *Note page* (`/projects/<slug>/notes/<id>`): editor + preview, move to
    another project/folder, pin, delete, **Start a document from this note**
    (markdown → blocks → draft builder document under the project).
- **Documents list**: address column (+ short path), project link, tick
  rows + "Move the ticked documents to" (each move validated and audited as
  `document.move` with a revision). **Editor**: Project select (sub-projects
  indented), the resulting address in the hint, **Short link** field, the
  SERP preview shows the nested path.
- **Files**: project tabs indent sub-projects; the uploader/move selects use
  the indented labels.
- **Menus**: a header link can "List the live projects underneath".

Audit actions: `projects.save` (list editor, Overview, migration),
`document.move`, `note.create` / `note.save` / `note.delete`,
`document.create` (with `fromNote`). Logs: `[projects]` — docs/error-handling/debug/projects.md.

## Migration (`scripts/migrate-project-tree.mjs`)

Prerequisite `migrate-schema` (columns, `project_notes`, drops
`documents_slug_key`, adds `idx_documents_address`). Dry run by default;
`--apply` runs in one transaction with a revision + `document.move` audit row
per changed document:

1. NULL `project_slug` → `''`;
2. the `weber-county` project is deleted (press moved to `alpr`; refused if it
   still has files/notes);
3. `alpr` → `alpr/report` (short `/alpr`), `stratos` → `stratos/report`
   (`/stratos`), `weber-county`, `how-did-this-happen`,
   `license-plate-has-a-price` → under `alpr` with their old paths as short
   paths; every other published document records `live_path = /<slug>`;
4. canonicals naming a document's own old address are cleared;
5. the two project buttons point at the reports' new addresses.

Then publish from the database. The first publish removes 9 objects (the
old pages + their CSS), which trips the bulk-delete guard: run it from the
repo with `--allow-bulk-delete` (an admin-triggered publish would be
refused). **Staging: done 2026-10-09** (old URLs 301, hubs 200, sitemap
nested, canonicals nested, JSON-LD verified). **Prod: pending `[go]`**
(docs/for-conner.md §14).

## Debugging

`[projects] note created <id> in <slug> [from "<file>"]` on note creation.
Saves log through `[admin] <actor> projects.save projects/collection`,
`document.move`, `note.*`. A publish lists every document redirect it
writes (`[publish] redirects: N document redirect(s) → 301: …`) and every
410 path. To see what the tree thinks: `SELECT slug, parent_slug, sort_order
FROM projects ORDER BY sort_order` and `SELECT slug, project_slug, short_path,
live_path FROM documents`.

## Not built / deferred

- Press unification (project articles/videos + coverage entries + News &
  Media in one table) — after the tree is confirmed on prod.
- Publish/unpublish/move files from inside the workspace (links to Files).
- A top-of-page breadcrumb on documents (the hero sits under the fixed nav);
  the breadcrumb and sibling list are in the foot bar.
- Project members (lead is the free-text `author`).
