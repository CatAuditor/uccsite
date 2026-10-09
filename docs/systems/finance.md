# Financial section (admin) — Donations + Costs

Added 2026-10-10. The admin's **Financial** nav group: money in (every
donation, filterable, with each donor's monthly-plan state) and money out
(the AWS bill by service, Stripe's fees, the services with no bill to pull).
Separate from **Operations** (redirects, tips, revisions, audit, dev notes).
Both pages are `editor`+ (donor PII, spec §11); a viewer sees the group in
the nav and gets `requireRole`'s refusal on the page.

## Code Map

```
apps/admin/app/layout.js          NAV: { group: 'Financial', items: [/donations, /costs] }
apps/admin/app/donations/page.js  Donations: summary tiles, filter form (GET), table
apps/admin/app/costs/page.js      Costs: tiles, AWS by service × month, Stripe by month,
                                  monthly plans, "Other services" (static)
apps/admin/lib/finance.js         awsCosts() — Cost Explorer; stripeSummary() — Secrets
                                  Manager → Stripe balance + balance_transactions; caches
apps/admin/lib/finance-shape.mjs  pure: lastMonths / monthKey / monthLabel, shapeAwsCosts,
                                  shapeStripeMonths, sumCents (test/finance-shape.test.mjs, 4)
packages/db/donations.js          SQL builders: normalizeDonationFilters, donationsQuery,
                                  donationsSummaryQuery, monthlyPlansQuery,
                                  describeDonationFilters, toCents (test/donations.test.mjs, 8)
packages/db/schema.js             donations.stripe_subscription_id TEXT (ALTER … IF NOT EXISTS)
aws/api/webhook.js                invoice.paid → recordDonation({ subscriptionId }) writes it
scripts/finance-prod-wiring.mjs   IAM: FinanceRead + FinanceReadStripe on the admin SSR role
apps/admin/app/globals.css        .stats / .stat tiles, table.numbers, .list-tools input.short
```

## Donations (`/donations`)

Every row of `donations` joined to `members`, newest first, capped at 200
rows; the **summary tiles cover the whole filtered set**, the table the
newest 200 of it (the page says so when they differ).

Columns: date, amount, donor (+ "N gifts" when the member gave more than
once), email, ZIP (+ a `UT` chip for a Utah ZIP), **Type** (one-time /
monthly), **Plan** (the donor's monthly plan today: active / past due /
canceled / …, or "no plan"), Ticker (shown / opted out — `donations.public`).

**Monthly** (per row): `stripe_subscription_id IS NOT NULL` — written by
the webhook on every `invoice.paid` since 2026-10-10 — OR, for rows older
than that, the donor holds a subscription of exactly that amount
(`MONTHLY_SQL`). The fallback is a heuristic and is documented as such on
the page's notice; it goes away as old rows age out of the usual filters.

**Plan** (per donor): the newest subscription for the member, an `active`
one first (`SUB_STATUS_SQL`, a correlated subquery with `ORDER BY (status =
'active') DESC, updated_at DESC LIMIT 1`). Values are Stripe's subscription
statuses; the page labels `past_due` "past due" and maps active / past_due
/ canceled to the existing green / amber / grey chips.

**Residency**: the mailing list's rule (`packages/db/audience.js
utahZipSql`): every 84xxx ZIP is Utah; blank = unknown; anything else =
outside. Derived at read time — nothing is stored.

Filters (all GET params, all optional, unknown values fall back):

| Param | Values | SQL |
|---|---|---|
| `timeframe` | `30d`, `90d`, `ytd`, `12m`, `all` (default) | `d.created_at >= now() - interval …` / `date_trunc('year', now())` |
| `min`, `max` | dollars (parsed by `toCents`; `$`, `,` tolerated) | `d.amount_cents >= / <=` |
| `residency` | `all`, `utah`, `outside`, `unknown` | the residency CASE `= $n` |
| `kind` | `all`, `one-time`, `monthly` | `NOT MONTHLY_SQL` / `MONTHLY_SQL` |
| `monthly` | `any`, `active`, `past_due`, `canceled` | `SUB_STATUS_SQL = $n` |
| `ticker` | `any`, `yes`, `no` | `d.public = 1 / 0` |
| `q` | text ≤ 80 chars | `m.email ILIKE` or first+last name `ILIKE` (`%`, `_`, `\` escaped) |

Summary row (`donationsSummaryQuery`): `n, total_cents, max_cents, donors
(distinct members), utah_n, utah_cents, monthly_n, monthly_cents, public_n`.
`bigint` sums arrive as strings from pg — the page wraps every figure in
`Number()`. Tiles: total + gifts/donors, average + largest, % from Utah, %
from monthly plans, active plans × amount per month (`monthlyPlansQuery`,
not filtered), % on the ticker.

Verified 2026-10-10 against staging (empty) and prod (8 gifts, 1 active
plan) with every filter at once: all three builders run on DSQL (`ILIKE`,
`count(*) FILTER`, `date_trunc`, boolean `ORDER BY` in a scalar subquery
all accepted).

## Costs (`/costs`)

Three sources, fetched in parallel; each degrades to `{ error }` and the
page shows the others plus the message.

**AWS** — `awsCosts(6)`: Cost Explorer `GetCostAndUsage` (us-east-1, the
global endpoint), `MONTHLY`, `UnblendedCost`, grouped by `SERVICE`, from
the first of the month five months back to tomorrow (end exclusive; today's
partial data included). `shapeAwsCosts` → services × months, services
whose six-month total rounds to $0.00 dropped, sorted by the current month;
a total row from the same groups (Cost Explorer returns no `Total` when
grouping). Unfiltered on purpose: this is the bill as billed, tax and any
credits included. **Each call costs $0.01** — the result is cached in the
process for one hour (`CE_TTL`); Amplify's SSR may run several instances,
so a few calls an hour is the ceiling, not one. Amounts under half a cent
show as `<$0.01`. Errors: `AccessDeniedException` → "role not allowed
(ce:GetCostAndUsage — for-conner.md §15)"; `DataUnavailableException` →
"Cost Explorer still preparing data (up to 24 h after first opened)".
Cost Explorer was already enabled on the account (verified 2026-10-10:
the API answered for Sept + Oct).

**Stripe** — `stripeSummary(6)`: the secret key is read ONCE per process
from Secrets Manager (`STRIPE_SECRET_NAME` env, default
`ucc/<UCC_ENV>/STRIPE_SECRET_KEY` — the API Lambda's own secret), the CDK
placeholder `REPLACE_ME` counts as unset ("Stripe is not connected", shown
as a hint not an error). Then `GET /v1/balance` and `GET
/v1/balance_transactions?created[gte]=<first month>` paginated 100 at a
time (≤ 20 pages), `Stripe-Version: 2024-06-20` (the same pin as
`aws/api/lib.js`). `shapeStripeMonths` buckets by the transaction's
`created` month (UTC): `charge`/`payment` → gross + fee + count;
`refund`/`payment_refund`/`payment_failure_refund` → refunds (sign
flipped) + fee (a refund's fee is negative = the fee reversed); `payout` →
paid out; `stripe_fee`/`application_fee`/`tax_fee` → fees; anything else
at its `net`. `net = gross − refunds − fees`. Balance = USD `available` +
`pending`. Cached 10 minutes. A `sk_test_` key is flagged "test mode key"
in the heading (`balance.livemode`). The key never leaves `lib/finance.js`
and is never logged.

**Monthly plans** — `monthlyPlansQuery()` from our `subscriptions` table
(active n × amount = expected monthly income).

**Other services** — a static table (`OTHER_SERVICES` in the page):
Stripe (fees above), Cloudflare (DNS + Turnstile, free plan; the domain
renews on the Cloudflare account — no API, check the dashboard), GitHub
(free), Google Fonts (free). Edit the constant when a paid service is
added; the point is to say where money goes (or does not), not to guess.

Tiles: AWS this month to date (+ last month), Stripe net this month and
last (+ gross, fees), active plans / month, Stripe balance not yet paid out.

## Env / IAM

No new env vars. The admin's AWS identity needs two more permissions,
appended to the hand-managed inline policy `UccProdAdminCompute` /
`admin-runtime` by `node scripts/finance-prod-wiring.mjs` (idempotent;
run 2026-10-10 on prod):

- `FinanceRead`: `ce:GetCostAndUsage` on `*` (Cost Explorer has no
  resource-level scope).
- `FinanceReadStripe`: `secretsmanager:GetSecretValue` on the
  `ucc/prod/STRIPE_SECRET_KEY` secret's ARN only.

Local dev (`AWS_PROFILE=uccsite`, user `uccsite-deploy`) already has both.
Staging has no admin host; the staging secret is a placeholder, so a local
run against staging shows "Stripe is not connected" by design.

## Logging

Prefix `[finance]` — docs/error-handling/debug/finance.md. Counts and
dollar totals only; never a donor, a key or a Stripe object.

## Schema

`donations.stripe_subscription_id TEXT` (nullable; `ALTER TABLE … ADD
COLUMN IF NOT EXISTS` in `packages/db/schema.js`, applied to staging and
prod 2026-10-10 by `migrate-schema.mjs`). Written by `aws/api/webhook.js
handleInvoicePaid` → `recordDonation({ subscriptionId })`; one-time
checkouts write NULL. Not PII (a Stripe id, like the payment-intent id
beside it). Rows from before 2026-10-10 stay NULL — see "Monthly" above.
