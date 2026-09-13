# API secrets: runtime Secrets Manager reads, not deploy-time resolution

**Date:** 2026-09-12 · **Status:** Accepted

## Decision

The API Lambda loads its secrets (`ucc/<env>/<NAME>`) at runtime via
`GetSecretValue` (aws/api/secrets.js), cached per container with failed
fetches never cached. CDK creates the secrets with a placeholder; the operator
pastes real values in the console (docs/for-conner.md).

## Why not `{{resolve:secretsmanager:...}}`?

`.claude/aws-agent-rules.md` prefers CloudFormation dynamic references so
secret values never enter an agent's context. That rule is honored in spirit —
values never appear in the template, the synth output, the Lambda env, or any
session transcript — but dynamic references resolve at DEPLOY time into the
Lambda's env configuration, which means:
- rotating a secret (or replacing the TOKEN_SECRET placeholder with the real
  one at cutover) would require a redeploy to take effect, and
- the resolved values sit in the function's env block, visible in the console.

Runtime reads pick up a changed secret at the next cold start with no deploy,
and the value lives only in process memory. The alternative rule intent
(`asm-exec`) targets local CLI workflows, not Lambda code paths.

## What breaks if reversed

Moving to deploy-time dynamic references silently reintroduces the
"secret changed but the Lambda still uses the old one" failure at cutover —
exactly when TOKEN_SECRET and STRIPE_WEBHOOK_SECRET move from placeholder to
live values.
