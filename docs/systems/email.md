# Email — transactional sending (Amazon SES)

Status 2026-10-05: ALL outbound site email goes through **Amazon SES v2** —
transactional (welcome, billing-portal link) from the API Lambda, and the
newsletter from `scripts/send-periodical.js` under the operator's `uccsite`
profile. Production access was granted 2026-10-05 (case 179125335500202;
50,000/day, 14/sec). Resend and Mailgun are retired from the AWS stack (the
idle Cloudflare `functions/` copy still names Resend).

## Code Map

```
aws/api/routes.js            sesSend() — THE send path (welcome email, portal link, thank-yous)
                             FROM_ADDRESS = 'Utah Civic Compact <hello@utahciviccompact.org>'
                             petitionThanksJob() / donationThanksJob() — the two thank-you jobs;
                             petitionCampaign() / donateCopy() — read the admin's copy (homepage)
                             _setSesClient(), _resetCampaignCache() — test seams only
aws/api/emails.js            the thank-you bodies (pure): buildPetitionThanksEmail,
                             buildDonationThanksEmail, shared layout, {placeholder} fill,
                             default subjects/bodies. Welcome body stays in routes.js.
                             transactionalTemplate() / fillAttached() — an ATTACHED email (below) replaces the built-in body
aws/api/webhook.js           checkout.session.completed → self-invoke 'donation-thanks'
packages/db/newsletters.js   TRIGGERS (petition-thanks, donation-thanks: label, when, placeholders, required),
                             newsletters.kind, transactional_emails table, attach/detach/listAttachments
apps/admin/lib/transactional.js  createTransactional, attachEmail (renders + freezes), detachEmail, listSlots, transactionalState
apps/admin/app/mail/          Outgoing emails: Automatic emails (slots + drafts) and Newsletters; [id] editor "Send automatically" panel
aws/api/index.mjs            JOBS: welcome-email, portal-link, petition-thanks, donation-thanks
aws/api/secrets.js           TOKEN_SECRET (signs unsubscribe/portal links); RESEND_API_KEY removed
aws/newsletter/              NewsletterSendFn — the newsletter send path (docs/systems/newsletters.md)
apps/admin/lib/notify.js     publish-request + newsletter-request review emails from the admin (same From, identity,
                             config set; auth = the Amplify SSR compute role UccProdAdminCompute)
scripts/send-periodical.js   newsletter sender — SESv2 SendEmail per recipient, config set ucc-prod (signs the same unsubscribe token format)
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
| Welcome (= confirmation, double opt-in since 2026-10-05) | `POST /api/subscribe` (join form); carries a signed `GET /api/confirm` button (purpose `confirm`, 30 days) | self-invoke job, non-blocking | `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` (RFC 8058), signed 1-year unsubscribe link |
| Billing-portal link | `POST /api/create-portal-session` | inline after the 202 | 15-minute signed link |
| **Petition thank-you** (2026-10-09) | `POST /api/petition` — the FIRST signature of an address on a campaign only (a re-sign refreshes the row and sends nothing, so the route cannot be used to flood an inbox) | self-invoke job `petition-thanks`, non-blocking | `List-Unsubscribe` + One-Click (signing = joining the list), signed 1-year unsubscribe link. Subject/body: admin Petition page → "Thank-you email" fields (`homepage.petition.email_subject` / `email_body`, `{first_name}` `{headline}`), defaults in emails.js. Heading = the headline (only `<em>` kept). Adds the project link when the campaign is filed under a project, a Share button (/petition) and a Chip in button (/petition-thanks). Generic copy when the slug is not the live campaign or the content read fails |
| **Donation thank-you / receipt** (2026-10-09) | Stripe `checkout.session.completed` (one-time AND the first charge of a monthly membership; renewals send nothing) — `aws/api/webhook.js` after the member/donation rows | self-invoke job `donation-thanks`, non-blocking; `processed_events` dedupes Stripe redeliveries so it is one email per checkout | none (a receipt, not list mail). Subject/body: admin Appeals page → Homepage donate section → "Thank-you email" fields (`homepage.donate.thanks_email_subject` / `thanks_email_body`, `{first_name}` `{amount}`). Always adds a receipt table (amount, one-time vs monthly, date in Mountain time) and the fixed 501(c)(4) **not tax-deductible** line; monthly adds "to change or cancel, email info@" |
| Publish request needs review | an EDITOR (not an owner) requests a publish in the admin | `apps/admin/lib/notify.js`, after the request commits; one `SendEmail` to the four admins minus the requester (list in `lib/notify-recipients.mjs`); prod only unless `PUBLISH_NOTIFY_TO` is set | none — internal; links to the admin dashboard |
| Newsletter (admin) | an approved send request in the admin (Mail → Newsletters; docs/systems/newsletters.md) | `NewsletterSendFn` Lambda: one `SendEmail` per recipient, 100 ms apart, per-recipient delivery ledger, self-resume; From `"<Author> from Utah Civic Compact" <hello@…>` (display name only — the address is IAM-pinned) | `List-Unsubscribe` + One-Click, signed 1-year unsubscribe link per recipient |
| Newsletter test | "Send me a test" in the composer | admin SSR role, to the signed-in admin only, subject `[TEST] …` | none |
| Newsletter (script, fallback) | operator runs `scripts/send-periodical.js` (`--audience utah\|outside\|unknown\|all`, `--donors-only`, `--petition <slug>` — the admin Mailing list's filters, packages/db/audience.js) | script: one `SendEmail` per recipient, 250 ms apart (well under the 14/sec quota), `sent-<ts>.log` + `--resume` | `List-Unsubscribe` + One-Click headers, `{{unsubscribe_url}}` substituted in the body. Needs only `TOKEN_SECRET` in `.env` + profile `uccsite` (the operator's IAM user must hold `ses:SendEmail`; admins do) |

Volume is tiny (tens per month). No message bodies or recipient lists are
ever logged (`[api] SES error: <ErrorName>` / `[api] SES sent <MessageId>` only).

### Attached emails (2026-10-09)

Either thank-you can be replaced by an email **composed in the admin's
newsletter builder**. Admin → Mail → **Outgoing emails** → *Automatic emails*:
"New automatic email" creates a `newsletters` row with `kind = 'transactional'`
(same composer, preview, test send; no audience, no send request). The editor
page's **Send automatically** panel attaches it to a trigger:

| trigger | fires | placeholders (filled per recipient) | required |
|---|---|---|---|
| `petition-thanks` | first signature of an address on the live petition | `{first_name}` `{headline}` `{project_name}` | — |
| `donation-thanks` | every completed checkout (one-time, first monthly charge) | `{first_name}` `{amount}` `{type}` `{date}` `{receipt}` | `{receipt}` — the amount/type/date table AND the 501(c)(4) not-tax-deductible line (`emails.js receiptHtml`) |

`attachEmail` renders the saved draft with the newsletter renderer
(`renderEmail`, UTM campaign = the trigger key), refuses without a subject, a
block or a required placeholder, and upserts `transactional_emails`
(`trigger` PK, `newsletter_id`, frozen `subject/html/text`, `attached_by/_at`)
— one live email per trigger; attaching another replaces it (audit
`newsletter.attach`, `diff.replaced` = the previous id). **Frozen**: editing
the draft changes nothing until it is attached again. Detach (audit
`newsletter.detach`) or deleting the draft returns the trigger to the built-in
body. The API (`transactionalTemplate`, SELECT on `transactional_emails`,
5-minute container cache) fills the tokens with `fillHtml` (text values
HTML-escaped, `{receipt}` raw, unknown tokens left as typed), swaps the
renderer's `{{unsubscribe_url}}` for the signed link, and sends html + text.
The petition email keeps its `List-Unsubscribe` headers either way; the
donation email has none. A failed read logs `attached email lookup failed
(<trigger>): <ErrorName>` and falls back to the built-in body. No two-person
review on attach (docs/pending-questions.md 2026-10-09 #5).

### Admin copy for the thank-yous

When nothing is attached, both thank-you emails read their subject and message from the homepage
singleton at send time (the API role has read-only `SELECT` on `homepage`
and `projects` — docs/systems/api-security.md). The text is plain: a blank
line starts a paragraph, `{first_name}` / `{headline}` / `{amount}` are
filled in, everything the admin typed is HTML-escaped. A blank field means
the default in `aws/api/emails.js`. The copy is read from the SAVED draft,
not the published site — a saved-but-unpublished subject goes out at once.
The petition job uses the campaign copy only while `homepage.petition.slug`
equals the slug signed; while an editor drafts the next campaign, signers of
the still-live one get the generic copy (never the draft's headline). The
lookup is cached per Lambda container for 5 minutes.

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

## Unsubscribe (`GET|POST /api/unsubscribe?token=…`)

Every bulk-style email (welcome, newsletter Lambda, `send-periodical.js`)
carries `List-Unsubscribe: <https://…/api/unsubscribe?token=…>` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) plus a body
link to the same URL. RFC 8058 requires both headers under the DKIM
signature; check the `h=` list of `DKIM-Signature` in a received copy
(Gmail → Show original) includes `List-Unsubscribe:List-Unsubscribe-Post`.

