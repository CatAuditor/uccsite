# Admin App (apps/admin — Phase 7)

Cognito-gated content editing + publish. Next.js 15 (JavaScript, no CSS
framework), runs locally via `next dev` against a deployed environment;
Amplify Hosting at `admin.utahciviccompact.org` at rollout.

## Code Map

```
apps/admin/
  middleware.js            cookieless requests → /login (verification is NOT here)
  lib/config.js            env-driven config (scripts/admin-env.mjs writes .env.local)
  lib/aws-account.js       wrong-account guard: STS GetCallerIdentity vs UCC_ACCOUNT_ID,
                           once per process, before any DB use (no-op when unset)
  instrumentation.js       Next boot hook: runs the account guard so a wrong profile
                           is loud in the terminal at startup
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
  lib/publish.js           two-person publishing: request / approve / decline /
                           withdraw; the ONLY admin code that invokes PublishFn
  app/action-form.js       client form wrapper rendering that result
  app/error.js             backstop error boundary
  lib/media.js             media library server helpers (docs/systems/media.md)
  lib/files.js             project files server helpers (docs/systems/files.md)
  lib/account.js           Cognito self-service (password, TOTP, passkeys) +
                           owner user administration
  app/profile              My profile & security: change password, authenticator
                           MFA, security keys / passkeys, own bio + headshot
  app/users                owner-only: invite, role, disable, reset password,
                           remove MFA, sign out everywhere
  app/redirects            redirects table → CloudFront KeyValueStore on publish
  app/subscribers          newsletter list (editor+) + CSV export (audited)
  app/tips                 tipline inbox (editor+): list w/ status filter, [id] detail,
                           status change (audited tip.status), owner-only delete
                           (audited tip.delete, no snapshot) — docs/systems/tipline.md
  app/page.js              Publish & Status: unpublished saves → publish request
                           → a different admin approves (async PublishFn invoke)
                           or declines with notes; request history + publish_runs
                           history (Publishing…/Live hh:mm/failed)
  app/appeals              Donation appeals: homepage donate section + timed modal +
                           download modal, one save (docs/decisions/donation-appeals-page.md)
  app/settings, /homepage, /team, /statements, /issues, /blog, /coverage,
  /projects                collection editors (generic ListEditor client component;
                           projects is nested — docs/systems/projects.md)
  app/media                media library: presigned-PUT uploads, sharp variants
                           via the MediaProcessFn Lambda, alt text, delete
                           (docs/systems/media.md)
  app/files                project files: upload, project/folder organisation,
                           download, publish to /files/* (docs/systems/files.md)
  app/revisions            revisions browser + restore (a draft — goes live
                           through a publish request like any save)
  app/donations            staff view: every donation + contact info (addendum 2)
  app/audit                audit trail
  app/documents            Documents list/create + [id] editor (Phase 8,
                           docs/systems/documents.md); app/styles rules/kit
  lib/documents.js         editor data, Style Kit, preview, match counts
scripts/admin-env.mjs      stack outputs → apps/admin/.env.local
```

## What the admin covers (site-management audit, 2026-09-13)

| Site need | Where |
|---|---|
| Every collection the templates render (settings, homepage, team, statements, policy positions, news articles/videos, projects + press/videos, report coverage) | Site Main editors |
| Long-form pages, their styling, SEO, JSON-LD | Documents + Styles |
| Images | Media Library |
| Files (PDFs, spreadsheets, records…) shared between staff, optionally published at `/files/…` and listed on /projects | Files |
| Every donation ask (homepage section, timed modal, download modal) | Donation appeals |
| Moved / retired URLs | Redirects (synced to the edge on publish) |
| Publish (two-person rule), rollback, history | Publish & Status, Revisions, Audit Log |
| Donors, newsletter list (+ CSV for the periodical) | Donations, Subscribers |
| Confidential tips: read, triage status, delete | Tips (editor+; delete is owner) |
| Accounts, roles, MFA, security keys | Users (owners), My profile (everyone) |

Not in the admin by design: secrets (Secrets Manager), templates for fixed
pages (developer-owned, spec §3.3), sending the periodical
(`scripts/send-periodical.js`).

## Account & security (spec §11)

- Sign-in: Cognito **managed login** (newer hosted pages). First factor is a
  password or a **passkey / security key** (`allowedFirstAuthFactors:
  password + passkey`); optional **authenticator-app (TOTP) MFA**.
