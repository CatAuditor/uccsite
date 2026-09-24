# Production custom domain is gated on a context value, not managed by CDK

**Date:** 2026-09-23

## Decision
`UccProd`'s distribution takes its aliases (`utahciviccompact.org`,
`www.utahciviccompact.org`) and certificate from a `prodCertificateArn` context
value in `cdk.json`. When the value is absent the distribution is built exactly
as before — `cdk diff UccProd` shows no change.

The certificate itself is requested by hand in `us-east-1`, outside the stack:

```
arn:aws:acm:us-east-1:017110365763:certificate/ed0efb57-27c9-41f0-9f00-d88c4c9bf24c
```

covering the apex, `www` and `admin` (the last for Amplify later). It must read
`ISSUED` before the ARN is set.

## Why
CloudFront reads certificates only from `us-east-1`, and this stack is
`us-west-2`.

A `Certificate` construct with DNS validation blocks the deploy until the
validation records exist. DNS for this zone is at Cloudflare, which the stack
cannot write to, so CloudFormation would sit waiting on a record no automated
step can create — for up to several hours, then roll back. Given that a failed
prod deploy here strands retained secrets and blocks the next attempt
(`docs/error-handling/build-failures/2026-09-23-prod-secret-retain-blocks-retry.md`),
a deploy that can hang on an external manual step is a bad trade.

Splitting it means the slow, human-gated part (prove domain ownership) happens
out of band, and the stack change is a fast, reversible deploy once it is done.

## Alternatives
- **`DnsValidatedCertificate` with a Route 53 hosted zone.** Correct if DNS were
  in Route 53. Moving the zone is a larger decision than the cutover needs.
- **Certificate in the stack, validation by hand.** Same manual step, but now
  inside a deploy that blocks and can roll the whole stack back.

## Consequences
- Two steps to attach the domain: validate, then set the ARN and deploy.
- The certificate is not managed by CloudFormation. Renewal is automatic while
  the validation CNAMEs stay in DNS — **deleting those records after cutover
  breaks renewal**, silently, up to 13 months later.
- `admin.utahciviccompact.org` is on the certificate but not in the
  distribution's aliases; it is for the Amplify-hosted admin (for-conner §8).

## What breaks if reversed
Naming an unvalidated certificate ARN makes the deploy fail at the distribution
update. Removing the aliases after DNS points here returns 403 for every request
to the real hostname — CloudFront only answers on names it is configured for.
