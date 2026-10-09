# Petition — campaign hero, signature form, follow-up ask

Built 2026-10-05 for the UDOT ALPR special-use-permit petition; designed so the
NEXT campaign is a copy change, not a code change. One campaign is live at a
time (the one whose copy is in `homepage.petition`); signatures from past
campaigns stay in the table under their own slug. Since 2026-10-09 a campaign
is **filed under a project** (`project_slug`) and every first signature gets
a **thank-you email** (docs/systems/email.md).

## Code Map

```
templates/index.html            hero: petition takeover while petition.headline is set,
                                the standing hero otherwise ({{#petition.headline}} / {{^…}})
templates/petition.html         /petition — the signature form (settings + homepage content);
                                "no petition is open" fallback when the headline is blank
templates/petition-thanks.html  /petition-thanks — thank-you + "I can help" payment modal
                                ($10 / $25 ✓ / $50 / $100, one-time); noindex, not in sitemap
css/pages/petition.css          both petition pages + the modal's 4-up tiers
css/pages/index.css             .hero-petition / .hero-eyebrow (hero takeover)
js/petition.js                  form controller (POST /api/petition → /petition-thanks), the
                                thanks modal (POST /api/create-checkout-session, onetime,
                                source 'petition:<slug>'), and the signature counter
                                ([data-petition-count] ← GET /api/petition/count); signer
                                details ride in sessionStorage ('petition-signer') only to
                                prefill the checkout. Loaded by index, petition, petition-thanks
content/homepage.json           `petition` group — the git/local copy of the campaign text
packages/db/content.js          HOMEPAGE_GROUP_COLS gains ['petition','petition']
packages/db/content-schema.js   ALTER TABLE homepage ADD COLUMN petition TEXT (JSON group)
packages/db/schema.js           petition_signatures DDL + api grants (SELECT, INSERT, UPDATE)
aws/api/routes.js               petitionSign() — POST /api/petition (files the signature under the
                                campaign's project, dispatches the thank-you on a first signature);
                                petitionCampaign() — the live campaign + its project (cached 5 min);
                                petitionThanksJob() — the thank-you email; petitionCount() — GET
                                /api/petition/count (Utah only, cached COUNT_TTL_MS);
                                createCheckoutSession accepts optional `source` → Stripe metadata
aws/api/emails.js               buildPetitionThanksEmail — the email body (docs/systems/email.md)
packages/render/site.js         derivePetitionProject — petition.project for /petition, `petition`
                                on the filed project's hub (after deriveProjectTree)
templates/project.html          {{#petition}} card: label, headline, body, counter, sign button
css/pages/projects.css          .hub-petition*;  css/pages/petition.css .petition-hero-project
packages/db/audience.js         THE residency rule (utahZipSql / isUtahZip: every 84xxx ZIP is
                                Utah) + the mailing-list audience query shared by the admin
                                Mailing list page, its CSV and scripts/send-periodical.js
aws/api/index.mjs               route entry 'POST /api/petition' (secrets: Turnstile)
apps/admin/app/petition/        Petition page: campaign copy editor + signatures + CSV
apps/admin/app/petition/export/route.js   POST → CSV (audited `petition.export`)
apps/admin/lib/hero-status.js   draftHero/liveHero/HeroStatus — "which hero is showing" block on
                                the Homepage and Petition editors
apps/admin/app/subscribers/       Mailing list: status / search / residency / donors / petition filters → list + CSV; remove / restore / erase
apps/admin/lib/collections.js   HOMEPAGE_GROUPS entry `petition` (page: 'petition')
aws/export-operational/         nightly export includes petition_signatures
scripts/restore-operational.mjs restore includes petition_signatures
scripts/seed-homepage-group.mjs copy a content/homepage.json group into an env's DB
scripts/patch-homepage-group.mjs set single fields inside a saved group (--set project_slug=alpr)
                                without replacing the editor's copy; revision + audit row
```

## Content: `homepage.petition`