- The pool's passkey relying-party ID is the pool domain, so security keys
  are registered on the pool's `/passkeys/add` page (the profile page links
  there and it returns to `/profile`, which is a registered callback URL).
  Listing and removing keys happens in the admin via the user's access token.
- The OAuth scope `aws.cognito.signin.user.admin` is requested so the access
  token (second httpOnly cookie, `ucc_admin_access_token`) can call the
  user's own ChangePassword / TOTP / WebAuthn APIs. Both cookies expire in 1 h.
  Because that scope also lets a user change their own email attribute, the
  session only accepts a **verified** email claim and the pool keeps the
  original email until a new one is verified (`keepOriginal`); owner
  self-guards compare `cognito:username`, not email. Turning MFA off or
  removing a security key requires a sign-in less than 15 minutes old
  (`auth_time`).
- Everyone can edit their **own** bio, title and headshot on `/profile` when a
  team member carries their email (`team_members.email`, set by an editor in
  the Team editor; never published). Other people's entries: the Team page.
- Owners manage users on `/users`: invite (Cognito emails a temporary
  password), role (owner/editor/viewer group), disable/enable (+ global
  sign-out), force password reset, remove authenticator MFA, sign out
  everywhere. Admin cookies last an hour: a role change or sign-out takes
  effect at the next sign-in unless the user is signed out everywhere and
  their cookie has expired. Every action writes an `audit_log` row
  (`user.*`, `account.*`).
- CLI equivalent for the first owner: `node scripts/admin-user.mjs --env
  staging --email … --name "…" --group owner`.

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
next approved publish (see "Publishing" below). An approval invokes the
PublishFn Lambda asynchronously; the dashboard polls `publish_runs` for
Draft/Publishing…/Live/Failed/Refused (the Lambda holds the real mutex —
docs/systems/publish-pipeline.md).

## Publishing (two-person rule, 2026-09-13)

No post or update goes live on one person's say-so. `lib/publish.js` +
`packages/db/publish-requests.js` (table `publish_requests`, DDL wired into
`content-schema.js`; ADR docs/decisions/two-person-publish.md):

1. **Request** (editor+): the dashboard lists the content audit rows since
   the last `succeeded`/`noop` publish run ("unpublished saves"); the
   writer adds an optional note and submits. Refused if a request is
   already pending or there is nothing to publish. Audit `publish.request`.