- **POST** unsubscribes: Gmail/Yahoo/Apple's one-click (body
  `List-Unsubscribe=One-Click`; the body is ignored, the token is in the
  URL) or the button on the GET page. Soft: `unsubscribed_at` +
  `unsubscribed_by = 'self'`, `members.newsletter_opt_in = 0`. 200 HTML,
  never a redirect.
- **GET** writes nothing: it shows the address and an **Unsubscribe**
  button that POSTs to the same URL. Link scanners (Outlook Safe Links,
  corporate gateways) prefetch every URL in a message, so a GET that
  unsubscribed would remove people who never clicked
  (docs/decisions/unsubscribe-post-only.md).
- Bad/expired token → 400 on both. Tokens last 1 year.
- The welcome email omits both headers when `TOKEN_SECRET` is missing (its
  body link then falls back to `/#join`), so no message ever advertises a
  one-click URL that cannot unsubscribe.

Internal mail (publish/newsletter review requests, test sends, billing-portal
links) has no unsubscribe — transactional, not marketing.

## Domain authentication (audited 2026-10-08)

| Check | State |
|---|---|
| SES DKIM | 3 CNAMEs, `SUCCESS`, RSA-2048, `d=utahciviccompact.org` (aligned) |
| SES SPF | MAIL FROM `mail.utahciviccompact.org`: MX `feedback-smtp.us-west-2.amazonses.com`, TXT `v=spf1 include:amazonses.com ~all` (relaxed-aligned) |
| Zoho (staff mailboxes) | apex MX, SPF `include:zohomail.com`, DKIM selector `zmail` (RSA-1024) |
| Apex SPF | `v=spf1 include:spf.efwd.registrar-servers.com include:zohomail.com include:mailgun.org ~all` — Namecheap forwarding and Mailgun are dead weight |
| DMARC | `p=none`, reports to Mailgun (retired) + OnDMARC |
| Suppression | account + `ucc-prod` config set: BOUNCE, COMPLAINT |

DMARC passes for SES mail on both legs. Enforcement (`p=reject`) is a DNS
change only Conner can make (wrangler's token has no DNS scope); the staged
plan is docs/for-conner.md §12.

## Built 2026-10-05

Items 1, 2, 4 and 5 of the original plan (send path, IAM, secret removal,
data-handling row) are done — see "Send path" above. Removing
`RESEND_API_KEY` from `NAMES` made CDK drop the staging placeholder secret;
prod's `ucc/prod/RESEND_API_KEY` is `RETAIN`ed and deleted separately
(for-conner §10.4).

Newsletter moved from Mailgun to SES the same day (`sendOne` in
`scripts/send-periodical.js`; `MAILGUN_API_KEY` no longer read). Remaining
Mailgun residue is DNS only — apex SPF `include:mailgun.org` and the
`_dmarc` `rua`/`ruf` mailgun.org reporting address — listed for the operator
in for-conner §10.4; harmless until Mailgun is cancelled, then dead weight.

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