| Field | Used by | Notes |
|---|---|---|
| `slug` | form (`data-petition`), API, admin filter, CSV | `^[a-z0-9][a-z0-9-]{0,63}$`; **changing it starts a new petition** |
| `project_slug` | project hub (the petition card), /petition ("Part of our … project"), API (copied onto every new signature), thank-you email (project link), admin | a `projects.slug`; dropdown on the admin page; blank = no project. See "Project" |
| `label` | hero eyebrow, /petition | e.g. "Unofficial Petition" |
| `headline` | hero, /petition | HTML allowed (`<em>` = red). **Blank = petition off** |
| `body` | hero sub, /petition, meta description | the provision + the ask |
| `cta` | hero button, form submit button | |
| `cta_secondary`, `cta_secondary_url` | hero + /petition secondary link | blank label = no link; url passes `safeUrl` |
| `count_label` | hero + /petition counter | `{count}` → number of **Utah** signatures; blank = no counter; hidden while 0 |
| `form_title`, `form_intro` | /petition panel; `form_title` is also the page `<title>` / `og:title` (the link-preview headline) | blank = "Sign the petition" |
| `consent` | under the sign button | the "future communications" line |
| `thanks_title`, `thanks_body`, `thanks_cta`, `thanks_dismiss` | /petition-thanks | `thanks_dismiss` also labels the modal's dismiss |

Edited on the admin's **Petition** page only (the Homepage editor skips and
preserves the group — `page: 'petition'` in `HOMEPAGE_GROUPS`). Copy goes
live through the normal two-person publish. Prod's column is NULL until an
editor saves the page once; the git copy in `content/homepage.json` seeds
staging via `node scripts/seed-homepage-group.mjs --env staging --group petition`.

## Data flow

1. Visitor clicks the hero CTA → `/petition`. The form posts JSON to
   `POST /api/petition` with the slug from `data-petition`.
2. The API validates, rate-limits (20 / IP / hour — one phone at a tabling
   event signs many people), checks Turnstile when keyed, then in order:
   - reads the live campaign (`petitionCampaign`: `homepage.petition` + the
     project row; per-container cache, 5 min) — null when the posted slug is
     not the live one or the read fails;
   - checks whether this address already signed this petition (one indexed
     SELECT) — decides the email below;
   - upserts `petition_signatures` on `(petition, email)` — a re-sign refreshes
     name/zip, fills address/phone only if newly given, keeps `created_at`;
     `project_slug` is the campaign's project (kept on re-sign if the campaign
     no longer names one);
   - upserts `subscribers` (signing = consent to communications) **without
     overwriting** details already on file (`COALESCE(subscribers.x, excluded.x)`).
   No welcome email is sent. On a **first** signature the thank-you email is
   dispatched as the self-invoke job `petition-thanks` (off the response path;
   a failed dispatch is logged, the signer still gets `{ok:true}`). A re-sign
   sends nothing.
3. On `{ok:true}` the page stores `{petition, firstName, lastName, email, zip}`
   in sessionStorage and navigates to `/petition-thanks`.
4. "I can help" opens the modal; "Continue to checkout" posts
   `{type:'onetime', amountCents, email, firstName, lastName, zip,
   newsletterOptIn:true, publicDonor, source:'petition:<slug>'}` to
   `/api/create-checkout-session` and follows the Stripe URL. The webhook
   records the donation exactly as for the homepage form (members +
   donations); `source` is visible on the Stripe session/customer metadata.
5. "Not this time" → `/`.

## Residency and audiences

Residency is **derived from the ZIP, never stored**: every `84xxx` ZIP (and
ZIP+4) is Utah and nothing else is — `packages/db/audience.js`
`utahZipSql(expr)` / `isUtahZip(zip)` is the one rule everything uses.

- **Public counter** (`GET /api/petition/count?petition=<slug>` →
  `{petition, count}`): Utah signatures only, **event-driven, never timed**
  (org decision 2026-10-05). The page fetches once per load; the Lambda
  answers from a per-container cache that a new Utah signature clears
  (`petitionSign` → `invalidateCount`), so the next load recounts. No
  browser caching (`no-store`); `COUNT_TTL_MS` (10 min) only bounds how
  stale another warm container can be. Rendered by `js/petition.js` into
  `[data-petition-count]` from the `count_label` template; hidden until at
  least one Utahn has signed.
- **Admin → Petition**: counts per slug split Utah / outside; residency
  filter on the list; CSV carries `utah_resident` (yes/no) and can be
  exported Utah-only, outside-only or both.
- **Admin → Mailing list** (`/subscribers`): everyone an email can reach =
  confirmed, still-subscribed, non-bounced `subscribers` ∪ opted-in
  `members` (the page also lists the rest with a status — see
  docs/systems/newsletters.md "Mailing list management"), each labelled `residency`
  (utah / outside / unknown from the best ZIP we hold: subscriber ZIP, else
  newest petition ZIP, else member ZIP), `donor`, `petitions`, `via`. Filters
  residency × donors-only × signed-petition drive the list, the "This email
  is going to N people" line and the CSV.
