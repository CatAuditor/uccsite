# Admin App (apps/admin — Phase 7)

Cognito-gated content editing + publish. Next.js 15 (JavaScript, no CSS
framework), runs locally via `next dev` against a deployed environment;
Amplify Hosting at `admin.utahciviccompact.org` at rollout.

## Code Map

```
apps/admin/
  middleware.js            cookieless requests → /login (verification is NOT here)
  lib/config.js            env-driven config (scripts/admin-env.mjs writes .env.local)
  lib/auth.js              hosted-UI authorization-code + PKCE (server-side),
                           ID token in httpOnly cookie, aws-jwt-verify on EVERY
                           read, roles from cognito:groups, requireRole()
  lib/data.js              withDb + recordChange (revisions last-20 + audit_log)
                           + latestPublishRuns
  lib/collections.js       field specs per collection (the config.yml successor —
                           but the DB is the schema; adding a field is a migration)
  lib/collection-save.js   sanitize → baseline (lost-update) check → alt-text
                           gate → scoped wipe-and-load → revision + audit, ONE txn
  lib/actions.js           runAction: { ok } | { error } result convention
  app/action-form.js       client form wrapper rendering that result
  app/error.js             backstop error boundary
  lib/media.js             media library server helpers (docs/systems/media.md)
  app/page.js              Publish button (async PublishFn invoke, audit-logged)
                           + publish_runs history (Publishing…/Live hh:mm/failed)
  app/settings, /homepage, /team, /statements, /issues, /blog, /coverage
                           collection editors (generic ListEditor client component)
  app/media                media library: presigned-PUT uploads, sharp variants
                           via the MediaProcessFn Lambda, alt text, delete
                           (docs/systems/media.md)
  app/revisions            revisions browser + restore-and-republish
  app/donations            staff view: every donation + contact info (addendum 2)
  app/audit                audit trail
  app/documents            Phase 8 placeholder
scripts/admin-env.mjs      stack outputs → apps/admin/.env.local
```

## Auth

- Login → Cognito hosted UI (`ucc-admin-<env>.auth.us-west-2.amazoncognito.com`),
  code + PKCE exchanged server-side; ID token stored httpOnly/SameSite=Lax,
  1h expiry (re-login after; no refresh flow yet).
- `getSession()` verifies the JWT on every server read. Roles: `owner` >
  `editor` > `viewer`; an authenticated user in no group has NO access —
  the callback refuses to set the cookie and `/login?error=nogroup` says why.
- Sign-out is a POST (`/logout`); redirects in the callback/middleware are
  built from `APP_ORIGIN`, never the request Host.
- Donor PII (`/donations`) is `editor`+ (spec §11: viewer = read-only
  content; editor "reads form submissions"). Viewer sees every content
  editor read-only and the audit/revision lists.
- Prod Cognito client: SRP only (no `USER_PASSWORD_AUTH` — staging keeps it
  for scripted smoke tests), `preventUserExistenceErrors`, no localhost
  callback. Cognito callback/logout URLs and the media bucket CORS come
  from ONE origin list in the stack.
- **Every server action calls `requireRole('editor')`** — UI disabling is
  cosmetic, authorization lives in the data layer (spec §11).
- No self-signup. Users are created with `admin-create-user` (see
  docs/for-conner.md). Staging test users: test-{owner,editor,viewer}@…

## Editing model

Saves write the DATABASE only (with a `revisions` snapshot pruned to the
last 20 per entity, and an `audit_log` row); the live site changes on the
next Publish. Publish invokes the PublishFn Lambda asynchronously; the
dashboard polls `publish_runs` for Draft/Publishing…/Live/Failed/Refused
(the Lambda holds the real mutex — docs/systems/publish-pipeline.md).

Review fixes 2026-09-13 (the rules every editor page follows):

- **One transaction per save** (`withWriteTx` in lib/data.js): the
  wipe-and-load / upsert, the revision snapshot and the audit row commit
  together, replayed whole on a DSQL 40001 abort. packages/db helpers take
  `tx: false` inside it.
