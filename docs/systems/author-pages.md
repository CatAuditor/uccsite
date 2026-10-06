# Author pages — `/team/<slug>` (2026-10-05)

One page per team member listing everything they wrote on the site, with
`Person` structured data that every bylined page points back at. Purpose:
SEO for people — a search for a team member's name should surface their
Utah Civic Compact work, not only older press. The byline "By X" everywhere
on the site is now a link to that person's page.

## Code Map

```
packages/render/site.js        PAGES entry { template: 'team-member.html', each: 'members', dir: 'team' }
                               slugify / memberSlug / authorIndex — the ONE slug + Person @id rule
                               deriveTeam(content) — slug, page_url, links[], works[], meta_description,
                                 jsonld per member; author_url on statements/projects/issues items;
                                 team.org_members_json / org_sameas_json for the homepage Organization
                               expandPages(pages, content) — the `each` entry → one page per member
templates/team-member.html     the author page (head generated from member fields; {{{jsonld}}})
css/pages/team-member.css      its styles
templates/team.html            name + "All work by X →" link to the author page
templates/statements|projects|issues.html   byline = link when author_url is set
templates/alpr|stratos|weber-county|how-did-this-happen|dignity-index-statement.html
                               hardcoded byline link + JSON-LD author Person with @id (git build only;
                               on the database render these pages are Documents — see below)
templates/index.html           Organization JSON-LD: @id, logo, sameAs, member[] (+ og:image)
packages/render/documents.js   jsonldBlock(doc, …, authors): doc.author → Person (with @id/url when
                               the name is a team member); datePublished from published_at
aws/publish/render-db.js       passes authorIndex(team) to buildDocuments and content.documents_index
                               (published Documents: slug, title, author, category, date) to buildSite
packages/db/content.js         FIELD_MAPS.team_members + slug, links
packages/db/documents.js       DOCUMENT_FIELDS + author
packages/db/content-schema.js  ALTER TABLE team_members ADD slug, links; ALTER TABLE documents ADD author
apps/admin/lib/collections.js  Team editor fields: Author page URL slug, Public profile links
apps/admin/app/documents/      Document editor: Author field (saved in actions.js)
scripts/backfill-authors.mjs   one-time: author + linked byline on the five migrated long-form Documents
build.js                       mkdir for nested outputs (team/<slug>.html)
aws/publish/inputs.js          pageInputFiles reads page.source for expanded pages (lastmod)
```

## URL and identity

- Page: `https://utahciviccompact.org/team/<slug>`. `<slug>` = `team_members.slug`
  if set, else `slugify(name)` (`Jarom Gillins` → `jarom-gillins`). CloudFront's
  viewer-request function rewrites the extensionless path to `team/<slug>.html`
  (last segment has no dot) — no infra change was needed.
- Person `@id` = `<page url>#person`. Every `Article` JSON-LD on the site whose
  author is a team member uses that `@id` (fixed templates hardcode it; Documents
  get it from `authorIndex` by exact name match). The homepage `Organization`
  lists the same `@id`s under `member`. One identifier → one entity for search
  engines.
- `sameAs` on the Person = the member's **Public profile links** (one URL per
  line; only `http(s)` lines are kept). This is the field that merges "the
  candidate" and "the policy director" into one person in Google's graph. It is
  empty until an editor fills it in (admin → Team & Bios).

## What a member's page lists (`works`)

Everything whose `author` equals the member's name exactly, deduped by clean URL:

| Source | Fields used | Kind label |
|---|---|---|
| `projects` (`author`) | name, date, cta_url | Investigation |
| `documents_index` (DB render only; published Documents with `author`) | title, category, slug, datePublished override or published_at | the document's category, else Report |
| `statements` (`author`) | title, date, url or `/statements#slug` | Statement |
| `issues` (`author`) | title, `/issues#slug` | Policy position |

The git/local build has no `documents_index`, so locally the long-form pages
appear only through the statement/project that points at them. Production
renders from the database and lists them directly.

## Editing

- **Team & Bios** editor: two new fields — *Author page URL slug* (optional)
  and *Public profile links*. The author page itself needs no action; it is
  built from the bio.
- **Documents** editor: new *Author* field (the team member's full name as it
  appears on the Team page). A mismatch (nickname, missing middle initial)
  still renders a Person, just without the `@id` link — and the piece is
  missing from the author page.
- `/profile` self-service still edits bio/title/headshot only; links and slug
  are Team-editor fields.

## Hard constraints

- Name match is exact (trimmed). Renaming a member on the Team page silently
  detaches every piece bylined under the old spelling — update the `author`
  fields too.
- A document slug cannot be `team` (fixed-page slugs are reserved in the editor)
  and cannot contain `/`, so it cannot collide with `team/<slug>`.
- `team_members.slug` is not validated beyond `slugify`; two members slugifying
  to the same value would overwrite each other's page (the later wins). Keep
  names distinct or set slugs explicitly.
- Golden tests: the four `team/*.html` outputs are listed in
  `packages/render/test/expected-diffs.json`; the page/sitemap counts in
  `parity.test.mjs` use `expandPages(PAGES, deriveTeam(content))`.

## Rollout steps (done 2026-10-05 unless marked)

1. `node scripts/migrate-schema.mjs --env staging|prod` — adds the three columns.
2. `node scripts/backfill-authors.mjs --env staging|prod` — authors + linked bylines on the five Documents.
3. `cdk deploy` both stacks — the publish Lambda bundles `templates/` (new `team-member.html`).
4. Publish (admin two-person rule for prod).
5. Editors: fill *Public profile links* for each member (docs/seo-plan.md).
