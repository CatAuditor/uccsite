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
| `rate_limits` | client IP + endpoint | API requests | sliding 1h window, opportunistic purge |
| `audit_log.actor` | **admin** email | admin sessions (Cognito) | indefinite (accountability trail) |
| `revisions.author` | **admin** email | admin saves | pruned with revisions (last 20/entity) |
| `publish_runs.trigger_source` | **admin** email (`admin:<email>`) | publish button | indefinite |
| `media_assets.uploaded_by` | **admin** email | media library uploads | until the asset is deleted |

## Buckets

| Bucket | Personal data | Retention |
|---|---|---|
| operational export (restricted, per env) | nightly JSON of members/subscriptions/donations/subscribers | 90 days (current) + 7 days (noncurrent versions) |
| site bucket | none (published site content only) | n/a |
| media bucket (per env) | none intended — uploaded images + derived variants; originals may carry EXIF metadata (variants are stripped by sharp) | until deleted in the admin (+90 days noncurrent versions) |

## Third parties

| Service | Data sent | Purpose |
|---|---|---|
| Stripe | payment + donor details (their collection) | donations/memberships |
| Resend | recipient email, name in greeting | transactional email |
| Mailgun | recipient emails | bulk periodical |
| Airtable | tip submissions incl. tipster email (confidential — never logged) | tipline intake |
| Cloudflare Turnstile | client IP + challenge token | form abuse control |
| Cognito | admin emails + credentials | admin authentication |