- **Sender**: `scripts/send-periodical.js --audience utah|outside|unknown|all
  --donors-only --petition <slug>` resolves recipients with the SAME query,
  so the dashboard count is exactly who receives.

## API: GET /api/petition/count

`?petition=<slug>` → `200 {petition, count}` (Utah only), `400` bad slug,
`500` DB error (`[api] petition count error: <ErrorName>`). No rate limit
(read-only, cached until the next Utah signature, one small indexed COUNT).

## API: POST /api/petition

Body: `{ petition, firstName, lastName, email, zip, address?, phone?, turnstileToken? }`

| Status | When |
|---|---|
| 200 `{ok:true}` | recorded (new or re-sign) |
| 400 | malformed body; bad slug; missing first/last name; ZIP not `NNNNN` or `NNNNN-NNNN`; invalid email |
| 403 | Turnstile failed (only when `TURNSTILE_SECRET_KEY` is set) |
| 429 | over 20 / IP / hour |
| 500 | insert failed — logs `[api] petition insert failed: <ErrorName>` (name only; pg messages can echo signer PII) |

Lengths: names 100, email 254, zip 10, address 200, phone 30. Email is
lowercased. Side effects: subscribers row (see above); thank-you email on a
first signature (docs/systems/email.md); `project_slug` from the live campaign.

## Table: `petition_signatures`

`id UUID PK, petition TEXT, first_name, last_name, email, zip (NOT NULL),
address, phone, project_slug (2026-10-09), created_at, updated_at,
UNIQUE (petition, email)`; index `(petition, created_at)`. API role: SELECT,
INSERT, UPDATE (upsert needs all three; never DELETE). Admin reads with the
admin role. `project_slug` is the project the campaign named WHEN the row was
written (NULL before the column / no project); the schema backfills
`udot-alpr-permits` → `alpr`.

## Admin

