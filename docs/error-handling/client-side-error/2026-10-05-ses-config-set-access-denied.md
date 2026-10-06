# 2026-10-05 — SES send denied on staging: configuration set not in IAM

## Error

CloudWatch `/aws/lambda/UccStaging-ApiFunction*`, from `aws/api/routes.js` `sesSend`:

```
[api] SES error: AccessDeniedException User 'arn:aws:sts::017110365763:assumed-role/UccStaging-ApiFunctionServiceRole.../UccStaging-ApiFunction...' is not authorized to perform 'ses:SendEmail' on resource 'arn:aws:ses:us-west-2:017110365763:configuration-set/ucc-prod'
```

## Route / repro

`POST /api/subscribe` on staging with `success@simulator.amazonses.com` →
`200 {ok:true}` (correct — the user response never depends on the email),
then the `welcome-email` self-invoke job logged the error above. No email
sent.

## Root cause

The first SES cut of the API role policy granted `ses:SendEmail` on the
domain identity ARN only, and added the `configuration-set/ucc-prod` ARN on
**prod only**, on the assumption that staging (which sets no
`SES_CONFIGURATION_SET`) would send without a set. But the UccProd stack
attaches `ucc-prod` to the identity as its **default configuration set**
(`ses.EmailIdentity({ configurationSet })`). SES applies the default set to
every send through that identity and authorizes against its ARN, so the
staging role was denied.

## Fix

`infra/cdk/lib/ucc-stack.js`: the `ses:SendEmail` statement lists both the
identity ARN and the configuration-set ARN on both stacks. Redeployed
staging; the simulator send then logged `[api] SES sent <MessageId>`.

## What would catch it earlier

Exactly what did: a staging deploy + simulator send before prod. Keep that
order for any IAM change on the send path. The debug table in
`docs/error-handling/debug/api.md` now names `AccessDeniedException` on this
line as "IAM: From not hello@, or config-set ARN missing".
