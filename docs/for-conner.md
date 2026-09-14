# For Conner — operator runbook (AWS rebuild)

Everything that needs the account owner's keys, dashboards or judgement,
written so that **your Claude Code agent can run it and you supply the
hand where a console click or a secret is needed**. Each step is tagged:

| Tag | Who |
|---|---|
| `[agent]` | your agent runs it as written; no human input |
| `[hand]` | you, in a browser or password manager; the agent can wait and verify |
| `[dev]` | code change — hand to the developer session, not this runbook |
| `[go]` | you say the word; irreversible for the public site |

Status is kept in the checkboxes. Context: `docs/build-spec-aws.md` (spec),
`docs/changelog.md` (what shipped), `docs/systems/*.md` (how it works).

---

## 0. Agent setup (once per machine)

`[hand]` Get AWS CLI credentials for account **017110365763** with admin
rights and store them as the profile named **`uccsite`** — the name is
mandatory: a hook in `.claude/` blocks any AWS command that does not pass
`--profile uccsite`, so the personal default profile can never be hit.

```
aws configure --profile uccsite        # region us-west-2, output json
```

`[agent]`
```
git clone https://github.com/CatAuditor/uccsite && cd uccsite && git checkout refactor
npm ci                                  # Node 22+ (24 is what the dev uses)
$env:AWS_PROFILE='uccsite'              # PowerShell; bash: export AWS_PROFILE=uccsite
aws sts get-caller-identity --profile uccsite   # must print account 017110365763
node scripts/staging-check.mjs --auth preview:wasatch-front-2026   # 25 checks, all ok
```

Rules the agent must follow (they are in CLAUDE.md too): every `aws`/`cdk`
command gets `--profile uccsite`; **never** run `secretsmanager
get-secret-value` (secrets are written, never read back into a chat); do
not touch `dist/`, `main`, or DNS without a `[go]`.

Verification pattern used below: `[agent]` can confirm a secret is filled
without reading it —
```
aws secretsmanager describe-secret --profile uccsite --secret-id ucc/staging/<NAME> --query 'LastChangedDate'
```
(a placeholder from the deploy has the stack's creation date; a real value
has yours) — and then exercise the feature that uses it.

---

## 1. Needed NOW

- [ ] **`TOKEN_SECRET` plaintext** `[hand]` — the HMAC secret set on
  Cloudflare Pages with `wrangler pages secret put TOKEN_SECRET`. Cloudflare
  cannot show it back; it lives wherever it was saved when generated
  (password manager, notes, terminal history). It MUST carry over to AWS
  unchanged: every newsletter unsubscribe link in the wild is signed with it
  for a year, and a new value silently breaks one-click unsubscribe in mail
  clients. Fill it into `ucc/staging/TOKEN_SECRET` and `ucc/prod/TOKEN_SECRET`
  (§3). If it is truly unrecoverable, tell the dev — the cutover plan changes
  (new secret + accept broken old links, or a dual-secret verify).

- [ ] **SECURITY: rotate the old Cloudflare API token** `[hand]` — a token
  was committed in `.claude/settings.local.json` and pushed (commit
  `df44bc7` on `main`). Treat it as exposed: Cloudflare dashboard → My
  Profile → API Tokens → the token with Workers Scripts read → **Roll** or
  **Delete**. The file is gitignored now; rotation is the fix, not history
  rewriting.

- [ ] **Subscribe to the ops alert topics** `[agent]` then `[hand]`:
  ```
  aws cloudformation describe-stacks --profile uccsite --region us-west-2 --query "Stacks[?starts_with(StackName,'Ucc')].[StackName,Outputs[?OutputKey=='OpsAlertTopicArn'].OutputValue|[0]]" --output table
  aws sns subscribe --profile uccsite --region us-west-2 --topic-arn <UccStaging arn> --protocol email --notification-endpoint you@example.com
  aws sns subscribe --profile uccsite --region us-west-2 --topic-arn <UccProd arn>    --protocol email --notification-endpoint you@example.com
  ```
  `[hand]` click the confirmation link in each email. This is where drift
  rollbacks, publish failures and the prod CloudFront spend budget alert go.

## 2. Cloudflare (still the live site until cutover)

