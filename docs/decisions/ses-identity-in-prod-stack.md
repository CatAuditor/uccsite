# SES domain identity lives in the UccProd stack only

Date: 2026-10-05. Status: accepted.

## Decision

The `utahciviccompact.org` SES domain identity, its Easy DKIM, custom MAIL
FROM (`mail.utahciviccompact.org`, `REJECT_MESSAGE`) and the `ucc-prod`
configuration set are created by the **UccProd** stack, gated on `isProd`.
UccStaging creates no SES resources. When staging sends through SES it
references the prod identity ARN as a string.

## Alternatives

- **Identity in both stacks** — fails: SES allows one identity per domain per
  region per account; the second `CreateEmailIdentity` returns
  `AlreadyExistsException` and the deploy rolls back.
- **A separate `UccEmail` stack** — cleaner ownership, but a third stack for
  three resources, a cross-stack export, and one more thing in the runbook.
  Not worth it at this size.
- **A staging subdomain identity (`staging.utahciviccompact.org`)** — more
  DNS records for Conner, and staging never needs real deliverability. If
  staging sends ever matter, this is the path to take.
- **MAIL FROM at the apex / `USE_DEFAULT_VALUE`** — the apex SPF already
  carries Zoho and Mailgun; adding `amazonses.com` there works but couples
  SES to every other sender's SPF budget (10-lookup limit). The subdomain
  keeps them independent. `USE_DEFAULT_VALUE` would quietly send from an
  `amazonses.com` envelope while the MX is misconfigured and DMARC alignment
  would fail on the SPF leg without anyone noticing.

## What breaks if reversed

- Adding the identity to UccStaging: staging deploy fails on
  `AlreadyExistsException`.
- Switching to `USE_DEFAULT_VALUE`: mail still sends during an MX outage but
  with an unaligned envelope sender; with the current `p=none` DMARC nothing
  is rejected, so the regression is invisible until the policy tightens.
- Deleting the identity from the stack: the DKIM tokens are regenerated on
  recreate, and all three CNAMEs in Cloudflare must be replaced.

Related: `docs/systems/email.md`, `docs/for-conner.md` §10.
