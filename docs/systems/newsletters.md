# Newsletters — compose, review, send (admin "Mail" section)

Built 2026-10-05. A Mailchimp-lite inside the admin: write an email from
blocks, see it as a phone shows it (light and dark), send yourself a test,
then request the send. The send follows the **same two-person rule as a
site publish** (lib/publish.js): a different editor/owner approves — or an
owner approves their own — with an optional Mountain-time schedule. The
actual sending is a Lambda (`NewsletterSendFn`), one SES message per
recipient with a signed unsubscribe link, recorded per recipient so a
resume never mails anyone twice. Every email goes out as
`"<Author> from Utah Civic Compact" <hello@utahciviccompact.org>`.

Supersedes `scripts/send-periodical.js` for routine newsletters (the script
still works as an operator fallback and uses the same audience filters).

## Code Map

```
packages/newsletter/render.mjs     renderEmail({subject, preheader, headline, blocks, theme}, {mode})
                                   → {html, text}; previewHtml(); normalizeBlocks/Theme; fromHeader(name);
                                   UNSUBSCRIBE_TOKEN '{{unsubscribe_url}}'. Pure ESM: browser preview,
                                   admin server and Lambda all render the SAME bytes.
packages/newsletter/schedule.mjs   America/Denver datetime-local ⇄ UTC (DST-aware), parseSchedule (≥5 min lead)
packages/db/newsletters.js         tables newsletters + newsletter_deliveries (DDL wired into content-schema.js);
                                   conditional-update state machine; claimForSending mutex; delivery ledger
aws/newsletter/handler.mjs         NewsletterSendFn: {id} | {id,resume} | {tick} | {id,recipientsOverride}
aws/newsletter/send.js             the per-recipient loop (injected deps, tested)
infra/cdk/lib/ucc-stack.js         "newsletter send Lambda" block (both stacks): IAM, self-invoke policy,
                                   EventBridge rate(1 minute) tick, outputs NewsletterFunctionName/Arn
apps/admin/lib/newsletters.js      every rule: create/save/request/approve/decline/withdraw/cancel/retry/test/delete
apps/admin/lib/notify.js           notifyNewsletterRequested (reviewer email, same recipients as publish)
apps/admin/app/mail/page.js        list + "new newsletter"
apps/admin/app/mail/[id]/page.js   editor page: review panel, Composer in an ActionForm, test/request/delete
apps/admin/app/mail/[id]/composer.js  client: block editor (image block has inline upload) + theme + audience | phone/desktop, light/dark preview
apps/admin/app/mail/status.js      status labels
apps/admin/app/page.js             dashboard "Newsletters needing attention" (pending/approved/sending)
scripts/newsletter-smoke.mjs       E2E of the Lambda with recipientsOverride (mailbox simulator)
```

Nav: group **Mail** → Newsletters (`/mail`), Mailing list (`/subscribers`,
moved from Operations).

## Data

`newsletters` (one row per email):

| column | meaning |
|---|---|
| `status` | `draft` → `pending` → `approved` → `sending` → `sent` \| `failed`; decline / withdraw / cancel-before-start return to `draft` |
| `subject, preheader, headline, from_name` | what the composer edits; `from_name` is the author shown in the From display name |
| `blocks, theme, audience` | JSON: the block list (`heading, text, button, image, quote, divider`), the look (`accent, highlight, font, eyebrow, footer`), the audience filters (`residency, donors, petition` — packages/db/audience.js, same as the Mailing list page) |
| `html, text` | **frozen at request time** — what the reviewer approves is what is sent, even though the send happens later |
| `requested_by/_user, request_note, requested_at, scheduled_for, recipients` | the request; `recipients` = the audience count the writer saw |
| `reviewed_by, review_note, reviewed_at` | the latest review (kept on a declined draft so the writer sees the note) |
| `send_started_at, sent_at, sent_count, failed_count, error` | the run |

`newsletter_deliveries` (`newsletter_id, email` PK; `status sending|sent|failed`,
`message_id`, `error`, `at`): the ledger. The primary key is the idempotency
key — a resumed or re-kicked run skips rows that exist.

A non-draft row refuses saves (conditional `UPDATE … WHERE status = 'draft'
AND updated_at::text = $stamp`, the lost-update guard from lib/data.js).