- [ ] `[hand]` Pages → uccsite → Settings → Build: build command `node
  build.js` → `npm run build` (runs the renderer's golden-file tests first).
- [ ] `[hand]` Pages env vars: delete `DONATION_GOAL_CENTS` (no total/goal
  shown since 2026-09-12).
- [ ] **Cloudflare API token for the donor-database copy** `[hand]` — create
  a token (My Profile → API Tokens) with **D1 read** on the `ucc-members`
  database (or `npx wrangler login` on the agent's machine). Give it to the
  agent as `CLOUDFLARE_API_TOKEN`. Used in §6.

## 3. Secrets Manager (us-west-2), staging and prod

The stacks create every secret with a placeholder, named
`ucc/staging/<NAME>` and `ucc/prod/<NAME>`. Fill each once per environment.
The API picks a change up on the next Lambda cold start (minutes); no
deploy. `[agent]` can write a value the moment you paste it into the chat,
but prefer `[hand]` in the console so the value never enters a transcript:
Secrets Manager → the secret → Retrieve secret value → Edit → replace
`REPLACE_ME` → Save. Agent form (value from a local file, not typed):
```
aws secretsmanager put-secret-value --profile uccsite --region us-west-2 --secret-id ucc/staging/<NAME> --secret-string file://value.txt ; Remove-Item value.txt
```

| Secret | Where it comes from |
|---|---|
| [ ] `STRIPE_SECRET_KEY` | Stripe → Developers → API keys. **Staging gets the TEST key**, prod the live key. |
| [ ] `STRIPE_WEBHOOK_SECRET` | carries over UNCHANGED for prod (webhook URL does not change at cutover): Stripe → Developers → Webhooks → the endpoint → Signing secret. Staging: create a test-mode endpoint pointing at `https://d3heb9s058a59m.cloudfront.net/api/webhook` and use its secret. |
| [ ] `AIRTABLE_TOKEN` | Airtable → Developer hub → personal access tokens; scope `data.records:write` on the Tip Intake base only. |
| [ ] `RESEND_API_KEY` | Resend → API keys. |
| [ ] `TOKEN_SECRET` | §1 — the ORIGINAL value. |
| [ ] `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → create a widget for utahciviccompact.org (add the staging CloudFront hostname too). **ORDER MATTERS** — see below. |
| [ ] `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` | §4. |
| (origin-verify header secret) | created and filled by the stack — nothing to do. |

**Turnstile order:** put the **site key** (public) into the site first —
admin → Site Settings → "Turnstile Site Key" → save → get it published
(two-person publish, §5) — THEN fill the secret. Filling the secret while
the site key is blank makes the join and tip forms reject everyone (the
server demands a token the pages are not collecting yet).

`[agent]` verify after filling (staging): `node scripts/staging-check.mjs
--auth preview:wasatch-front-2026`, then POST a test subscribe through the
site and confirm the welcome email arrives (Resend + TOKEN_SECRET), and
`stripe trigger checkout.session.completed` against the staging webhook
(Stripe CLI, test mode) shows a `processed_events` row:
```
$env:AWS_PROFILE='uccsite'; node -e "require('./packages/db').withConnection({endpoint:process.argv[1],region:'us-west-2'},async c=>console.log((await c.query('select count(*) from processed_events')).rows))" <DsqlEndpoint output>
```

## 4. GitHub App — nightly content export (Phase 7)

The export Lambda commits the database content to git every night and logs
`skipped` until these exist. Decap (the old CMS) is retired only after the
first real commit.

1. `[hand]` GitHub → Settings (of the `CatAuditor` account/org) → Developer
   settings → GitHub Apps → New GitHub App. Name `ucc-content-export`,
   homepage any, **uncheck Webhook**. Repository permissions: **Contents:
   Read and write** only. Where can it be installed: only this account.
   Create → note the **App ID** → Generate a private key (downloads a
   `.pem`).
2. `[hand]` Install App → select **only the `uccsite` repository** → after
   install the URL ends in `/installations/<number>` — that is the
   **Installation ID**.
3. Fill `ucc/staging/GITHUB_APP_ID` (the number), `…_INSTALLATION_ID` (the
   number), `…_PRIVATE_KEY` (the whole `.pem`, header and footer lines
   included — from the console, paste as plaintext, NOT as key/value JSON).
   Repeat for `ucc/prod/…` once prod content exists (§6).
4. `[agent]` verify:
   ```
   aws lambda invoke --profile uccsite --region us-west-2 --function-name <ExportContentFunctionName output of UccStaging> --payload '{}' out.json ; Get-Content out.json
   ```
   Expect `{"status":"committed",...}` (or `"no content change"` on a
   re-run) and a new commit on branch `content-export-staging`. Never
   `main`.
5. `[hand]` delete the downloaded `.pem`.

## 5. Admin accounts and the two-person publish rule

The admin needs **at least two editor/owner accounts** to publish anything:
a writer requests a publish and a *different* admin approves it
(`docs/systems/admin.md` "Publishing"). One account alone can edit but
never go live.

- [x] `jarom.gillins@utahciviccompact.org` is `owner` in the **staging**
  pool (2026-09-13).
- [ ] `[agent]` after the prod stack redeploy (§6 step 1), create the prod
  owner:
  ```
  node scripts/admin-user.mjs --env prod --email jarom.gillins@utahciviccompact.org --name "Jarom Gillins" --group owner
  ```
  Cognito emails a temporary password; first sign-in sets a real one, then
  `/profile` offers an authenticator app and security keys (do both).
- [ ] `[hand]` decide the roster: who is `owner` (invites, roles, resets),
  `editor` (edit, request/approve publish, see donors), `viewer`
  (read-only). Owners invite the rest from the admin's **Users** page, or
  `[agent]` with the command above (`--group editor`, `--resend` to re-send
  an invite).
- [ ] `[hand]` every account: enable an authenticator app or a security key
  on `/profile` before doing real work.

## 6. Production stack, content, donors

Prod (`UccProd`) exists but was deployed before the admin, media and
Cognito parts — its outputs have no pool, media bucket or publish
function yet.

1. `[agent]` redeploy: `cd infra/cdk; npx cdk deploy UccProd --profile
   uccsite --require-approval never`. Then confirm outputs include
   `AdminUserPoolId`, `MediaBucketName`, `PublishFunctionName`:
   `aws cloudformation describe-stacks --profile uccsite --region us-west-2 --stack-name UccProd --query 'Stacks[0].Outputs[].OutputKey'`.
2. `[agent]` schema: `node scripts/migrate-schema.mjs --env prod` (idempotent).
3. `[agent]` content — from the repo's `content/*.json` + templates (what
   Cloudflare serves today), run in this order:
   ```
   node scripts/migrate-content.mjs --env prod
   node scripts/migrate-documents.mjs --env prod --apply
   node scripts/migrate-redirects.mjs --env prod
   ```
   *Alternative* if staging content is the newer truth: `node
   scripts/export-content.mjs --env staging --out ./export-staging` then
   `node scripts/restore-from-export.mjs --env prod --from ./export-staging
   --i-mean-prod`.
4. `[agent]` first prod publish (operator path; it bypasses the two-person
   rule by design): `node scripts/publish.mjs --env prod --source db
   --trigger initial`. Then parity against the LIVE site:
   ```
   node scripts/seo-parity-check.mjs --target https://<UccProd DistributionDomain> --exceptions docs/migration/parity-exceptions.json
   ```
   Must pass (the exceptions file lists the deliberate differences).
5. `[agent]` prod admin owner: §5.
6. **Donor database copy** (needs §2's Cloudflare token). `[agent]`:
   ```
   $env:CLOUDFLARE_API_TOKEN='...'    # or wrangler login
   node scripts/migrate-d1.mjs --env prod --dry-run     # prints D1 vs DSQL counts + donation SUM
   node scripts/migrate-d1.mjs --env prod
   ```
   Idempotent — it is re-run at cutover for the delta (step §7.5). Record
   the donation SUM it prints; it must equal Cloudflare's figure.
7. `[agent]` prod secrets (§3, the `ucc/prod/…` set) before any real traffic.

## 7. Cutover (Phase 6) — needs a `[go]` for each starred step

Prerequisites: §1, §3 (prod), §5, §6 complete; §4 committing; admin hosted
(§8) or accepted as dev-machine-only for the first days.

1. `[dev]` **Custom domain on the prod distribution** — the stack has no
   `utahciviccompact.org` alternate name or certificate yet. The dev adds an
   ACM certificate (us-east-1, DNS validation) + aliases to `UccProd`; you
   `[hand]` add the ACM validation CNAME in Cloudflare DNS (**grey cloud /
   DNS-only** — the orange proxy breaks ACM validation). Deploy, and
   confirm `https://<DistributionDomain>` serves the site with the cert.
   Also `admin.utahciviccompact.org` for §8 if hosting the admin.
2. `[hand]` 24 h before: Cloudflare DNS → `utahciviccompact.org` and `www`
   records → TTL **300 s**.
3. `[agent]` T-1 h freeze check: `node scripts/url-inventory.mjs --base
   https://utahciviccompact.org --out docs/migration/url-inventory.cutover.json`
   and the parity check from §6.4 against prod CloudFront — green.
4. ★ `[hand]` DNS flip: `utahciviccompact.org` → CNAME (or CNAME-flattened
   apex) to `<DistributionDomain>`, `www` likewise, **DNS-only**. Stripe's
   webhook URL and signing secret do not change — delivery follows DNS.
5. ★ `[agent]` right after the flip, donor delta: `node
   scripts/migrate-d1.mjs --env prod` again (idempotent; picks up donations
   that landed on Cloudflare during propagation). Then compare
   `/api/donations/stats` old vs new.
6. `[agent]` watch for 72 h: CloudWatch log groups `/aws/lambda/UccProd-*`
   (errors), Stripe → Webhooks → delivery attempts (all 2xx), Search
   Console coverage. Ops emails from §1 arrive on anything the reconciler
   rolls back.
7. `[hand]` keep the Cloudflare Pages project **deployable but idle for 30
   days** (rollback = flip DNS back). Do not delete D1 until then.
8. After 30 days `[dev]`: retire `functions/`, `workers/auth/`,
   `static/admin/` (Decap), `wrangler.toml`, `build.js`'s Cloudflare path;
   move `refactor` to `main`. Only after §4 is committing nightly.

## 8. Admin hosting — Amplify (needs the GitHub repo owner)

Until this exists the admin runs only on a developer machine (`npm run dev
-w @uccsite/admin`), which is fine for staging.

1. `[hand]` AWS Console (017110365763, us-west-2) → Amplify → New app →
   GitHub → authorize the Amplify GitHub App on `CatAuditor/uccsite` → tick
   **monorepo**, app root `apps/admin`, branch `refactor` (staging now;
   `main` → prod at cutover with domain `admin.utahciviccompact.org`).
   `amplify.yml` at the repo root is the build spec.
2. `[agent]` env vars for the branch — everything `node
   scripts/admin-env.mjs --env staging` writes to `apps/admin/.env.local`
   (`UCC_ENV, UCC_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN,
   DSQL_ENDPOINT, PUBLISH_FUNCTION_NAME, MEDIA_BUCKET, SITE_BUCKET,
   PUBLIC_ORIGIN`) plus `APP_ORIGIN` = the branch URL
   (`https://<branch>.<appid>.amplifyapp.com`) and `SITE_SRC_ROOT=site-src`.
   `aws amplify update-branch --profile uccsite --app-id <id> --branch-name refactor --environment-variables KEY=value,...`
3. `[agent]` SSR compute role (App settings → IAM roles; trust
   `amplify.amazonaws.com`) with: `dsql:DbConnectAdmin` on the cluster;
   `lambda:InvokeFunction` on `PublishFunctionName`; `s3:PutObject`,
   `s3:GetObject`, `s3:DeleteObject` on `<MediaBucketName>/*` (media AND
   project files); `s3:GetObject` on `<SiteBucketName>/css/styles.css`;
   on the user pool: `cognito-idp:ListUsers, AdminGetUser,
   AdminListGroupsForUser, AdminCreateUser, AdminAddUserToGroup,
   AdminRemoveUserFromGroup, AdminDisableUser, AdminEnableUser,
   AdminResetUserPassword, AdminSetUserMFAPreference, AdminUserGlobalSignOut`.
4. `[agent]` register the URL with Cognito + S3 CORS: put the branch URL in
   `infra/cdk/cdk.json` as `"stagingAdminOrigin"` and `npx cdk deploy
   UccStaging --profile uccsite`. Without it: `redirect_mismatch` on
   sign-in and CORS failures on upload. (Prod's
   `https://admin.utahciviccompact.org` is already wired in the stack.)
5. `[agent]` verify: open the branch URL → Sign in → dashboard renders,
   Media upload works. If saves fail with "Invalid Server Actions request",
   compare the `x-forwarded-host` Amplify sends with `apps/admin/next.config.js`
   `allowedOrigins` → `[dev]`.
6. Optional `[hand]`: Amplify branch password on staging as a second gate.

## 9. Open items the dev owns (for awareness)

- **Project files publish is one-person** (`/files` → `/files/*` goes live
  on one editor's click). Contradicts the two-person rule; recorded as an
  exception in `docs/systems/admin.md`. `[dev]` route it through the
  publish request.
- **Custom domain + ACM on `UccProd`** (§7.1) is not in the stack yet.
- Spec §20's tail was lost; org decision: the dev's judgement governs.

## Done

- [x] 2026-09-13 — staging fully built (Phases 0–9), reviewed, published;
  Jarom owner user in the staging pool; this runbook.
