# Petition — campaign hero, signature form, follow-up ask

Built 2026-10-05 for the UDOT ALPR special-use-permit petition; designed so the
NEXT campaign is a copy change, not a code change. One campaign is live at a
time (the one whose copy is in `homepage.petition`); signatures from past
campaigns stay in the table under their own slug.

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
aws/api/routes.js               petitionSign() — POST /api/petition; petitionCount() — GET
                                /api/petition/count (Utah only, cached COUNT_TTL_MS);
                                createCheckoutSession accepts optional `source` → Stripe metadata
packages/db/audience.js         THE residency rule (utahZipSql / isUtahZip: every 84xxx ZIP is
                                Utah) + the mailing-list audience query shared by the admin
                                Mailing list page, its CSV and scripts/send-periodical.js
aws/api/index.mjs               route entry 'POST /api/petition' (secrets: Turnstile)
apps/admin/app/petition/        Petition page: campaign copy editor + signatures + CSV
apps/admin/app/petition/export/route.js   POST → CSV (audited `petition.export`)
apps/admin/lib/hero-status.js   draftHero/liveHero/HeroStatus — "which hero is showing" block on
                                the Homepage and Petition editors
apps/admin/app/subscribers/       Mailing list: residency / donors / petition filters → list + CSV
apps/admin/lib/collections.js   HOMEPAGE_GROUPS entry `petition` (page: 'petition')
aws/export-operational/         nightly export includes petition_signatures
scripts/restore-operational.mjs restore includes petition_signatures
scripts/seed-homepage-group.mjs copy a content/homepage.json group into an env's DB
```

## Content: `homepage.petition`

| Field | Used by | Notes |
|---|---|---|
| `slug` | form (`data-petition`), API, admin filter, CSV | `^[a-z0-9][a-z0-9-]{0,63}$`; **changing it starts a new petition** |
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
   - upserts `petition_signatures` on `(petition, email)` — a re-sign refreshes
     name/zip, fills address/phone only if newly given, keeps `created_at`;
   - upserts `subscribers` (signing = consent to communications) **without
     overwriting** details already on file (`COALESCE(subscribers.x, excluded.x)`).
   No welcome email is sent.
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
  `subscribers` ∪ opted-in `members`, each labelled `residency`
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
lowercased. Side effect: subscribers row (see above).

## Table: `petition_signatures`

`id UUID PK, petition TEXT, first_name, last_name, email, zip (NOT NULL),
address, phone, created_at, updated_at, UNIQUE (petition, email)`; index
`(petition, created_at)`. API role: SELECT, INSERT, UPDATE (upsert needs
all three; never DELETE). Admin reads with the admin role.

## Admin

- **Petition** (Site Main): status line (on/off + active slug), signature
  counts per slug, newest 500 of the chosen slug, **Download CSV** (POST,
  per slug or all; audit row `petition.export` with `{petition, rows}`),
  then the copy editor (lost-update stamp on the homepage singleton; audit
  `petition.save`; refuses a bad slug while the headline is set). Editor+.
- **Subscribers**: `donor` (email belongs to a member with ≥1 donation or a
  non-canceled subscription) and `petitions` (slugs signed) columns in the
  list and the CSV — the mailing-list labels.

CSV columns: `petition, first_name, last_name, email, zip, utah_resident,
address, phone, signed_at_utc` (ISO 8601, UTC). Cells are quoted and formula-injection
guarded like the subscribers export.

## Debug

Browser: `[petition] sign failed: <status>`, `[petition] sign network error`,
`[petition] checkout failed`. API: see docs/error-handling/debug/api.md
(`petition insert failed`, `rate limit check failed (petition)`).

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

## Not built (deliberate)

- No IP / user-agent stored with a signature — a privacy org's petition.
- No nav link; the hero is the entry point (add to header.html if wanted).
