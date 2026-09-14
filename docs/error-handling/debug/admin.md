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
| lib/publish.js `approvePublish` | `<email> approve not sent: run <id> in flight` | approve while a run is still publishing | — |
| lib/publish.js `approvePublish` | `<email> tried to approve their own publish request <id>` | never (the UI hides the button from the requester) | someone crafted the action call; the guard refused it |
| lib/publish.js `approvePublish` | `<email> publish invoke failed for request <id>: <message>` | never | IAM (`lambda:InvokeFunction` on PublishFn missing from the SSR role) or throttling; the request was reopened as pending, audit `publish.invoke_failed` |
| lib/data.js via lib/publish.js | `<actor> publish.request/approve/decline/withdraw/invoke_failed publish_request/<id>` | one per decision | an `approve` line with no `publish_runs` row `approve:<id>:…` within a minute = the async invoke was accepted but the Lambda never ran (check its CloudWatch log group) |
| media (see media.md) | `[media] …` | | |
| lib/account.js | `[account] ListWebAuthnCredentials failed: <message>` | never | pool lacks passkey config or the access token lacks the cognito admin scope (sign out/in after a scope change) |
| lib/actions.js via /profile, /users | `action failed: NotAuthorizedException…` mapped to friendly text | wrong current password | `LimitExceededException` = Cognito throttling; wait |
| aws/publish (CloudWatch) | `[publish] redirects: KeyValueStore updated (N put, M deleted)` / `already in sync` / `WARNING: redirects sync failed: …` | per publish | `Neither CRT nor JS SigV4a` = signature-v4a not bundled; AccessDenied = missing cloudfront-keyvaluestore grant |

Config errors (`COGNITO_POOL_ID is not set (run: node scripts/admin-env.mjs …)`)
are thrown, not logged: they surface as a 500 through app/error.js, never
as "not logged in".
