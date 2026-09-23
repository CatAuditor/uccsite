# 2026-09-23 — a failed prod deploy leaves secrets that block every retry

## Error

Second `cdk deploy UccProd` attempt, after fixing the Cognito passkey failure:

```
CREATE_FAILED | AWS::SecretsManager::Secret | ExportSecretGITHUB_APP_ID
The operation failed because the secret ucc/prod/GITHUB_APP_ID already exists.
(Service: SecretsManager, Status Code: 400, HandlerErrorCode: AlreadyExists)
```

Same for `ucc/prod/GITHUB_APP_INSTALLATION_ID` and
`ucc/prod/GITHUB_APP_PRIVATE_KEY`.

## Cause

`infra/cdk/lib/ucc-stack.js` gives prod secrets a retain policy:

```js
removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
```

The first attempt created all three secrets at `11:32:29`. The Cognito user pool
failed two seconds later, at `11:32:31`. During rollback CloudFormation would
normally delete resources it had just created — but `RETAIN` told it to keep
them. The stack no longer references them; the names stay taken.

The next deploy then tries to create the same names and fails.

This repeats indefinitely: **any** failed prod deploy that reaches secret
creation blocks every subsequent attempt until the orphans are removed by hand.
Staging never shows it because staging uses `DESTROY`.

## Fix

Delete the orphans, then redeploy:

```
aws secretsmanager delete-secret --profile uccsite --region us-west-2 \
  --secret-id ucc/prod/GITHUB_APP_ID --force-delete-without-recovery
```

`--force-delete-without-recovery` is required. A scheduled deletion (the default
7–30 day recovery window) keeps the name reserved, and the deploy fails
identically.

Check before deleting that the secret is still a placeholder — `LastChangedDate`
equal to `CreatedDate` means nothing has ever been written to it:

```
aws secretsmanager describe-secret --profile uccsite --region us-west-2 \
  --secret-id ucc/prod/<NAME> --query '[CreatedDate,LastChangedDate]'
```

Never force-delete a secret whose `LastChangedDate` is later than its
`CreatedDate` — that one holds a real value.

The third attempt reached `UPDATE_COMPLETE` in 140s with all 15 outputs.

## Open follow-up

`RETAIN` is right for secrets holding live credentials and wrong during
build-out, when every prod secret is still `REPLACE_ME`. Worth an ADR on whether
to keep `RETAIN` and accept manual cleanup after a failed deploy, or move to
`DESTROY` until the first real values are filled in (`docs/for-conner.md` §3).

Related: `2026-09-23-cognito-passkey-relying-party.md`, the failure that caused
this one.
