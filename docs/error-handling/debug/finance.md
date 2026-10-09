# Debug reference — Financial section (`[finance]`)

Feature: admin **Financial → Donations** (`/donations`) and **Costs**
(`/costs`). System doc: docs/systems/finance.md. Logs go to the admin's
server output: the terminal under `npm run dev`, CloudWatch for the Amplify
SSR compute (log group of the Amplify app's compute function) in prod.
Nothing here ever includes a donor, an email, a key or a raw Stripe object.

| Log | File / event | Reports | Normal | Broken |
|---|---|---|---|---|
| `[finance] donations list: N of M rows (filters…)` | `app/donations/page.js`, every render | rows shown (≤ 200) vs matching rows, the filter sentence | N ≤ M; M matches the tiles | missing → the page threw before logging: look for the pg error (`42703` = column missing → run `migrate-schema.mjs`) |
| `[finance] aws costs: S services over K months, this month $X` | `lib/finance.js awsCosts`, on a cache miss (≤ hourly per process) | service count, month count, month-to-date total | one line per hour per SSR instance | absent on every page load while the table shows → served from cache (fine); error line instead → below |
| `[finance] aws costs failed: Name: message` | same, on a Cost Explorer error | the SDK error name | never | `AccessDeniedException` → rerun `scripts/finance-prod-wiring.mjs`; `DataUnavailableException` → Cost Explorer not yet populated |
| `[finance] stripe key ucc/<env>/STRIPE_SECRET_KEY is unset (placeholder)` | `lib/finance.js loadStripeKey` | the secret still holds `REPLACE_ME` | staging only | on prod: the secret was never filled (for-conner.md §3) |
| `[finance] stripe key read failed: Name: message` | same, on a Secrets Manager error | the SDK error name | never | `AccessDeniedException` → rerun the wiring script; `ResourceNotFoundException` → wrong `UCC_ENV` / `STRIPE_SECRET_NAME` |
| `[finance] stripe: T balance transactions since YYYY-MM, live/TEST mode` | `lib/finance.js stripeSummary`, on a cache miss (≤ every 10 min) | transaction count in the window, key mode | `live` on prod | `TEST` on prod → the test key was pasted into the prod secret |
| `[finance] stripe fetch failed: message` | same, on a Stripe HTTP error | Stripe's error message | never | `Invalid API Key` → rotated key not updated in the secret; 429 → rate limited, reload later |

What the page shows for each failure is in docs/systems/finance.md
"Costs"; every source fails on its own, the others still render.