- **Lost-update check**: the form carries a `baseline` stamp
  (`collectionStamp` = count + MAX(updated_at); `singletonStamp` =
  updated_at); the save re-reads it in the transaction and refuses with
  "Someone else saved this since you opened it…" on mismatch.
- **Actions return `{ ok } | { error }`** (lib/actions.js `runAction`)
  and pages render them through `app/action-form.js` (useActionState).
  Next 15 masks thrown action messages in production, so throwing would
  turn "needs alt text" into a generic crash that also discards the
  editor's unsaved list. `app/error.js` is the backstop for render-time
  failures.
- **Restore** runs in the same transaction shape, refuses unknown entity
  types before touching anything, applies the alt-text gate to snapshots,
  and reports "started a publish" (the Lambda may refuse it if one is
  running — visible on the dashboard).
- **Singleton drift guards** at boot: `SETTINGS_FIELDS` ≡
  `FIELD_MAPS.site_settings`; `HOMEPAGE_GROUPS` keys ≡ homepage JSON
  columns (field keys inside a group follow templates/index.html).

## Env vars (lib/config.js)

`UCC_ENV, UCC_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN,
DSQL_ENDPOINT, PUBLISH_FUNCTION_NAME, MEDIA_BUCKET, APP_ORIGIN`. Missing →
loud throw at first use. AWS credentials: local = `AWS_PROFILE=uccsite`;
Amplify Hosting = the app's SSR compute role (wire-up pending; it needs
`dsql:DbConnectAdmin`, `lambda:InvokeFunction` on PublishFn, and
`s3:PutObject/GetObject/DeleteObject` on the media bucket).

## Verified (2026-09-13, staging)

Headless smoke with real Cognito password-flow tokens: cookieless → 307
/login; editor token renders dashboard (email, publish history), settings
pre-filled from DSQL, and all six collection editors show live content
(team names, statement slug, blog articles, coverage strips, homepage
groups + press). Form-submit round trip needs a browser session — first
manual pass pending.

## Amplify Hosting (deploy checklist — blocked on repo access, see for-conner.md)

1. Amplify console → new app → GitHub `CatAuditor/uccsite`, "monorepo",
   app root `apps/admin`, platform WEB_COMPUTE. Branch `refactor` (staging)
   now; `main` → prod with custom domain `admin.utahciviccompact.org` at
   cutover. `amplify.yml` at the repo root is the build spec (it copies the
   runtime env vars into `.env.production` — console env vars are
   build-time only on Amplify).
2. Env vars per branch: everything `scripts/admin-env.mjs` writes (`UCC_ENV,
   UCC_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN,
   DSQL_ENDPOINT, PUBLISH_FUNCTION_NAME, MEDIA_BUCKET`) + `APP_ORIGIN` = the
   branch URL (`https://<branch>.<appid>.amplifyapp.com`).
3. SSR compute role (App settings → IAM roles, trust `amplify.amazonaws.com`):
   `dsql:DbConnectAdmin` on the cluster, `lambda:InvokeFunction` on
   PublishFn, `s3:PutObject/GetObject/DeleteObject` on `<MediaBucketName>/*`.
4. Put the branch URL in `infra/cdk/cdk.json` as `stagingAdminOrigin` and
   `cdk deploy UccStaging` — that registers the Cognito callback/logout
   URLs and the S3 CORS origin. Without it: `redirect_mismatch` on sign-in
   and CORS failures on upload.
5. `next.config.js` allows Server Actions from `APP_ORIGIN`'s host; if
   saves still fail with "Invalid Server Actions request", compare the
   `x-forwarded-host` Amplify sends and add it there.
6. Optional: Amplify branch password on staging as a second gate.

## Not yet (rest of Phase 7)

Amplify Hosting deployment, THEN Decap + workers/auth retirement (only once
the export is actually committing — needs the GitHub App secrets from
docs/for-conner.md). Done 2026-09-13: media library, revisions
restore-and-republish, content export Lambda + restore script + staging
restore drill (docs/systems/content-export.md).
