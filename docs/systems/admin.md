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
  lib/collection-save.js   sanitize → alt-text gate → scoped wipe-and-load →
                           revision + audit
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
  `editor` > `viewer`; an authenticated user in no group has NO access.
- **Every server action calls `requireRole('editor')`** — UI disabling is
  cosmetic, authorization lives in the data layer (spec §11).
- No self-signup. Users are created with `admin-create-user` (see
  docs/for-conner.md). Staging test users: test-{owner,editor,viewer}@…

## Editing model

Saves write the DATABASE only (with a `revisions` snapshot pruned to the
last 20 per entity, and an `audit_log` row); the live site changes on the
next Publish. Publish invokes the PublishFn Lambda asynchronously; the
dashboard polls `publish_runs` for Draft/Publishing…/Live/Failed.

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

## Not yet (rest of Phase 7)

Amplify Hosting deployment, THEN Decap + workers/auth retirement (only once
the export is actually committing — needs the GitHub App secrets from
docs/for-conner.md). Done 2026-09-13: media library, revisions
restore-and-republish, content export Lambda + restore script + staging
restore drill (docs/systems/content-export.md).
