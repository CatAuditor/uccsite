# Debug instrumentation: API Lambda (aws/api)

Log group: `/aws/lambda/UccStaging-ApiFunction*` (or UccProd). Prefix: `[api]`.

| Log line | Fires from | Meaning |
|---|---|---|
| `rate limit check failed (<endpoint>): …` | lib.js rateLimitOr429 | DB error during the limit check — request was ALLOWED through (fail-open by design) |
| `turnstile verify failed: …` | lib.js turnstileOr403 | Cloudflare siteverify unreachable — request allowed (fail-open) |
| `webhook signature failed: …` | webhook.js | 401 returned; if persistent, the signing secret is wrong/stale |
| `processed_events insert failed: …` | webhook.js | idempotency table unavailable; events processed WITHOUT dedup |
| `handler error for <type>: …` | webhook.js | 500 returned; processed_events row deleted so Stripe retries |
| `no member for customer …; donation … not recorded` | webhook.js | donation dropped (pre-existing behavior) — investigate the customer |
| `subscribe DB error / unsubscribe DB error` | routes.js | 500 path |
| `welcome email dispatch failed / portal link dispatch failed` | routes.js | async self-invoke failed; user response unaffected |
| `welcome email failed / portal link send failed` | routes.js jobs | Resend send failed inside the async job |
| `Resend error: <status>` | routes.js resendSend | non-2xx from Resend |
| `tip insert failed: <ErrorName>` | routes.js tip | 500 returned; `tips` insert threw — error NAME only, never the message (pg errors echo parameter values) |
| `secret <NAME> is unset (placeholder)` | secrets.js | operator hasn't filled `ucc/<env>/<NAME>` yet |
| `failed to load secret <NAME>: <err>` | secrets.js | transient — retried next invocation (never cached) |
| `PUBLIC_ORIGIN is not set — …` | index.mjs | config error; CDK should have refused to synth |
| `health db check failed: …` | index.mjs | /api/health 503 |

**Normal:** production traffic logs almost nothing — only warnings above
indicate degradation. `[db] 40001 … retry` warnings (packages/db) mean DSQL
contention; occasional is fine, constant is not.

The tipline confidentiality rule applies to ALL of this: request bodies and
database error messages are never logged — status codes and error names only.
