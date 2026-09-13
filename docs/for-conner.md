# For Conner — operator handoff notes (AWS rebuild)

Running list of everything that needs a human with the keys. Updated every phase;
each item says WHAT, WHERE it goes, and WHEN it's needed. Items get checked off
as they're done. Context: `docs/build-spec-aws.md`.

## Needed NOW (blocks later phases, start hunting early)

- [ ] **`TOKEN_SECRET` plaintext** — the HMAC secret currently set on Cloudflare
  Pages (`wrangler pages secret put TOKEN_SECRET`). Cloudflare cannot show it
  back — it must come from wherever it was saved when first generated (password
  manager, notes, terminal history). It MUST carry over to AWS unchanged:
  every newsletter unsubscribe link in the wild is signed with it for 1 year,
  and rotating it silently breaks one-click unsubscribe in people's mail
  clients. Needed before Phase 5 (API port). If it is truly unrecoverable,
  tell the dev BEFORE Phase 5 — that changes the cutover plan.

- [ ] **SECURITY: rotate the old Cloudflare API token** — a Cloudflare API
  token was accidentally committed to git in `.claude/settings.local.json`
  (inside an old permission-allowlist entry) and pushed to the GitHub repo
  (CatAuditor/uccsite, commit df44bc7). Treat it as exposed: Cloudflare
  dashboard → My Profile → API Tokens → find the token (it had Workers
  Scripts read access) → Roll or Delete it. The file is now untracked and
  gitignored, but the token remains in git history until rotated — rotation
  is the fix, not history rewriting.

## Quick dashboard tweaks (whenever convenient)

- [ ] Cloudflare Pages → uccsite project → Settings → Build: change the build
  command from `node build.js` to `npm run build`. That makes every deploy run
  the renderer's golden-file test suite first — a bad change fails the build
  instead of shipping.
- [ ] Cloudflare Pages env vars: `DONATION_GOAL_CENTS` can be deleted (the
  stats endpoint no longer shows a total or goal, org decision 2026-09-12).

- [ ] **Subscribe your email to the ops alert topic** so drift/corruption
  incidents reach a human: AWS Console (account 017110365763, us-west-2) →
  SNS → Topics → the `UccStaging-OpsAlerts...` topic → Create subscription →
  Email → confirm the email it sends you. Repeat for the prod topic when the
  prod stack exists.

- [ ] **Cloudflare API token for the data migration** — the donor-database
  copy (D1 → AWS) needs read access to the `ucc-members` D1 database. Either
  run `npx wrangler login` on the dev machine, or create an API token
  (Cloudflare dashboard → My Profile → API Tokens) with D1 read permission
  and provide it as `CLOUDFLARE_API_TOKEN`. Needed before cutover.

## Needed at Phase 3/5 (AWS Secrets Manager, us-west-2, account 017110365763)

**The staging + prod stacks now create these secrets with placeholder values
named `ucc/staging/<NAME>` and `ucc/prod/<NAME>`.** To fill one in: AWS
Console → Secrets Manager → the secret → "Retrieve secret value" → Edit →
paste the real value (replacing REPLACE_ME). The API picks changes up within
minutes (next Lambda cold start), no deploy needed. Sources:

- [ ] `STRIPE_SECRET_KEY` — Stripe Dashboard → Developers → API keys (live key)
- [ ] `STRIPE_WEBHOOK_SECRET` — carries over UNCHANGED (the webhook URL doesn't
  change at cutover, so the existing signing secret keeps working). Recoverable
  from Stripe Dashboard → Developers → Webhooks → the endpoint → signing secret
- [ ] `AIRTABLE_TOKEN` — Airtable → Developer hub → personal access tokens.
  Scope: `data.records:write` on the Tip Intake base only
- [ ] `RESEND_API_KEY` — Resend dashboard → API keys
- [ ] `TOKEN_SECRET` — see above, the ORIGINAL value
- [ ] `MAILGUN_API_KEY` — Mailgun dashboard (used by the periodical send script)
- [ ] `TURNSTILE_SECRET_KEY` — NEW: create a Cloudflare Turnstile widget for
  utahciviccompact.org (Cloudflare dashboard → Turnstile), gives a site key
  (public) + secret key (goes in Secrets Manager).
  **ORDER MATTERS:** put the SITE key into the site first (Site Settings →
  "Turnstile Site Key" in the CMS, or content/settings.json) and let it
  publish — THEN fill the secret in Secrets Manager. Filling the secret while
  the site key is blank makes the join + tip forms reject everyone (the
  server demands a CAPTCHA token the pages aren't collecting yet).

## Needed at Phase 6 (cutover) — details will be filled in when we get there

- [ ] DNS changes at Cloudflare: set records to **DNS-only (grey cloud)** and
  point at the CloudFront distribution (exact records TBD)
- [ ] Lower DNS TTL to 300s 24 hours before cutover day
- [ ] Keep the Cloudflare Pages project alive (but idle) for 30 days after
  cutover as the rollback path

## Needed at Phase 7 (admin + backups)

- [ ] **GitHub App** for the nightly content export: create a GitHub App on the
  `CatAuditor` org/account with contents:write on the `uccsite` repo, install
  it, and hand over the App ID + private key (`GITHUB_APP_PRIVATE_KEY` →
  Secrets Manager)
- [ ] Admin accounts: list of who gets `owner` / `editor` / `viewer` in the new
  admin (email addresses — no GitHub account needed anymore)

## Done

- [x] 2026-09-12 — nothing yet

## Phase 7 — media library (2026-09-13)

- [ ] When the admin app moves to Amplify Hosting, its SSR compute role needs
  `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the media bucket
  (stack output `MediaBucketName`) in addition to the DSQL / PublishFn grants
  already listed in docs/systems/admin.md. Locally the `uccsite` profile
  covers it.
- Nothing else to do: uploads go straight from the browser to S3 and the
  `MediaProcessFn` Lambda makes the AVIF/WebP variants. If an upload shows
  "failed" on the Media Library page, the reason is printed on the card.