2. **Review** (a DIFFERENT editor/owner — compared by `cognito:username`
   AND email, so an owner cannot approve their own request either):
   - **Approve** → the form carries `seenThrough` (the newest save the
     reviewer's page listed); inside the transaction any content audit row
     after it refuses the approval ("more saves landed since you opened
     this page — reload") so nobody approves what they have not seen. Then
     row set `approved` by a conditional `UPDATE … WHERE status =
     'pending'` (two reviewers racing: one wins, the other sees "just
     reviewed by someone else"), audit `publish.approve`, THEN the Lambda
     is invoked with `trigger = approve:<request id>:<reviewer email>`
     (outside the transaction, so a 40001 replay can't invoke twice).
     Refused while a publish is in flight. If the invoke itself fails the
     request is reopened (`pending`, audit `publish.invoke_failed`) and the
     reviewer is told nothing started. The request table joins each
     approval to its run by that trigger: "Approved — live / publishing… /
     FAILED / refused / not started".
   - **Decline** → note REQUIRED; row `declined`; audit `publish.decline`.
     The writer sees the note on the dashboard's request history.
   - **Withdraw** → the requester (or an owner clearing a stale request);
     audit `publish.withdraw`.
3. A publish renders the whole database, so saves made AFTER the request
   go live too; the pending panel lists them separately ("Also saved after
   the request") so the reviewer knows what they are approving (and the
   `seenThrough` check above guarantees the list was complete).

"Unpublished" = content audit rows after the `started_at` of the newest
succeeded/noop run (the Lambda snapshots the database right after it
starts, so a save committed during a render is still unpublished).
`requestPublish` bumps a one-row `publish_request_gate` inside its
transaction so two racing requests conflict (DSQL only detects write-write
conflicts) and the loser sees the winner's pending row.

The request stores its change list (`changes` JSON = the audit rows it
covered) for the record. Viewers see everything read-only.

**Explicit exceptions** (paths that change the public site without a
second admin): developer CLI publishes (`scripts/publish.mjs`) and the
Lambda's own redirect-verify runs — operator actions, not content edits;
and **project files** (`app/files` "Publish" copies a file to `/files/*`
immediately, editor role, docs/systems/files.md). The files exception is
an open gap against the rule, not a design choice — see for-conner.md /
changelog; routing it through the request is the intended fix.

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
  and does NOT publish: the restored content is a draft that goes live
  through a publish request like any save (it appears in the request's
  change list as `<type>.restore`).
- **Singleton drift guards** at boot: `SETTINGS_FIELDS` ∪
  `APPEAL_SETTINGS_FIELDS` ≡ `FIELD_MAPS.site_settings` (disjoint);
  `HOMEPAGE_GROUPS` keys ≡ homepage JSON columns (field keys inside a group
  follow templates/index.html). Groups flagged `appeals: true` and the
  appeal settings fields are edited on `/appeals` only; Site Settings and
  Homepage save `{ ...current, ...ownFields }` so neither page nulls the
  other's columns.

## Env vars (lib/config.js)

`UCC_ENV, UCC_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN,
DSQL_ENDPOINT, PUBLISH_FUNCTION_NAME, MEDIA_BUCKET, SITE_BUCKET, PUBLIC_ORIGIN,
APP_ORIGIN` (+ `SITE_SRC_ROOT` on Amplify). Missing →
loud throw at first use. `UCC_ACCOUNT_ID` (local only, from the stack ARN):
when set, `lib/aws-account.js` calls STS once per process and refuses every
DB use — and logs at boot via `instrumentation.js` — if the resolved
credentials belong to another account (the "forgot AWS_PROFILE" failure,
docs/error-handling/client-side-error/2026-09-13-admin-dev-wrong-aws-profile.md).
Leave it unset on Amplify. AWS credentials: local = `AWS_PROFILE=uccsite`;
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

Two-person publishing (2026-09-13, dev server against staging, server
actions invoked headlessly with `Next-Action`): requester approve → "You
requested this publish — a different admin has to approve it"; requester
decline → "withdraw it instead"; owner decline without note → refused;
owner approve → `publish_requests.status = approved`, audit
`publish.approve`, publish run `approve:test-owner@…` (noop — content
unchanged); second approve → "no longer pending".

## Amplify Hosting (deploy checklist — blocked on repo access, see for-conner.md)

1. Amplify console → new app → GitHub `CatAuditor/uccsite`, "monorepo",
   app root `apps/admin`, platform WEB_COMPUTE. Branch `refactor` (staging)
   now; `main` → prod with custom domain `admin.utahciviccompact.org` at
   cutover. `amplify.yml` at the repo root is the build spec (it copies the
   runtime env vars into `.env.production` — console env vars are
   build-time only on Amplify).
2. Env vars per branch: everything `scripts/admin-env.mjs` writes (`UCC_ENV,
   UCC_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN,
   DSQL_ENDPOINT, PUBLISH_FUNCTION_NAME, MEDIA_BUCKET, SITE_BUCKET,
   PUBLIC_ORIGIN`) + `APP_ORIGIN` = the
   branch URL (`https://<branch>.<appid>.amplifyapp.com`).
3. SSR compute role (App settings → IAM roles, trust `amplify.amazonaws.com`):
   `dsql:DbConnectAdmin` on the cluster, `lambda:InvokeFunction` on
   PublishFn, `s3:PutObject/GetObject/DeleteObject` on `<MediaBucketName>/*`,
   `s3:GetObject` on `<SiteBucketName>/css/styles.css` (Style Kit), and on
   the user pool: `cognito-idp:ListUsers, AdminGetUser, AdminListGroupsForUser,
   AdminCreateUser, AdminAddUserToGroup, AdminRemoveUserFromGroup,
   AdminDisableUser, AdminEnableUser, AdminResetUserPassword,
   AdminSetUserMFAPreference, AdminUserGlobalSignOut` (Users page).
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
docs/for-conner.md §4). Done 2026-09-13: media library, revisions restore
(draft; publish through a request), two-person publishing, project files,
content export Lambda + restore script + staging restore drill
(docs/systems/content-export.md).
