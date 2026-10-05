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
js/petition.js                  form controller (POST /api/petition → /petition-thanks) and
                                the thanks modal (POST /api/create-checkout-session, onetime,
                                source 'petition:<slug>'); signer details ride in sessionStorage
                                ('petition-signer') only to prefill the checkout
content/homepage.json           `petition` group — the git/local copy of the campaign text
packages/db/content.js          HOMEPAGE_GROUP_COLS gains ['petition','petition']
packages/db/content-schema.js   ALTER TABLE homepage ADD COLUMN petition TEXT (JSON group)
packages/db/schema.js           petition_signatures DDL + api grants (SELECT, INSERT, UPDATE)
aws/api/routes.js               petitionSign() — POST /api/petition; createCheckoutSession
                                accepts optional `source` → Stripe metadata
aws/api/index.mjs               route entry 'POST /api/petition' (secrets: Turnstile)
apps/admin/app/petition/        Petition page: campaign copy editor + signatures + CSV
apps/admin/app/petition/export/route.js   POST → CSV (audited `petition.export`)
apps/admin/app/subscribers/query.js       shared subscriber query with donor + petitions labels
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
| `form_title`, `form_intro` | /petition panel | |
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

CSV columns: `petition, first_name, last_name, email, zip, address, phone,
signed_at_utc` (ISO 8601, UTC). Cells are quoted and formula-injection
guarded like the subscribers export.

## Debug

Browser: `[petition] sign failed: <status>`, `[petition] sign network error`,
`[petition] checkout failed`. API: see docs/error-handling/debug/api.md
(`petition insert failed`, `rate limit check failed (petition)`).

## Turning it off / starting the next one

- Off: blank the headline, save, publish. Signatures stay.
- Next campaign: set a new slug + copy, save, publish. The hero, /petition
  and the thank-you page follow; the admin filter defaults to the new slug.

## Not built (deliberate)

- No public signature counter (easy: `GET` count by slug; add when wanted).
- No IP / user-agent stored with a signature — a privacy org's petition.
- No nav link; the hero is the entry point (add to header.html if wanted).
