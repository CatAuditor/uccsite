# Debug instrumentation: publish pipeline + drift reconciler + db layer

Log prefixes (grep these):

| Tag | Where it fires | What it reports |
|---|---|---|
| `[publish]` | `aws/publish/core.js` via injected `log` (stdout when driven by `scripts/publish.mjs`; CloudWatch when the Phase 7 admin Lambda drives it) | target env line, per-key `put`/`deleted`, invalidation id + path count, `invalidation completed, read-back verified`, final `succeeded: N changed, M removed` / `no changes`, `WARNING: could not record failed run` |
| `[reconcile]` | `aws/reconcile-drift/index.mjs` → CloudWatch log group `/aws/lambda/UccStaging-ReconcileDriftFn*` (or UccProd) | stand-down on in-flight publish, abandoned-publish rollback, per-key `DRIFT key: live=… expected=… restored=…`, `UNEXPECTED key`, per-key `ERROR`, `no drift across N paths`, `FATAL` before rethrow |
| `[db]` | `packages/db/index.js` | `40001 optimistic-concurrency abort, retry i/n` warnings; `giving up after n attempts` |
| `[health]` | `infra/cdk/lambda-health/index.mjs` → `/aws/lambda/UccStaging-ApiFunction*` | `db check failed: <message>` (status/message only, never payloads) |

**Normal looks like:** hourly reconciler logs exactly one line — `no drift
across N paths` — and the publish CLI ends with `succeeded: …` followed by a
JSON summary line.

**Broken looks like:** any `DRIFT`/`UNEXPECTED`/`FATAL` line (also lands in
the SNS OpsAlerts topic), repeated `[db] 40001` warnings (DSQL contention),
or a publish ending without the `read-back verified` line.

SNS alert subjects to know: `… restored`, `… UNRESOLVED … republish needed`,
`… unexpected object(s) …`, `… reconciler FAILED`, `… abandoned publish being
rolled back`. A CloudWatch alarm (`ReconcileErrorsAlarm`) also feeds the same
topic if the reconciler Lambda itself errors.
