# Debug logging — admin app (apps/admin)

Prefix: `[admin]`. Feature doc: docs/systems/admin.md. Logs: the Next.js
server console locally; CloudWatch for the Amplify SSR compute once hosted.

| Where | Log | Normal | Broken |
|---|---|---|---|
| lib/auth.js `getSession` | `session token rejected: <ErrorName>: <message>` | occasional `JwtExpiredError` after 1 h | a burst of `JwksError`/fetch failures = Cognito JWKS unreachable (everyone looks logged out); `JwtInvalidClaimError` = wrong pool/client id in env |
| lib/auth.js `requireSession` | `request with invalid/ungrouped session token — redirecting to login` | after expiry | constant = see line above |
| app/auth/callback | `sign-in by a user in no Cognito group — refused` | new account not yet grouped (login page shows the nogroup message) | — |
| app/auth/callback | `auth callback failed: <message>` | — | `PKCE state mismatch` = cookie lost between /login and callback (APP_ORIGIN ≠ real origin, or a second tab); `token exchange failed (400)` = redirect_uri not registered on the Cognito client |
| lib/actions.js `runAction` | `action failed: <message>` | validation refusals (alt text, conflict) — the same text the editor sees | `Requires editor role` from a viewer = UI let a viewer submit |
| lib/data.js `recordChange` | `<actor> <action> <entity>/<id>` | one per mutation | a save with no line = it threw before commit (nothing landed) |
| app/page.js | `<email> publish not sent: run <id> in flight` | double click | — |
| media (see media.md) | `[media] …` | | |

Config errors (`COGNITO_POOL_ID is not set (run: node scripts/admin-env.mjs …)`)
are thrown, not logged: they surface as a 500 through app/error.js, never
as "not logged in".