- **Petition** (Site Main): status line (on/off + active slug + the project
  it is filed under, linking to that project's workspace), signature
  counts per slug, newest 500 of the chosen slug (with a Project column),
  **Download CSV** (POST, per slug or all; audit row `petition.export` with
  `{petition, rows}`), then the copy editor (lost-update stamp on the
  homepage singleton; audit `petition.save`; refuses a bad slug while the
  headline is set; refuses a `project_slug` that is not a project). The
  **Project** field is a dropdown of the projects tree (`listProjects`,
  widget `'project'`). Editor+. Above the copy editor, **Thank-you email**
  (`app/automatic-email-picker.js`, trigger `petition-thanks`): dropdown of
  the automatic emails written under Mail → Outgoing emails, or the built-in
  email — docs/systems/email.md "Attached emails".
- **Project workspace** (`/projects/<slug>` → Overview): one line saying
  whether the live campaign is filed here and the signature counts per
  campaign slug carrying this project (`workspace()` → `petitions`,
  `activePetition`).
- **Subscribers**: `donor` (email belongs to a member with ≥1 donation or a
  non-canceled subscription) and `petitions` (slugs signed) columns in the
  list and the CSV — the mailing-list labels.

CSV columns: `petition, project, first_name, last_name, email, zip, utah_resident,
address, phone, signed_at_utc` (ISO 8601, UTC). Cells are quoted and formula-injection
guarded like the subscribers export.

## Debug

Browser: `[petition] sign failed: <status>`, `[petition] sign network error`,
`[petition] checkout failed`. API: see docs/error-handling/debug/api.md
(`petition insert failed`, `rate limit check failed (petition)`,
`petition campaign lookup failed`, `petition thanks dispatch failed`,
`petition thanks email failed`, `SES sent … subject="Thank you for signing…"`).

## Verifying the hero

Both the Homepage and the Petition editor open with a **Which hero is
showing?** block (`apps/admin/lib/hero-status.js`): the *live* row fetches
the public homepage on every page view (`PUBLIC_ORIGIN`, `cache: 'no-store'`,
5 s timeout) and reads the hero `<section>` class — `hero-petition` = takeover;
the *saved* row derives from `homepage.petition.headline` in the database.
Green border = in sync, gold = saved but not published, red = the live check
failed (`[admin] live hero check failed: <ErrorName>`; the saved row is still
right). The standing hero (Homepage → Hero fields) is always the default:
blank the petition headline and it returns on the next publish.

## Turning it off / starting the next one

- Off: blank the headline, save, publish. Signatures stay.
- Next campaign: set a new slug + copy, save, publish. The hero, /petition
  and the thank-you page follow; the admin filter defaults to the new slug.

## Sharing (2026-10-06)

`templates/partials/petition-share.html`, included on /petition (hero, under the
buttons) and /petition-thanks (under the donation ask). Facebook, X, Bluesky,
Text and Email are plain links built at render time by
`derivePetitionShare` (`packages/render/site.js`) — they work with JavaScript
off. `js/petition.js` adds the phone share sheet (`navigator.share`) and
**Copy link** (`navigator.clipboard`), each hidden until supported.

- **Message**: `share_text`, else the headline with tags stripped. Link
  appended automatically; Facebook ignores pre-filled text and uses the
  page's Open Graph preview.
- **Preview** (`og:image`, `twitter:card`/`twitter:image` on /petition):
  `share_image` if it is a `/media/…` or `/assets/…` png/jpg/webp; anything
  else falls back to `/assets/share-default.png` (the white logo lockup on
  navy `#1B2F4E`, 1200×630 — `UCC.png` is transparent, so apps painted
  their own background behind it). Always `summary_large_image`. The same
  file is the `og:image` of every other template and the Documents default
  (`packages/render/documents.js` DEFAULT_OG_IMAGE). Regenerate with sharp:
  `logo-lockup-transparent.png` resized to 560 wide, centred on a 1200×630
  navy canvas (fits inside the centre square, so `summary` crops keep it).
- **Preview headline** (`<title>`, `og:title`, `twitter:title`):
  `share.page_title` = `form_title` (tags stripped, default "Sign the
  petition") + " | Utah Civic Compact". Off → "Sign the Petition | …".
- **Heading**: `share_title`, default "Share the petition".
- Absent entirely when the petition is off (headline blank).

## Donation ask on the thank-you page (2026-10-06)

The payment window's copy, amounts and frequency come from the petition
group, via `petitionDonate` (`packages/render/site.js`):

| Field | Meaning | Blank = |
|---|---|---|
| `donate_amounts` | dollars, comma-separated; $1–$100,000, de-duplicated, max six | 10, 25, 50, 100 |
| `donate_default` | pre-selected amount | 25, else the first |
| `donate_frequency` | `both` / `one-time` / `monthly` | both (One-time / Monthly switch) |
| `donate_default_frequency` | which side the switch starts on | one-time |
| `donate_title`, `donate_body`, `donate_button`, `donate_custom_label`, `donate_public_label` | copy | previous hard-coded text |

An **Other** button with a free amount ($1–$100,000) is always present.
Monthly sends `type: 'subscription'` to `POST /api/create-checkout-session`
(already supported — no API or Stripe change). Tests:
`packages/render/test/petition-share.test.mjs`.

## Project (2026-10-09)

A campaign belongs to a project (`homepage.petition.project_slug`, the admin's
**Project** dropdown). What that does:

| Where | Effect |
|---|---|
| Project hub (`/projects/<path>`) | `derivePetitionProject` puts the campaign on the filed project as `petition`; `templates/project.html` renders a dark card (label, headline, body, Utah counter, sign button → /petition) between the intro and "Parts of this project". `js/petition.js` is loaded on hubs for the counter. |
| `/petition` | "Part of our *Project* project" link under the headline (`petition.project`). |
| Signature row | `project_slug` copied from the live campaign at sign time — a past campaign keeps its project after the slug moves on; admin list + CSV show it. |
| Thank-you email | "This petition is part of our *Project* project" with the hub link. |
| Admin | Petition page: "Filed under …" line + the dropdown; project workspace Overview: live-campaign flag + signature counts per slug for this project. |

One live campaign at a time is unchanged (`docs/decisions/petition-copy-in-homepage-group.md`).
If several petitions must run at once, the next step is a `petitions`
collection (slug, project_slug, copy) with `homepage.petition` pointing at
the featured one — noted in docs/pending-questions.md.

## Thank-you email (2026-10-09)

See docs/systems/email.md "What is sent" / "Attached emails". Summary: first
signature only, self-invoke job; the email chosen on the Petition page (an
automatic email composed under Outgoing emails) or the built-in body with the
campaign headline (generic when the slug is not the live campaign), project
link, Share + Chip in buttons, one-click unsubscribe headers. Tests:
`aws/api/test/api.test.mjs` "petition-thanks job".

## Not built (deliberate)

- No IP / user-agent stored with a signature — a privacy org's petition.
- No nav link; the hero is the entry point (add to header.html if wanted).
