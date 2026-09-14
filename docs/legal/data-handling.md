# Data Handling Inventory

What personal data the systems store, where, and for how long. Update this
whenever a migration adds/removes PII-bearing columns, a route collects new
user data, or a third-party integration changes (CLAUDE.md rule).

## Databases (Aurora DSQL — staging + prod clusters, and legacy D1 until cutover)

| Table | Personal data | Source | Retention |
|---|---|---|---|
| `members` | email, first/last name, ZIP, Stripe customer id | Stripe checkout | indefinite (donor records) |
| `subscriptions` / `donations` | amounts + Stripe ids linked to members | Stripe webhook | indefinite |
| `subscribers` | email, name, address, ZIP | join form | until unsubscribe (row deleted) |
| `tips` | **confidential**: tipster name (or `Anonymous`), email, subject, free-text tip which may name third parties | `/tip` form (AWS stack); Airtable rows imported at cutover | until an owner deletes it in the admin (audit keeps the deletion only, not the contents). Editors can read; viewers cannot. Never logged. |
| `rate_limits` | client IP + endpoint | API requests | sliding 1h window, opportunistic purge |
| `audit_log.actor` | **admin** email | admin sessions (Cognito) | indefinite (accountability trail) |
| `revisions.author` | **admin** email | admin saves | pruned with revisions (last 20/entity) |
| `publish_runs.trigger_source` | **admin** email (`approve:<email>`) | publish approval | indefinite |
| `publish_requests.requested_by` / `reviewed_by` (+ notes) | **admin** emails, free-text review notes | Publish & Status | indefinite (who approved what) |
| `media_assets.uploaded_by` | **admin** email | media library uploads | until the asset is deleted |
| `project_files.uploaded_by`, `published_by` | **admin** email | admin /files uploads and publishes | until the file is deleted |
| `project_files` (the files themselves, in the media bucket) | whatever staff upload — may include records-request responses and other documents with third-party personal data; private to signed-in admins unless an editor publishes the file | admin /files | until deleted (+90 days noncurrent versions) |
| `team_members.email` | **staff** email (links a bio to an admin account; never published, exported to the private content repo) | Team editor | until removed |
| `subscribers` CSV export | full subscriber list downloaded by an editor/owner (audited as `subscribers.export`) | admin /subscribers | on the downloader's machine — handle as PII |

## Buckets

| Bucket | Personal data | Retention |
|---|---|---|
| operational export (restricted, per env) | nightly JSON of members/subscriptions/donations/subscribers/tips | 90 days (current) + 7 days (noncurrent versions) |
| site bucket | none (published site content only) | n/a |
| media bucket (per env) | none intended — uploaded images + derived variants; originals may carry EXIF metadata (variants are stripped by sharp). Also project files under `private-files/` (admin-only) and `files/` (public once published) — see the `project_files` row above | until deleted in the admin (+90 days noncurrent versions) |

## Third parties

| Service | Data sent | Purpose |
|---|---|---|
| Stripe | payment + donor details (their collection) | donations/memberships |
| Resend | recipient email, name in greeting | transactional email |
| Mailgun | recipient emails | bulk periodical |
| Airtable | tip submissions incl. tipster email (confidential — never logged). **Cloudflare stack only**; the AWS stack stores tips in the `tips` table. The base is read out at cutover and deleted 30 days later (docs/for-conner.md §7.8) | tipline intake (legacy) |
| Cloudflare Turnstile | client IP + challenge token | form abuse control |
| Cognito | admin emails + credentials | admin authentication |
