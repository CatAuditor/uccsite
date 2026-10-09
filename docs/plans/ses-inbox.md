# SES reply inbox inside the admin — plan (2026-10-10, not started)

What it would take to receive email replies in AWS and show each signed-in
admin their own replies. Written when Reply-To was wired to the author's
Zoho mailbox (docs/systems/newsletters.md "Reply-To"); that covers replies
for now. Build this only if the org wants replies visible inside the admin,
shared across owners, or kept beside the newsletter they answer.

## The constraint that shapes everything

The apex MX of `utahciviccompact.org` points at Zoho (staff mailboxes). SES
can only receive mail for a domain whose MX points at
`inbound-smtp.us-west-2.amazonaws.com`, so SES cannot receive
`@utahciviccompact.org` without killing Zoho. The inbox therefore lives on a
subdomain — `reply.utahciviccompact.org` — and outgoing mail sets
`Reply-To: <local>@reply.utahciviccompact.org`. Staff's ordinary Zoho mail
stays in Zoho; this is a reply tracker, not a mailbox replacement.

Account state when this was written: no SES receipt rule set exists in
017110365763 / us-west-2 (only one can be active per region), so there is
nothing to merge with.

## Pieces

| Piece | Effort | Where |
|---|---|---|
| DNS: MX `reply` → `inbound-smtp.us-west-2.amazonaws.com` (priority 10) | 5 min, **Conner** (Namecheap) — add to docs/for-conner.md | DNS |
| CDK: `ses.ReceiptRuleSet` + one rule (recipients `reply.utahciviccompact.org`, `scanEnabled: true`, S3 action → new bucket with the SES put policy, Lambda action), activation via `AwsCustomResource` `SetActiveReceiptRuleSet` (CDK has no native activate) | half day | `infra/cdk/lib/ucc-stack.js` |
| Inbound Lambda: read the raw MIME from S3, parse (`mailparser`), drop `X-SES-Spam-Verdict`/`X-SES-Virus-Verdict: FAIL`, map the local part → `team_members.email`, insert rows, attachments to S3 | half day | new `aws/inbox/` (NEVER under `functions/`) |
| DSQL: `inbox_messages` (id, to_user, from_address, from_name, subject, text, html, in_reply_to, references, s3_key, received_at, read_at) + `inbox_attachments` (message_id, filename, content_type, size, s3_key); grants for the API/inbox/admin roles; migrate-schema | 1 hr | `packages/db/` |
| Admin `/inbox`: list filtered by the session's verified email (owners see all), thread view, mark read, reply form | 1 day | `apps/admin/app/inbox` |
| Reply send: SES `SendEmail` From `<local>@reply.utahciviccompact.org` with `In-Reply-To`/`References`. IAM: `ses:FromAddress` is pinned to hello@ today — add `*@reply.utahciviccompact.org` on the SSR role. The verified domain identity already covers subdomains for DKIM | 2 hr | `ucc-stack.js`, docs/systems/email.md |
| `Reply-To` on newsletter + transactional sends → the author's `reply.` address instead of their Zoho address | 1 hr | `send.js`, `emails.js`, `authorReplyTo` |
| Docs: data-handling (inbound mail = PII, retention), email.md, admin.md, debug reference, dev notes, for-conner | 1 hr | docs |

Roughly two dev days plus one Conner step.

## Tying a message to the signed-in user

The admin session already carries a verified Cognito email;
`team_members.email` is `<local>@utahciviccompact.org`. The inbound Lambda
takes the local part of the `reply.` recipient, finds the team card with
that local part and stores `to_user = <that card's email>`; the page queries
`WHERE to_user = session.email`. No new auth. An unmatched local part (typo,
former staffer) is stored with `to_user = 'hello@utahciviccompact.org'` and
shown to owners, never dropped.

## Gotchas

- SES receiving caps a message at 40 MB; larger mail bounces at SES.
- One active receipt rule set per region; the account has none today.
- Raw MIME retention: S3 lifecycle rule (90 days suggested) — decide with
  the data-handling table.
- Bounces of replies sent from the `reply.` subdomain already route to the
  existing ops SNS topic (domain-level identity).
- Auto-replies / out-of-office will arrive here; the inbound Lambda should
  tag `Auto-Submitted`/`Precedence: auto-reply` messages so the page can
  hide them.

## Decisions needed first

1. Does the org want replies in the admin at all, given Zoho already holds
   them? (The cheaper answer is the one in place: Reply-To → Zoho.)
2. Owners see everyone's replies, or only their own?
3. Retention for inbound mail and attachments.
