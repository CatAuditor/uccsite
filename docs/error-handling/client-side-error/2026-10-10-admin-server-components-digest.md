# 2026-10-10 — Admin: "An error occurred in the Server Components render" (digest 3582361700)

## What the user saw

Production admin (Amplify build 113 = commit f4de1ed, v0.29.4), evening of
2026-10-09 MDT:

```
An error occurred in the Server Components render. The specific message is
omitted in production builds to avoid leaking sensitive details. A digest
property is included on this error instance which may provide additional
details about the nature of the error.
ref 3582361700
```

That is Next's production mask (`app/error.js` shows it); the real message
only exists in the server log — and the admin had **no server log**: the
Amplify app had no IAM service role, so Amplify Hosting compute never wrote
SSR logs to CloudWatch (`/aws/amplify/<appId>` did not exist).

## What was checked

| Check | Result |
|---|---|
| `AWS/AmplifyHosting 5xxErrors` for app `dmfjtx0gh1s1n` | two single errors: 02:28Z (build 112 → 113 deploy swap) and 02:43Z (live = v0.29.4) |
| Every audience query the pages run (`scripts/_probe` against prod DSQL: everyone / directory / all new filters / each saved list / `manualMembers` / each newsletter's `audienceFor`) | all OK |
| ESLint `no-undef` over `apps/admin/app` + `apps/admin/lib` (Next build does not catch an undefined identifier in JSX; it would throw at render) | clean |
| Amplify jobs | 110–115 all SUCCEED |

Root cause **not identified** from the outside. The page and the action the
user took are unknown; the code involved (composer Audience box + "Send to"
in the request block) was replaced in v0.29.5 the same evening.

## What was changed so the next one is readable

- IAM role `uccsite-admin-amplify-logs` (trust `amplify.amazonaws.com`,
  `aws:SourceAccount` condition; inline policy `cloudwatch-ssr-logs`:
  `logs:CreateLogGroup/CreateLogStream/PutLogEvents/DescribeLogGroups/
  DescribeLogStreams` on `arn:aws:logs:us-west-2:017110365763:log-group:/aws/amplify/*`)
  set as the app's **service role** (`aws amplify update-app
  --iam-service-role-arn`). Per docs.aws.amazon.com/amplify/latest/userguide/
  ssr-supported-features.html "Amazon CloudWatch Logs for SSR apps" that is
  what Amplify assumes to write SSR runtime logs. The compute role
  (`UccProdAdminCompute`, DSQL/SES/S3) is a separate field (not shown by the
  installed AWS CLI 2.17 — `computeRoleArn` is newer) and was not touched;
  the admin kept working (login 200, pages fine).
- Redeployed (job 116, RELEASE) so compute picks the role up.
- The log group had still not appeared after a few unauthenticated requests
  (`/login` 200; the signed-in routes 307 to `/login` from middleware, which
  may not reach compute). It should appear with the first signed-in page
  view. Where to look next time: CloudWatch `/aws/amplify/dmfjtx0gh1s1n`,
  filter `3582361700` or `Error`.

## Next time

1. Reproduce on the current build and note the page + button.
2. `aws logs filter-log-events --profile uccsite --log-group-name
   /aws/amplify/dmfjtx0gh1s1n --filter-pattern "<digest>"` — the message
   and stack are there.
3. If the log group is still missing, the service role is not being used:
   check `aws amplify get-app` → `iamServiceRoleArn` and the role's trust.
