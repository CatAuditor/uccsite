# Data Handling Inventory

What personal data the systems store, where, and for how long. Update this
whenever a migration adds/removes PII-bearing columns, a route collects new
user data, or a third-party integration changes (CLAUDE.md rule).

## Databases (Aurora DSQL — staging + prod clusters, and legacy D1 until cutover)

| Table | Personal data | Source | Retention |
|---|---|---|---|
| `members` | email, first/last name, ZIP, Stripe customer id | Stripe checkout | indefinite (donor records) |
| `subscriptions` / `donations` | amounts + Stripe ids linked to members (`donations.stripe_subscription_id`, added 2026-10-10, is the Stripe plan id a monthly charge came from — not personal data) | Stripe webhook | indefinite. Shown to editors/owners in the admin's Financial → Donations with residency derived from the ZIP at read time (not stored); Financial → Costs reads Stripe's own totals (no per-person data) |
| `subscribers` | email, name, address, ZIP, `confirmed_at` (double opt-in timestamp; petition signers confirmed at insert), `unsubscribed_at` + `unsubscribed_by` (`'self'` for the unsubscribe link, else the removing admin's email) | join form; the officials lookup's newsletter checkbox (lookup.utahciviccompact.org, same fields via `/api/subscribe`, added 2026-10-08); petition form (signing = consent to communications); admin "Remove" | unsubscribe (the link or an admin's Remove) keeps the row but stamps it, so no further mail is sent and the admin can see who left; an admin "Erase record" deletes the row (a forget-me request). Unconfirmed rows receive only the welcome/confirmation email |
| `newsletter_opens` | newsletter id + timestamp per open-pixel hit — **no** recipient, IP or user agent (campaign-level count only) | `GET /api/open` pixel in sent newsletters | deleted with the newsletter |
| `email_events` | recipient email, SES event type/subtype (bounce, complaint, reject), SES message id, diagnostic text | SES event publishing via the ops SNS topic (SesEventsFn) | kept while the address is on the list (used to suppress further sends); no export |
| `petition_signatures` | name, email, ZIP, optional street address and phone, signing timestamp; campaign slug; the project slug the campaign was filed under (added 2026-10-09) | `/petition` form | indefinite (the petition record handed to UDOT / the legislature). No IP or user agent stored. Editors can read; viewers cannot. |
| `tips` | **confidential**: tipster name (or `Anonymous`), email, subject, free-text tip which may name third parties | `/tip` form (AWS stack); Airtable rows imported at cutover | until an owner deletes it in the admin (audit keeps the deletion only, not the contents). Editors can read; viewers cannot. Never logged. |
| `rate_limits` | client IP + endpoint | API requests | sliding 1h window, opportunistic purge |
| `audit_log.actor` | **admin** email | admin sessions (Cognito) | indefinite (accountability trail) |
| `revisions.author` | **admin** email | admin saves | pruned with revisions (last 20/entity) |
| `publish_runs.trigger_source` | **admin** email (`approve:<email>`) | publish approval | indefinite |
| `publish_requests.requested_by` / `reviewed_by` (+ notes) | **admin** emails, free-text review notes | Publish & Status | indefinite (who approved what) |
| `media_assets.uploaded_by` | **admin** email | media library uploads | until the asset is deleted |
| `project_files.uploaded_by`, `published_by` | **admin** email | admin /files uploads and publishes | until the file is deleted |
| `project_notes` | **admin** email (`author`) and free-text internal notes (typed or converted from uploaded .md/.docx) that may name third parties — never published, never exported with the content | admin project workspace (/projects/<slug> → Notes) | until deleted in the admin (snapshot kept in `revisions`, last 20 per note) |
| `project_files` (the files themselves, in the media bucket) | whatever staff upload — may include records-request responses and other documents with third-party personal data; private to signed-in admins unless an editor publishes the file | admin /files | until deleted (+90 days noncurrent versions) |
| `team_members.email` | **staff** email (links a bio to an admin account; never published, exported to the private content repo) | Team editor | until removed |
| `team_members.links`, `slug` | **staff** public profile URLs (LinkedIn, X, personal site) — **published** on `/team/<slug>` and in Person `sameAs` structured data; entered by the member or an editor | Team editor | until removed |
| `newsletters` | author email (`created_by`, `requested_by`, `reviewed_by` — staff), the email body | admin Mail → Outgoing emails | until an owner deletes the newsletter |
| `transactional_emails` | **admin** email (`attached_by`), the frozen body of an automatic email (no recipient data — placeholders are filled at send time and never stored) | admin Mail → Outgoing emails → attach | until detached or the draft is deleted |
| `newsletter_deliveries` | recipient email, SES message id, send status/error per newsletter | NewsletterSendFn at send time (from the audience query) | deleted with the newsletter; never exported or shown in bulk (counts only) |
| mailing-list CSV export | subscribers ∪ opted-in members, optionally filtered by residency (derived from ZIP, not stored) / donor / petition, downloaded by an editor/owner (audited as `subscribers.export` with the filters) | admin /subscribers | on the downloader's machine — handle as PII |
| `petition_signatures` CSV export | every signature for one or all campaigns (audited as `petition.export`) | admin /petition | on the downloader's machine; the copy given to UDOT is the org's to govern |

## Buckets

| Bucket | Personal data | Retention |
|---|---|---|
| operational export (restricted, per env) | nightly JSON of members/subscriptions/donations/subscribers/tips/petition_signatures | 90 days (current) + 7 days (noncurrent versions) |
| site bucket | none (published site content only) | n/a |
| media bucket (per env) | none intended — uploaded images + derived variants; originals may carry EXIF metadata (variants are stripped by sharp). Also project files under `private-files/` (admin-only) and `files/` (public once published) — see the `project_files` row above | until deleted in the admin (+90 days noncurrent versions) |

## Third parties

| Service | Data sent | Purpose |
|---|---|---|
| Stripe | payment + donor details (their collection); checkout metadata may carry `source` (e.g. `petition:<slug>`) | donations/memberships |
| Amazon SES (AWS, us-west-2) | recipient email, name in greeting; bounce/complaint notifications carry the recipient address to the ops alert topic (email to operators) and to the account-level suppression list | transactional email (welcome, billing-portal link, petition thank-you with the signer's first name, donation thank-you/receipt with first name and amount) and the bulk periodical. Replaced Resend and Mailgun 2026-10-05 |
| Airtable | tip submissions incl. tipster email (confidential — never logged). **Cloudflare stack only**; the AWS stack stores tips in the `tips` table. The base is read out at cutover and deleted 30 days later (docs/for-conner.md §7.8) | tipline intake (legacy) |
| Cloudflare Turnstile | client IP + challenge token | form abuse control |
| Cognito | admin emails + credentials | admin authentication |
