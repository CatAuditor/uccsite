# Petitions — one record per petition, filed under a project

Built 2026-10-05 as a single campaign (one JSON group on the homepage);
rebuilt 2026-10-10 as a **collection**: every petition is its own row, always
belongs to a **project**, has its own page under that project, and several
can be open at once. The one open petition ticked **featured** takes over the
homepage hero. Decision record: docs/decisions/petitions-collection.md
(supersedes docs/decisions/petition-copy-in-homepage-group.md).

## Code Map

```
packages/db/petitions.js        PETITION_FIELDS, PETITION_STATUSES, listPetitions({ids}), getPetition,
                                validatePetition (pure), savePetition (insert/update + every rule),
                                deletePetition (refused while signed)
packages/db/content-schema.js   petitions DDL (+ unique slug index, idx_petitions_project)
packages/db/content.js          FIELD_MAPS.petitions; COLLECTION_TABLES homepage/projects/petitions
                                (lastmod); loadContent → content.petitions.items; saveContent
                                restores petitions.json; PROJECT_SLUG_REFS (rename cascade, delete
                                guard); HOMEPAGE_GROUP_COLS no longer carries `petition`
packages/db/export.js           SCHEMA_VERSION 4; COLLECTIONS + 'petitions' → content/petitions.json
packages/db/schema.js           petition_signatures DDL + API grants; GRANT SELECT ON petitions
packages/render/petitions.js    petitionUrl, petitionShare, petitionDonate, derivePetitions (THE
                                derive step: pages, thanks pages, the hero, the hub cards, /petitions)
packages/render/site.js         PAGES: petitions.html (index), petition.html × each open/closed
                                petition (dir projects, pathKey path), petition-thanks.html × each
                                open one (sitemap: false); derive chain … deriveProjectTree →
                                derivePetitions → deriveTeam
templates/petitions.html        /petitions — every open petition as a card, closed ones listed
templates/petition.html         /projects/<project path>/<slug> — the signature form (open) or the
                                closed panel (closed); canonical + OG per petition
templates/petition-thanks.html  /projects/<project path>/<slug>/thanks — thank-you + payment modal; noindex
templates/partials/petition-share.html   share buttons (open petitions only)
templates/index.html            hero: petition takeover while `petition` (the featured one) is set;
                                the CTA links to the petition's own page
templates/project.html          {{#petitions}} card per open petition filed here; "Closed petitions" list
css/pages/petition.css          petition + thank-you pages; css/pages/petitions.css the index;
                                css/pages/projects.css .hub-petition*
js/petition.js                  form → POST /api/petition → data-thanks-url; the thanks modal
                                (POST /api/create-checkout-session, source 'petition:<slug>'); the
                                counter ([data-petition-count] ← GET /api/petition/count); share
                                sheet + Copy link. Loaded by index, petitions, petition pages, hubs
aws/api/routes.js               petitionSign() — POST /api/petition (files the signature under the
                                petition's project; 409 when the petition is closed; dispatches the
                                thank-you on a first signature); petitionCampaign() — the petition
                                row + project + url/thanks_url (per-container cache, 5 min);
                                petitionThanksJob(); petitionCount() — GET /api/petition/count
aws/api/emails.js               buildPetitionThanksEmail — Share → the petition's page, Chip in →
                                its thank-you page (fallbacks /petitions, /#donate)
aws/publish/render-db.js        petitionRedirects: /petition and /petition-thanks → the featured
                                petition (else /petitions), written with the document redirects;
                                refuses a render where a document and a site page share an address
apps/admin/app/petitions/page.js        the list (status, hero, address, Utah/outside counts),
                                orphaned signature slugs, CSV of everything, "New petition"
apps/admin/app/petitions/[id]/page.js   one petition: record, copy (grouped), thank-you email
                                picker, signatures + CSV, delete (while unsigned)
apps/admin/app/petitions/actions.js     createPetition / savePetition / deletePetition (editor+,
                                one transaction, lost-update stamp, revision, audit)
apps/admin/app/petitions/export/route.js   POST → CSV (audited `petition.export`)
apps/admin/app/petition/page.js         redirects to /petitions (old bookmarks)
apps/admin/lib/collections.js   PETITION_FIELDS / PETITION_FIELD_GROUPS / PETITION_RECORD_FIELDS +
                                boot drift guard against FIELD_MAPS.petitions
apps/admin/lib/hero-status.js   draftHero(homepage, petitions) — the featured open petition
apps/admin/lib/change-detail.js "What will change": entity `petition` (row diff), section Petitions
apps/admin/app/revisions/page.js  restore a `petition` revision (re-runs every save rule)
apps/admin/lib/projects.js      workspace() → petitions filed under the project (+ counts)
apps/admin/app/documents/actions.js   validateAddress refuses a document slug a petition holds
packages/db/publish-requests.js CONTENT_ACTION_RE counts petition.create / save / delete
scripts/migrate-petitions.mjs   one-time: homepage.petition → the first petitions row
content/petitions.json          the git/export copy ({ items: [...] })
packages/db/test/petitions.test.mjs, packages/render/test/petitions.test.mjs, aws/api/test/api.test.mjs
```