## Flow

1. **Compose** (editor+, `/mail` → "Start writing"): subject, preview text,
   headline, From (team member names from `team_members`, defaulting to the
   signed-in admin's — `authorNameFor`: team member by email, else the
   address's local part made readable), audience, blocks, look. Save =
   audit `newsletter.save`. The preview pane renders live in the browser
   from the same renderer; toggles: Light / Dark (dark = the email's own
   `prefers-color-scheme` rules applied unconditionally), Phone (375 px) /
   Desktop.
2. **Send me a test** (editor+): the saved version to the signed-in admin's
   address only, subject prefixed `[TEST]`, through the admin's SSR role
   (`ses:SendEmail`, From pinned to hello@). The unsubscribe link points
   back at the editor. Audit `newsletter.test`.
3. **Request send** (editor+): subject and ≥1 block required; the audience
   must match ≥1 person; optional *Send at* (Mountain time, ≥5 minutes
   ahead). Renders and freezes `html/text`, stores the count, status
   `pending`, audit `newsletter.request`. After the commit, the four admins
   minus the requester are emailed (editor requests only; owner requests
   mail nobody — same `publishReviewRecipients` rules and `PUBLISH_NOTIFY_TO`
   override as publish requests).
4. **Review** (a different editor/owner, or an owner for their own —
   `selfApproved` audited):
   - **Approve** → `approved` (conditional on `pending`); **send now** →
     the admin invokes `NewsletterSendFn` `{ id }` (async). Invoke failure
     reopens the request to `pending` with audit `newsletter.invoke_failed`
     and tells the reviewer nothing started. **Scheduled** → nothing is
     invoked; the Lambda's minute tick starts it when `scheduled_for` is
     due. Audit `newsletter.approve`.
   - **Decline** (note required, not own) → `draft`, note kept. Audit
     `newsletter.decline`.
   - **Withdraw** (requester, or owner) → `draft`. Audit `newsletter.withdraw`.
   - **Cancel** (editor+; approved and not started) → `draft`. Audit
     `newsletter.cancel`. Once the Lambda has claimed the row it finishes.
5. **Send** (Lambda): `claimForSending` = conditional `approved → sending`
   (the mutex between the direct invoke and the tick); recipients from the
   frozen audience filters **at send time** (new sign-ups since the request
   are included; unsubscribes excluded); per recipient: `beginDelivery`
   (skip if the row exists), sign a 1-year unsubscribe token
   (`@uccsite/tokens`, purpose `unsubscribe`, same format as the API's
   welcome email and `send-periodical.js`), SESv2 `SendEmail` with
   `List-Unsubscribe` + One-Click headers, `finishDelivery`. 100 ms between
   sends (10/s; quota 14/s). With <90 s left the Lambda re-invokes itself
   `{ id, resume: true }`. End: `sent` (with `failed_count`) or `failed` when
   every send failed / the run threw (e.g. TOKEN_SECRET unset). The tick
   also re-kicks a `sending` row untouched for 20 minutes (crashed run).
6. **Retry** (editor+, `failed` only) → `approved` + direct invoke; the
   ledger skips everyone already sent to. Audit `newsletter.retry`.
7. **Delete** (owner; not pending/approved/sending): deliveries + row.
   Audit `newsletter.delete`.

`newsletter.*` audit actions are NOT matched by `CONTENT_ACTION_RE`, so
newsletter work never shows up as "unpublished saves" or blocks a site
publish (test in packages/db/test/newsletters.test.mjs).

## Rendering

- Table-based 600 px card, inline styles (Gmail strips `<style>` partially),
  `<meta name="color-scheme" content="light dark">` + a
  `@media (prefers-color-scheme: dark)` block and `[data-ogsc]` twins
  (Outlook). Gmail ignores author dark styles and recolours itself — the
  composer says so; a test send shows the truth.
- Text block markdown: paragraphs, `- ` bullets, `## ` sub-headings,
  `**bold**`, `*italic*`, `[text](https://…)`. Author text is escaped FIRST;
  link/image URLs must be `http(s):` (`mailto:` for links); anything else
  is dropped silently by `normalizeBlocks`.
- Footer: theme footer text + an always-present Unsubscribe link
  (`{{unsubscribe_url}}`), plain-text twin ends with `Unsubscribe: <url>`.
- `fromHeader(name)`: display name limited to letters/space/.'-, 60 chars;
  empty or "Utah Civic Compact" → the plain org name. The ADDRESS never
  changes: IAM pins `ses:FromAddress = hello@utahciviccompact.org` (a
  separate key, `ses:FromDisplayName`, governs the name and is not pinned).

## Env / IAM

| Where | What |
|---|---|
| Admin (`lib/config.js`) | `NEWSLETTER_FUNCTION_NAME` (runtime; `scripts/admin-env.mjs` locally, Amplify console var + `amplify.yml` grep on prod). Missing → approve "send now" / retry throw a config error; everything else works. |
| Admin SSR role (`UccProdAdminCompute` / `admin-runtime`, hand-managed) | `lambda:InvokeFunction` on the NewsletterSendFn ARN (added 2026-10-05); `ses:SendEmail` already present for the test send |
| Lambda env | `DSQL_ENDPOINT`, `PUBLIC_ORIGIN` (unsubscribe links), `SECRET_ARN_TOKEN_SECRET`, `SES_CONFIGURATION_SET` (prod `ucc-prod`) |
| Lambda IAM | `dsql:DbConnectAdmin`, `ses:SendEmail` on the identity + `ucc-prod` set with the From pin, `secretsmanager:GetSecretValue` on TOKEN_SECRET, `lambda:InvokeFunction` on itself (detached policy — CDK cycle otherwise) |

Staging sends go through the prod identity/config set like every other
staging email (docs/systems/email.md): use the mailbox simulator.
Staging's `ucc/staging/TOKEN_SECRET` holds a self-set test value (not the
prod secret) so unsubscribe links can be signed there.

