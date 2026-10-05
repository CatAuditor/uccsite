# Email — transactional sending (Resend today, SES prepared)

Status 2026-10-05: all outbound site email still goes through **Resend**
(`aws/api/routes.js`). The AWS side of the **SES replacement is deployed**
(domain identity, DKIM, MAIL FROM, bounce/complaint alerts) and waits on two
things: the DNS records in Cloudflare (`docs/for-conner.md` §10) and the SES
production-access approval. The send code swap is a separate `[dev]` step
after both.

## Code Map

```
aws/api/routes.js            resendSend() — THE send path (welcome email, portal link)
                             FROM_ADDRESS = 'Utah Civic Compact <hello@utahciviccompact.org>'
aws/api/secrets.js           RESEND_API_KEY, TOKEN_SECRET placeholders (ucc/<env>/<NAME>)
scripts/send-periodical.js   newsletter sender (signs the same unsubscribe token format)
infra/cdk/lib/ucc-stack.js   "SES sending domain" block — prod only
docs/for-conner.md §10       the DNS records + production-access request
```

## What is sent

| Email | Trigger | Route | Headers |
|---|---|---|---|
| Welcome | `POST /api/subscribe` (join form) | self-invoke job, non-blocking | `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` (RFC 8058), signed 1-year unsubscribe link |
| Billing-portal link | `POST /api/create-portal-session` | inline after the 202 | 15-minute signed link |
| Newsletter | operator runs `scripts/send-periodical.js` | script | signed unsubscribe link |

Volume is tiny (tens per month). No message bodies or recipient lists are
ever logged (`[api] Resend error: <status>` only).

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

## Not built yet (`[dev]`, after for-conner §10 is green)

1. `aws/api/routes.js`: replace `resendSend` with `@aws-sdk/client-sesv2`
   `SendEmail` (`ConfigurationSetName: 'ucc-prod'`, same From, same
   `List-Unsubscribe` headers via `Headers` on the `Simple` content).
2. API Lambda IAM: `ses:SendEmail` on the identity ARN only, with
   `ses:FromAddress` condition `hello@utahciviccompact.org`. Staging stack
   references the prod identity ARN by string (`arn:aws:ses:us-west-2:<acct>:identity/utahciviccompact.org`).
3. `scripts/send-periodical.js` same swap.
4. Drop `RESEND_API_KEY` from `aws/api/secrets.js` NAMES (the stack deletes
   the placeholder secret; prod's is `RETAIN`ed — delete by hand, see the
   2026-09-23 retain build-failure note).
5. `docs/legal/data-handling.md`: replace the Resend row with SES.

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