## Model: table `petitions`

Strings only, blanks dropped on save (every collection's convention).

| Field | Meaning |
|---|---|
| `slug` | `^[a-z0-9][a-z0-9-]{0,63}$`, **unique across every project** (signatures key on it alone; `thanks` reserved). **Locked once anyone has signed** — close the petition and start a new one instead |
| `project_slug` | **required**; a `projects.slug`. Renaming a project cascades; a project cannot be deleted while a petition points at it |
| `status` | `draft` (not on the site; the public route treats the slug as unknown) · `open` (page + form, on the hub and /petitions, in the sitemap) · `closed` (page stays with the count and a "closed" panel, noindex; the API answers 409) |
| `featured` | `'1'` = the homepage hero. Only one at a time (ticking it un-ticks the rest); only an open petition may carry it |
| `label`, `headline` (HTML, `<em>` = red), `body`, `cta`, `cta_secondary`, `cta_secondary_url`, `count_label` (`{count}` = Utah signatures) | the petition page, the hub card, the hero |
| `form_title` (also `<title>` / og:title), `form_intro`, `consent` | the sign-up panel |
| `closed_body` | the closed panel's text (default: "Thank you to everyone who signed…") |
| `thanks_title`, `thanks_body`, `thanks_cta`, `thanks_dismiss` | the thank-you page |
| `donate_*` | the payment window — "Donation ask" below |
| `share_title`, `share_text`, `share_image` | "Sharing" below |

Index `(project_slug, sort_order)`, unique `(slug)`. The homepage's old
`petition` column stays in the table as the pre-migration backup; nothing
reads it.

## Addresses

| thing | address |
|---|---|
| index | `/petitions` (open petitions as cards, closed ones listed) |
| petition | `/projects/<project path>/<slug>` — `petitionUrl` (a sub-project's petition: `/projects/<parent>/<sub>/<slug>`) |
| thank-you | `/projects/<project path>/<slug>/thanks` (open petitions only; noindex, not in the sitemap) |
| before 2026-10-10 | `/petition` → 301 to the featured petition (else `/petitions`); `/petition-thanks` → its thank-you page (`petitionRedirects`, KeyValueStore, DB render only) |

A petition slug may not equal a document slug or a sub-project slug under the
same project, and a document may not take a petition's address
(`savePetition` and `validateAddress` refuse both directions; the DB render
refuses a page two things claim).

## Render (`derivePetitions`)

After `deriveProjectTree` (needs each project's path/url). Drafts and rows
whose project is unknown are dropped. Each remaining petition gets `url`,
`abs_url`, `thanks_url`, `path`, `thanks_path`, `project {name, url}`,
`is_open` / `is_closed` / `is_featured`, `page_title`, `headline_text`,
`share`, `donate`. Then:

- `petitions.pages` (every open/closed one) and `petitions.thanks_pages`
  (open only) — `expandPages` renders `petition.html` / `petition-thanks.html`
  once per item to `projects/<path>.html`; each item is `{ slug, path, petition }`
  so the templates read `petition.*`. Nav state = Projects.
- `petitions.open` / `petitions.closed` (+ `has_*`) — `/petitions`.
- `homepage.petition` = the featured open petition (the hero); absent otherwise
  (a stale `homepage.petition` group from before the migration is dropped).
- every project: `petitions` (open, filed here → the dark card with the Utah
  counter and sign button), `closed_petitions` (links), `has_*`.

## Data flow

1. Visitor opens a petition page (from the hero, the hub, /petitions or a
   shared link). The form posts JSON to `POST /api/petition` with the slug
   from `data-petition`; on `{ok:true}` the page stores `{petition, firstName,
   lastName, email, zip}` in sessionStorage and goes to `data-thanks-url`.
2. The API validates, rate-limits (20 / IP / hour), checks Turnstile when
   keyed, then: reads the petition (`petitionCampaign`: `SELECT * FROM
   petitions` + `projects`, cached 5 min; open and closed rows only) —
   **closed → 409**, unknown/draft → recorded without a project (as before
   the collection); checks for a prior signature (decides the email); upserts
   `petition_signatures` on `(petition, email)` with the petition's
   `project_slug`; upserts `subscribers` without overwriting details. First
   signature → self-invoke job `petition-thanks`. A Utah ZIP clears the count cache.
3. The thank-you page's "I can help" posts to `/api/create-checkout-session`
   with `source: 'petition:<slug>'` (Stripe metadata); "Not this time" → `/`.

## Residency and audiences

Unchanged: residency is derived from the ZIP (`packages/db/audience.js`,
84xxx = Utah), the public counter is Utah-only and event-driven
(`invalidateCount` on a Utah signature; `COUNT_TTL_MS` bounds other warm
containers), the admin splits Utah / outside, the Mailing list and
`scripts/send-periodical.js --petition <slug>` share one audience query.

## API

**`POST /api/petition`** — body `{ petition, firstName, lastName, email, zip, address?, phone?, turnstileToken? }`

| Status | When |
|---|---|
| 200 `{ok:true}` | recorded (new or re-sign) |
| 400 | malformed body; bad slug; missing names; bad ZIP; invalid email |
| 403 | Turnstile failed (when `TURNSTILE_SECRET_KEY` is set) |
| 409 | the slug is a **closed** petition ("This petition has closed…") |
| 429 | over 20 / IP / hour |
| 500 | insert failed — logs `[api] petition insert failed: <ErrorName>` |

**`GET /api/petition/count?petition=<slug>`** → `{petition, count}` (Utah
only), 400 bad slug, 500 DB error. Unchanged.

API role grants: `petition_signatures` SELECT/INSERT/UPDATE; `petitions`,
`projects`, `homepage` SELECT (docs/systems/api-security.md).

## Table: `petition_signatures`

Unchanged: `id, petition, first_name, last_name, email, zip, address, phone,
project_slug, created_at, updated_at, UNIQUE (petition, email)`. `project_slug`
is copied from the petition row at sign time, so a signature keeps its project
if the petition later moves.

## Admin

- **Petitions** (Site Main, `/petitions`, editor+): the hero status block
  (live vs saved — the saved side is the featured open petition), one row per
  petition (slug + headline, project, status, homepage hero, address, Utah /
  outside counts), signature slugs that have no record (older campaigns —
  still in the CSV), **Download CSV** (everything), **New petition** (project,
  slug, headline → a draft, then its editor). Audit `petition.create`.
- **One petition** (`/petitions/<id>`): status line (open / closed / draft,
  the address, the project); signatures for this slug with the residency
  filter and CSV (audit `petition.export`); **Thank-you email** picker
  (trigger `petition-thanks` — one email for every petition; `{headline}`
  and `{project_name}` fill per petition); the record (slug — read-only
  once signed —, Project dropdown, Status, **Show in the homepage hero**);
  the copy in five groups (The petition, Sign-up form, Thank-you page,
  Payment window, Sharing); **Save petition** (lost-update stamp = the
  `petitions` table stamp; audit `petition.save`, revision = the row
  before); **Delete** while nobody has signed (audit `petition.delete`).
- **Project workspace** → Overview: the petitions filed here (status, hero,
  counts, link to each) and "Start a petition for this project"
  (`/petitions?project=<slug>` preselects it).
- **Homepage**: the hero fields are the standing hero; the notice points at
  Petitions for the takeover.
- **Publish & Status → What will change**: a `petition` entity row per
  saved petition (field diffs; created / removed), section **Petitions**.
- **Revisions**: a `petition` revision restores the row (every save rule
  re-runs, so a restore cannot reopen a slug clash or un-pin a signed slug).
- **Mailing list / Subscribers**: unchanged (`petitions` column = slugs signed).

CSV columns unchanged: `petition, project, first_name, last_name, email, zip,
utah_resident, address, phone, signed_at_utc`.

## Sharing

`templates/partials/petition-share.html` on open petition pages (hero) and
thank-you pages. Links built by `petitionShare` (pure): message = `share_text`
else the headline with tags stripped; `url` = the petition's own page;
preview image `share_image` if a `/media|/assets` png/jpg/webp, else
`/assets/share-default.png`; `summary_large_image`; page title =
`form_title` + " | Utah Civic Compact". Closed petitions have no share block.

## Donation ask

`petitionDonate(p)` — unchanged rules: `donate_amounts` (dollars, $1–$100,000,
de-duplicated, max six, fallback 10/25/50/100), `donate_default`,
`donate_frequency` (`both` / `one-time` / `monthly`), `donate_default_frequency`,
copy fields; an **Other** amount is always offered; monthly sends
`type: 'subscription'`.

## Thank-you email

docs/systems/email.md. First signature only, self-invoke job; the attached
automatic email or the built-in body (headline, project link, **Share → the
petition's page**, **Chip in → its thank-you page**; `/petitions` and
`/#donate` when the project is missing).

## Migration (`scripts/migrate-petitions.mjs`)

Prerequisite `migrate-schema` (creates `petitions`, grants the API role).
Dry run by default; `--apply` turns `homepage.petition` into one row
(status `open` when it had a headline, `featured` ticked, the old
`/alpr.html` secondary link → `/projects/alpr/report`), audited as
`petition.create` by `scripts/migrate-petitions`; `--force` replaces existing
rows. The homepage column is left as the backup. Then redeploy the stack (the
publish Lambda bundles the templates; the API Lambda reads the new table) and
publish from the database. **Staging: applied 2026-10-10** (row
`b0ae614f…`, 2 signatures carried over, staging published from the DB with
the new pages and the two 301s). **Prod: pending** (docs/for-conner.md §11).

## Turning one off / starting the next

- Close: Status → closed, save, publish. The page stays (noindex) with the
  final count; the form is gone; the hero returns to the standing hero if it
  was featured. Signatures stay.
- Next: New petition under its project → fill the copy → Status open (+ hero
  tick if wanted) → save → publish.

## Debug

Browser: `[petition] sign failed: <status>` (409 = closed), `[petition] sign
network error`, `[petition] checkout failed`, `[petition] count unavailable`.
API: docs/error-handling/debug/api.md (`petition campaign lookup failed`
now means the `petitions` / `projects` read failed). Admin: `[admin] action
failed: <message>` for refused saves (slug clash, locked slug, missing project).

## Not built (deliberate)

- No IP / user-agent with a signature. No nav link (hero / hubs / /petitions
  are the entry points). No per-petition thank-you email (one trigger; the
  placeholders carry the petition). No list-order editor (sort_order =
  creation order; the index and hubs follow it).