## Logs (CloudWatch `/aws/lambda/<stack>-NewsletterSendFn…`, admin server)

| prefix | meaning |
|---|---|
| `[newsletter] <id> starting/resuming subject=…` | claim won |
| `[newsletter] <id> not claimable` | already sending/sent, cancelled, or not due (harmless race) |
| `[newsletter] <id> recipients=N` | audience resolved (`(override)` on smoke runs) |
| `[newsletter] <id> send #i failed: <Name> <msg>` | one recipient failed (never the address) |
| `[newsletter] <id> pausing at i/N (time); will resume` | self re-invoke |
| `[newsletter] <id> done sent=… failed=… unknown=…` | finished |
| `[newsletter] <id> FAILED: …` | the run threw; row `failed` |
| `[newsletter] tick: <id> is due / stalled` | minute tick started/resumed one |
| `[admin] <who> newsletter <id> send invoked / invoke failed` | the approval's invoke |
| `[admin] newsletter <id> test sent <MessageId>` / `test SES error` | test send |

No recipient address or message body is ever logged.

## Error handling (what the editor sees)

| case | result |
|---|---|
| save over a changed row / non-draft | "Someone else saved…" / "This newsletter is pending — withdraw or cancel first" |
| request with no subject / no blocks / nobody in the audience / time <5 min ahead | the specific message; nothing changes |
| approve own request as editor | refused (owner: allowed, audited) |
| decline without a note | refused |
| Lambda invoke fails | request reopened, "The send did not start … still pending" |
| cancel after the Lambda claimed | "Too late to cancel" |
| TOKEN_SECRET unset | row `failed` with that reason; Retry after the secret is filled |

## Operator checks

```
$env:AWS_PROFILE='uccsite'; node scripts/newsletter-smoke.mjs --env staging   # Lambda E2E via the mailbox simulator
node scripts/migrate-schema.mjs --env <env>                                    # creates the two tables
```

## Not built / decisions

- Image blocks: **Upload an image** inside the block (inline upload, alt
  text required, 1200 px variant, absolute URL) or paste any https URL.
- No open/click tracking (SES event destination only routes bounces and
  complaints; nothing per recipient).
- Schedule granularity: the tick runs every minute; a scheduled send starts
  within ~60 s of its time.
- Deliveries are kept with the newsletter (deleted with it) — see
  docs/legal/data-handling.md.
