# CloudFront Function 503 on every site request — `for...of` unsupported

**Date:** 2026-09-12 · **Where:** staging distribution `d3heb9s058a59m.cloudfront.net`, viewer-request function

## Error

Every site path returned `503` (headers still stamped by the response-headers
policy; `/api/*` unaffected because that behavior carries no function).
`aws cloudfront test-function` surfaced the real error:

```
The CloudFront function associated with the CloudFront distribution is invalid
or could not run. SyntaxError: Token "of" not supported in this version in 22
```

## Cause

`cloudfront-js-2.0` does not support `for...of` loops. The query-string helper
in `infra/cdk/cf-fn/viewer-request.js` used `for (const item of entry.multiValue)`.
The runtime accepts the code at deploy time and fails at execution — the
distribution serves 503 with an empty body for every request the function
handles.

## Fix

Replaced `for...of` with an index loop. Runtime 2.0 does support `const`/`let`,
async/await, and `for...in` — but not `for...of`, spread in some positions, or
several other ES2015+ constructs.

## What would catch it earlier

`aws cloudfront test-function` with a sample viewer-request event immediately
after deploy, or the committed end-to-end check `scripts/staging-check.mjs`,
which exercises every function path against the live distribution — run it
after every infra deploy. A synth-time check can't catch it: CloudFormation
accepts the function body regardless of runtime support.
