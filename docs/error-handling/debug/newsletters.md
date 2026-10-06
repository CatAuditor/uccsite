# Debug logging — newsletters

Prefixes: `[newsletter]` (NewsletterSendFn Lambda, CloudWatch
`/aws/lambda/<stack>-NewsletterSendFn…`) and `[admin] … newsletter …`
(admin server). Feature doc: docs/systems/newsletters.md. No recipient
address or body is ever logged — the `newsletter_deliveries` table holds the
per-recipient outcome.

| Where | Log | Normal | Broken |
|---|---|---|---|
| handler.mjs `runOne` | `<id> starting/resuming subject="…" scheduled=…` | one per send (plus one per resume) | none after an approve → the admin's invoke failed (see `[admin]` line) or the tick is not firing (EventBridge rule `NewsletterTick`) |
| handler.mjs `runOne` | `<id> not claimable (already sending/sent, cancelled, or not due)` | a tick and a direct invoke racing; a cancel just before the tick | every attempt → row stuck in a status the claim refuses (check `newsletters.status`) |
| handler.mjs `runOne` | `<id> recipients=N` | N = the Mailing list count for the frozen filters | `recipients=0` → nobody matches any more (the request refused 0, so people unsubscribed since) |
| send.js | `<id> send #i failed: <Name> <message>` | rare `Throttling`/`MessageRejected` | many in a row → SES account issue (suppression, quota — `sesv2 get-account`); `AccessDeniedException` → the Lambda role's `ses:SendEmail` no longer matches the From pin |
| send.js | `<id> pausing at i/N (time); will resume` | only on very large audiences (>~8k) | repeating with no progress → each resume fails before sending (look for the `FAILED` line) |
| handler.mjs | `<id> done sent=… failed=… unknown=…` | `unknown=0` | `unknown>0` = delivery rows left `sending` by a crashed run; those recipients were NOT sent to and are not retried automatically (manual: delete those rows, then Retry) |
| handler.mjs | `<id> FAILED: <Name> <message>` | never | `TOKEN_SECRET is unset` → fill the secret, Retry; DB errors → DSQL/IAM |
| handler.mjs `tick` | `tick: <id> is due` / `tick: <id> stalled, resuming` | one per scheduled send; stalled = never | stalled repeatedly → the Lambda crashes early on resume (read its own log) |
| lib/newsletters.js | `[admin] <who> newsletter <id> send invoked` | one per "send now" approval / retry | — |
| lib/newsletters.js | `[admin] <who> newsletter <id> invoke failed: <message>` | never | `AccessDeniedException` → `lambda:InvokeFunction` on NewsletterSendFn missing from `UccProdAdminCompute`/`admin-runtime`; `NEWSLETTER_FUNCTION_NAME is not set` → Amplify env var missing. The request was reopened (`newsletter.invoke_failed` audit) |
| lib/newsletters.js | `[admin] newsletter <id> test sent <MessageId>` / `test SES error: <Name> <message>` | one per test | `AccessDeniedException` = `ses:SendEmail` missing from the SSR role |
| lib/newsletters.js | `[admin] <who> (owner) self-approving newsletter <id>` / `tried to approve their own newsletter` | owner self-approvals | an editor hitting the guard = crafted action call |
| lib/notify.js | `newsletter notify sent/skipped/SES error …` | as for publish requests (docs/error-handling/debug/admin.md) | |
| lib/data.js | `<actor> newsletter.<verb> newsletter/<id>` | one per action | |

E2E without touching the real audience:
`$env:AWS_PROFILE='uccsite'; node scripts/newsletter-smoke.mjs --env staging`
(mailbox simulator; prints the delivery ledger; cleans up).
