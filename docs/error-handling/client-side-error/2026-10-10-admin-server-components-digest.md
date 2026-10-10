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

## Final root cause (ref 4101828595, caught by the capture on build 124)

```
ReferenceError: request is not defined
    at /tmp/app/.next/server/app/mail/[id]/page.js
```

(`audit_log` row `admin.error` + S3 `_debug/request-error-….json`, both written
by `instrumentation.js onRequestError` — the capture works.) Next hoists an
inline Server Action (`save`) out of the component at build time; its
closure can carry only serialisable values (`id`, `path`). The helper
`request`, a function defined inside the component, is therefore
`undefined` inside the action → ReferenceError before any of our code,
before `runAction`, before the trace. With `'use server'` on the helper
(2026-10-08 → v0.29.8) the same call failed differently (a bound reference
cannot be called from server code). Either way **no send request ever
succeeded 2026-10-08 → 2026-10-10**. Fix (v0.29.13): `requestFlow(id, path,
formData)` is a module-level function; `save` calls it. Rule for every
page: an inline action may reference imports and serialisable locals only —
never a function or object defined in the component body.

## Earlier reading (nested inline action — half right)

Build 120 had been live since 03:03:57Z; the user reloaded, saved twice
(rows at 03:05:14 and 03:06:07) and pressed **Save & request send** → 5xx at
03:05 and 03:06. So not the deploy race after all (that explained the two
earlier hits only in part). Prod has **no newsletter with `requested_at`
set and no `newsletter.request` audit row — ever**: the request path had
been broken since 2026-10-08, when Save / test / request became one form
whose `save` action does `if (then === 'request') return request(prev,
formData)`. `request` was ALSO an inline `'use server'` function. Next
compiles an inline server action inside a component into a *bound server
reference* (its closure — `id`, `path` — encrypted into the reference), and
`save` closing over that reference means the call from server code goes
through the reference machinery, not a plain function; it fails before any
user code runs, so `runAction` never sees it and nothing is audited. The
test-send branch calls `sendTest` directly and always worked — the one
difference. Fix (v0.29.9): `request` is a plain async function (no
directive) that `save` calls; only `save`, `decide` and `test` are actions.

Why the earlier two digests fit "deploy race" so well: both DID coincide
with deploys, and a stale page produces the same masked message. Lesson:
when every attempt fails the same way, check whether the path has EVER
worked (the audit log said no) before accepting a coincidence.

The `admin.error` capture added in v0.29.8 recorded nothing for 4003451880
— either this failure is thrown outside the paths Next reports to
`onRequestError`, or the DB write failed silently (only the console line
exists, and Amplify keeps no log). Watch for a row on the next real error;
if none appears, the reporter needs a second sink (S3 or SES).

## First reading (deploy race) — kept for the record

Steps: write the email, Save, choose a mailing list, Save, press "Save &
request send" → error. Audit log for the draft (`08351b34…`): saves at
02:29:50Z and 02:45:01Z succeeded; **no `newsletter.request` row and no save
row at request time** — the request action never ran. The two 5xx responses
sit exactly on deploy completions: 20:28:53 MDT (build 112 → 113 live) and
20:45:58 MDT (job 116, a redeploy, live) — six admin builds went out in 30
minutes while the editor was open. A page rendered by one build submitting
an inline server action to the next build fails with Next's "Failed to find
Server Action" (the action ids are hashes of the changed file), which
production masks as the Server Components digest. **Not a code bug; a
deploy-while-editing race.** Reloading the page fixes it.

Two side findings from the same audit trail:

- The draft was created as an **automatic email** (`newsletter.create …
  kind: transactional`): the Outgoing emails page had two identical
  **Start writing** buttons, the Automatic emails one first. Fixed the same
  night (v0.29.7: newsletters section first, buttons say what they start).
  The draft itself is rescued by unticking "Automatic email" and saving.
- "Choose a mailing list, Save" left the audience at `everyone` in every
  save row — on v0.29.4/5 the list is chosen in the request block and is
  applied when the request is made, not on Save (by design; the hint now
  says so).

Lesson: do not push a chain of admin builds while someone is editing; bundle
the changelog into the code commit so one push = one build.

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
