# Debug instrumentation: admin app (apps/admin)

Prefix `[admin]`. Locally: the `next dev` terminal. Deployed: Amplify Hosting
SSR logs (CloudWatch, once hosting is wired).

| Log line | Fires from | Meaning |
|---|---|---|
| `request with invalid/ungrouped session token — redirecting to login` | lib/auth.js requireSession | cookie present but JWT failed verification OR the user is in no Cognito group |
| `auth callback failed: <msg>` | app/auth/callback | PKCE mismatch / token exchange / verify failure → bounced to /login?error=1 |
| `<actor> <action> <entity>` | lib/data.js recordChange | every audited mutation (saves, publish triggers) — one line per admin action |
| `<email> publish refused: run <id> in flight` | app/page.js publishNow | server-side in-flight guard rejected a concurrent publish |

**Normal:** one `recordChange` line per admin action; nothing else.
**Broken:** repeated requireSession warnings (expired/forged cookies or a
user missing a group), or callback failures (check Cognito client callback
URLs vs APP_ORIGIN).

Publish outcomes themselves log under `[publish]` in the PublishFn Lambda's
log group — see debug/publish-pipeline.md.
