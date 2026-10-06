# Email — transactional sending (Amazon SES)

Status 2026-10-05: transactional site email (welcome, billing-portal link)
goes through **Amazon SES v2** from the API Lambda. Production access was
granted 2026-10-05 (case 179125335500202; 50,000/day, 14/sec). Resend is
retired from the AWS stack (the Cloudflare `functions/` copy still references
it but is idle). The newsletter script still sends through **Mailgun** — a
separate decision, see "Not built yet".

## Code Map

```
aws/api/routes.js            sesSend() — THE send path (welcome email, portal link)
                             FROM_ADDRESS = 'Utah Civic Compact <hello@utahciviccompact.org>'
                             _setSesClient() — test seam only
aws/api/secrets.js           TOKEN_SECRET (signs unsubscribe/portal links); RESEND_API_KEY removed
scripts/send-periodical.js   newsletter sender — Mailgun (signs the same unsubscribe token format)
infra/cdk/lib/ucc-stack.js   "SES sending domain" block (prod only) + ApiFunction ses:SendEmail policy (both stacks)
docs/for-conner.md §10       the DNS records, production-access request, Resend teardown
```

## Send path (`sesSend`)

- `SendEmailCommand` with `Simple` content: HTML body, UTF-8, and the
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers passed as
  `Content.Simple.Headers`.
- `ConfigurationSetName` comes from env `SES_CONFIGURATION_SET`; CDK sets it
  to `ucc-prod` on prod only. **`ucc-prod` is also the identity's default
  configuration set**, so staging sends land in it regardless — staging test
  bounces reach the prod ops topic. Staging tests use the mailbox simulator
  (`success@simulator.amazonses.com`), which never bounces.
- Auth is the Lambda role, no API key. IAM (both stacks): `ses:SendEmail` on
  `arn:aws:ses:<region>:<acct>:identity/utahciviccompact.org` AND
  `…:configuration-set/ucc-prod` (SES authorizes the default set too — without
  it the send is `AccessDeniedException`, see
  `docs/error-handling/client-side-error/2026-10-05-ses-config-set-access-denied.md`),
  condition `ses:FromAddress = hello@utahciviccompact.org`. Both stacks use
  the ARN strings because the identity is a prod-stack resource.
- Client is lazy (first send on a container) with an 8 s request timeout.
- Failures are logged as `[api] SES error: <ErrorName> <message>` and never
  thrown — the calling job already swallowed errors for Resend, and the
  user-facing response was sent long before. Recipient is never logged.
- Success logs `[api] SES sent <MessageId> subject="…"`.

Env vars: `SES_CONFIGURATION_SET` (runtime, optional; prod `ucc-prod`).
Missing on prod = sends still work but bounces/complaints are not routed to
the ops topic and reputation metrics are not tagged.

## What is sent

| Email | Trigger | Route | Headers |
|---|---|---|---|
| Welcome | `POST /api/subscribe` (join form) | self-invoke job, non-blocking | `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` (RFC 8058), signed 1-year unsubscribe link |
| Billing-portal link | `POST /api/create-portal-session` | inline after the 202 | 15-minute signed link |
| Newsletter | operator runs `scripts/send-periodical.js` (`--audience utah\|outside\|unknown\|all`, `--donors-only`, `--petition <slug>` — the admin Mailing list's filters, packages/db/audience.js) | script | signed unsubscribe link |

Volume is tiny (tens per month). No message bodies or recipient lists are
ever logged (`[api] SES error: <ErrorName>` / `[api] SES sent <MessageId>` only).

## SES infrastructure (UccProd stack, us-west-2)

| Resource | Value | Why |
|---|---|---|
| Domain identity | `utahciviccompact.org` (`SesIdentityArn` output) | one domain identity per region per account → the prod stack owns it; staging will send through the same identity by ARN |
| DKIM | Easy DKIM, 3 CNAMEs (`SesDkimCname1..3` outputs) | DKIM-aligned signing; the only way DMARC passes on the DKIM leg |
| MAIL FROM | `mail.utahciviccompact.org`, `REJECT_MESSAGE` on MX failure | SPF is checked against the MAIL FROM domain, so the apex SPF (Zoho + Mailgun) is untouched; REJECT instead of falling back to `amazonses.com` so alignment never silently degrades |
| Configuration set | `ucc-prod` | reputation metrics on; account suppression list for BOUNCE + COMPLAINT |
| Event destination | `ops-alerts` → `OpsAlertTopicArn` SNS | BOUNCE, COMPLAINT, REJECT — what the production-access request promises |

Identity state is read with (never v1 `aws ses`):

```
aws sesv2 get-email-identity --profile uccsite --region us-west-2 --email-identity utahciviccompact.org --query '{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status,mailFrom:MailFromAttributes.MailFromDomainStatus}'
```

"Domain setup complete" = all three `true` / `SUCCESS` / `SUCCESS`. Until
then SES is also in the **sandbox** (`ProductionAccessEnabled: false`, 200
sends/day, recipients must be verified identities or the mailbox simulator).

Existing DNS that stays as-is: apex `v=spf1 include:spf.efwd.registrar-servers.com
include:zohomail.com include:mailgun.org ~all`, Zoho MX, `_dmarc` `p=none`
with Mailgun/OnDMARC reporting. SES mail will pass DMARC via DKIM alignment
and via SPF on the MAIL FROM subdomain; `p=none` can later move to
`quarantine` once reports show only aligned senders.

## Built 2026-10-05

Items 1, 2, 4 and 5 of the original plan (send path, IAM, secret removal,
data-handling row) are done — see "Send path" above. Removing
`RESEND_API_KEY` from `NAMES` made CDK drop the staging placeholder secret;
prod's `ucc/prod/RESEND_API_KEY` is `RETAIN`ed and deleted separately
(for-conner §10.4).

## Not built yet

- `scripts/send-periodical.js` still sends the newsletter through
  **Mailgun** (org decision 2026-09-14 kept Mailgun). Moving it to SES is a
  one-function swap (`sendOne`) plus `MAILGUN_API_KEY` retirement and the
  apex SPF `include:mailgun.org` cleanup; the SES production-access request
  already describes the newsletter as SES traffic, so this should follow.

## Error handling

- Identity `FAILED` after DNS was added: re-check the records resolve
  (`nslookup -type=CNAME <token>._domainkey.utahciviccompact.org 1.1.1.1`);
  do NOT re-run DKIM signing attributes on a `SUCCESS` identity (tokens
  change). Cloudflare proxy (orange cloud) on these records breaks them —
  must be DNS-only.
- `MailFromDomainStatus` stuck `PENDING`: the MX record is missing or has the
  wrong priority/host; check `nslookup -type=MX mail.utahciviccompact.org`.
- Bounce/complaint emails arrive on the ops topic subscribers; a complaint
  rate approaching 0.1% or bounce rate approaching 5% puts the account under
  review — the suppression list prevents repeat sends to those addresses.
