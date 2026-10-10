# Newsletters — compose, review, send (admin "Mail → Outgoing emails")

Built 2026-10-05. A Mailchimp-lite inside the admin: write an email from
blocks, see it as a phone shows it (light and dark), send yourself a test,
then request the send. The send follows the **same two-person rule as a
site publish** (lib/publish.js): a different editor/owner approves — or an
owner approves their own — with an optional Mountain-time schedule. The
actual sending is a Lambda (`NewsletterSendFn`), one SES message per
recipient with a signed unsubscribe link, recorded per recipient so a
resume never mails anyone twice. Every email goes out as
`"<Author> from Utah Civic Compact" <hello@utahciviccompact.org>`, with
`Reply-To` set to the author's own org mailbox (see "Reply-To" below).

Supersedes `scripts/send-periodical.js` for routine newsletters (the script
still works as an operator fallback and uses the same audience filters).

## Code Map

```
packages/newsletter/render.mjs     renderEmail({subject, preheader, headline, blocks, theme}, {mode})
                                   → {html, text}; previewHtml(); normalizeBlocks/Theme; fromHeader(name);
                                   UNSUBSCRIBE_TOKEN '{{unsubscribe_url}}'. Pure ESM: browser preview,
                                   admin server and Lambda all render the SAME bytes.
packages/newsletter/web.mjs        renderWebBody (archive page body, classes only), archiveSlug
packages/newsletter/schedule.mjs   America/Denver datetime-local ⇄ UTC (DST-aware), parseSchedule (≥5 min lead)
packages/db/email-events.js        email_events table, classify(SES event), SUPPRESSED_SQL used by audience.js
packages/render/newsletters.js     buildNewsletterArchive — /newsletters index + pages (publish pipeline)
aws/ses-events/handler.mjs         SesEventsFn: ops SNS topic → email_events rows
css/newsletters.css                archive page styles
apps/admin/app/mail/[id]/ledger/route.js  owner CSV of one send's delivery ledger
packages/db/newsletters.js         tables newsletters + newsletter_deliveries (DDL wired into content-schema.js);
                                   conditional-update state machine; claimForSending mutex; delivery ledger
packages/db/lists.js               SAVED LISTS: tables mailing_lists + mailing_list_members; listQuery (dynamic: filters,
                                   frozen: snapshot ∩ eligible); freezeList; audienceFor() — THE resolver every sender,
                                   count and CSV goes through (filters OR { list: id })
apps/admin/lib/lists.js            list rules: create / save / freeze ("Update") / setMode / delete, audit `list.<verb>`,
                                   in-flight lock (a pending/approved/sending newsletter on the list blocks freeze/mode/delete)
apps/admin/app/lists/page.js       Mail → Saved lists (editor+): new-list form (seeded from the Mailing list page's
                                   "Save these filters as a list" link), one card per list with Update / Make dynamic /
                                   Freeze now / CSV / Delete + "People added by hand" (paste addresses, remove);
                                   actions.js = the server actions
apps/admin/app/audience-filters.js THE filter controls (client, uncontrolled, names = FILTER_KEYS) rendered by the
                                   Mailing list page, the Saved lists page and the composer
apps/admin/app/audience-count-button.js  "Apply filters (count)" for the Saved lists forms: reads the form's filter
                                   fields → GET /mail/audience-count (nothing saved); the composer has its own
aws/newsletter/handler.mjs         NewsletterSendFn: {id} | {id,resume} | {tick} | {id,recipientsOverride}
aws/newsletter/send.js             the per-recipient loop (injected deps, tested)
infra/cdk/lib/ucc-stack.js         "newsletter send Lambda" block (both stacks): IAM, self-invoke policy,
                                   EventBridge rate(1 minute) tick, outputs NewsletterFunctionName/Arn
apps/admin/lib/newsletters.js      every rule: create/save/request/approve/decline/withdraw/cancel/retry/test/delete
apps/admin/lib/notify.js           notifyNewsletterRequested (reviewer email, same recipients as publish)
apps/admin/app/mail/page.js        Outgoing emails: Automatic emails (trigger slots + transactional drafts, "new
                                   automatic email") then Newsletters (list + "new newsletter")
apps/admin/lib/transactional.js    kind 'transactional' rows: create / list / chooseEmail (attach to a trigger, or detach)
apps/admin/app/automatic-email-picker.js  the dropdown on each petition's page (its own trigger `petition-thanks:<slug>`) and the Appeals page (docs/systems/email.md "Attached emails")
apps/admin/app/mail/[id]/page.js   editor page: review panel, Composer in an ActionForm, test/request/delete
apps/admin/app/mail/[id]/composer.js  client: block editor (image block has inline upload; file import) + look (reset to site look)
                                   + audience ("Apply filters" live count) | phone/desktop, light/dark preview
apps/admin/app/mail/[id]/actions.js   importUpload(formData): .docx/.md/.html → blocks (convert-upload.mjs → newsletter-import.mjs)
apps/admin/lib/newsletter-import.mjs  htmlToBlocks(html, {headline}) → {blocks, headline, notes}; sanitizeRich(html) (tested)
apps/admin/app/mail/audience-count/route.js  GET ?residency&donors&petition → {count, description} (signed-in; no write)
apps/admin/app/mail/status.js      status labels
apps/admin/app/page.js             dashboard "Newsletters needing attention" (pending/approved/sending)
scripts/newsletter-smoke.mjs       E2E of the Lambda with recipientsOverride (mailbox simulator)
```

Nav: group **Mail** → **Outgoing emails** (`/mail`; renamed from
"Newsletters" 2026-10-09 when automatic emails joined it), Mailing list
(`/subscribers`, moved from Operations), **Saved lists** (`/lists`, 2026-10-10).

## Kinds (2026-10-09)

`newsletters.kind`: `'newsletter'` (NULL = newsletter) or `'transactional'`.
A transactional row is an **automatic email**: composed with the same blocks,
preview and test send, but never requested or sent to the audience — it is
**attached** to a trigger (petition signed, donation received) and the API
Lambda sends it to the one person who acted. The list page shows the
triggers first (what is attached, or "built-in email"), then the automatic
drafts, then the newsletters. `duplicateNewsletter` keeps the kind. Full
detail: docs/systems/email.md "Attached emails".

## Data

`newsletters` (one row per email):

| column | meaning |
|---|---|
| `status` | `draft` → `pending` → `approved` → `sending` → `sent` \| `failed`; decline / withdraw / cancel-before-start return to `draft` |
| `subject, preheader, headline, from_name` | what the composer edits; `from_name` is the author shown in the From display name |
| `blocks, theme, audience` | JSON: the block list (`heading, text, rich, button, image, quote, divider`; `rich` = sanitized document HTML, see Rendering), the look (`accent, highlight, font, eyebrow` (optional label; '' by default), `footer`; the letterhead itself is fixed), the audience (`residency, donors, petition, history` — packages/db/audience.js, same as the Mailing list page — OR `list` = a saved list's id, which overrides the filters; see "Saved lists") |
| `html, text` | **frozen at request time** — what the reviewer approves is what is sent, even though the send happens later |
| `requested_by/_user, request_note, requested_at, scheduled_for, recipients` | the request; `recipients` = the audience count the writer saw |
| `reviewed_by, review_note, reviewed_at` | the latest review (kept on a declined draft so the writer sees the note) |
| `send_started_at, sent_at, sent_count, failed_count, error` | the run |
| `kind` | `'newsletter'` (NULL) or `'transactional'` — see "Kinds" |

`transactional_emails` (`trigger` PK → `newsletter_id`, frozen `subject`,
`html`, `text`, `attached_by`, `attached_at`): the live automatic email per
trigger, read by the API (`GRANT SELECT … TO api`). Deleting the newsletter
removes its attachment.

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
   - **Audience**: **Send to** = "People matching the filters below"
     (residency / petition / newsletter history / donors) or a **saved
     list** (hides the filters; shows frozen date or "dynamic"). The legend
     shows the count for the SAVED choice; **Apply filters** / **Count**
     fetches the count for the chosen one (`GET /mail/audience-count`, same
     `audienceInfo` → `lists.js audienceFor`) without saving. Saving stores
     the choice (and the page reloads the saved count). A draft whose saved
     list was deleted shows that in red and the request refuses until another
     audience is chosen.
   - **Import a file** (Content fieldset): a .docx (Word / Google Docs /
     Claude Docs), .md, .txt or .html file goes to `importUpload` (server
     action, editor+, 8 MB): `convert-upload.mjs uploadToHtml` (mammoth with
     `faithful` = blank paragraphs + underline kept; marked GFM, `breaks` for
     .txt) → `newsletter-import.mjs htmlToBlocks`. The document's HTML is
     kept as **rich** blocks (nested/numbered lists, tables, code, quotes,
     underline/strike/sub/sup, footnote marks, blank paragraphs, task-list
     boxes as ☐/☑ glyphs), `sanitizeRich`'d (allowlist `RICH_TAGS` minus
     img; attributes href/colspan/rowspan/start; http(s)/mailto). Two
     exceptions: images lift out as Image blocks in place (a sole-image
     paragraph/figure, caption kept) or right after their paragraph
     (data:/relative addresses arrive empty — upload in the block); the
     first `h1` fills an EMPTY headline. Page wrappers (html/body/div) are
     unwrapped. Blocks append after the current ones; nothing is stored
     until save.
   - **Look**: defaults copy the live site; **Reset to the site look** puts
     `DEFAULT_THEME` back on a draft that carries an older look.
2. **Save & send me a test** (editor+): saves what is on screen, then sends
   it to the signed-in admin's address only, subject prefixed `TEST:`, through the admin's SSR role
   (`ses:SendEmail`, From pinned to hello@; same `Reply-To` as the real
   send). The unsubscribe link points back at the editor. **One copy per
   tester, filled for that person** (2026-10-10): `{first_name}` /
   `{last_name}` / `{email}` come from `recipientNameFor` — the tester's
   row in `DIRECTORY_ROWS_SQL` (subscriber name, else member), the same rows
   the sender reads for the list; an admin with no row falls back to their
   team-member name split in two (else the address made readable). So the
   test shows the greeting a reader gets, and an admin who is not on the
   list still sees a name. For an automatic email every trigger placeholder
   (and `{receipt}`) is filled with sample values besides, the first name
   from the same lookup — docs/systems/email.md "Seeing it before a
   donation". Audit `newsletter.test`.
3. **Save & request send** (editor+): saves what is on screen first (Save,
   both test buttons and the request are one form, `then` = the clicked
   button — before 2026-10-08 they were separate forms and a test of an
   unsaved draft went out without the new text); subject and ≥1 block required; the audience
   must match ≥1 person; optional *Send at* (Mountain time, ≥5 minutes
   ahead). Renders and freezes `html/text`, stores the count, status
   `pending`, audit `newsletter.request` (diff carries the audience
   description — filters, or `saved list <name> (frozen <date>, N people)`).
   After the commit, the four admins
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
   frozen audience **at send time** via `lists.js audienceFor` — ad-hoc
   filters or a dynamic list: whoever matches now (new sign-ups since the
   request are included; unsubscribes excluded); a frozen list: its
   snapshot minus anyone no longer eligible. A deleted list fails the run
   (`FAILED: … no longer exists`; the admin lock makes that a race only).
   Rows carry `email, first_name, last_name` (one per address); per
   recipient: `beginDelivery`
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

`newsletter.attach` / `newsletter.detach` (editor+, `lib/transactional.js`)
record which draft is live for a trigger; they need no second admin.

`newsletter.*` audit actions are NOT matched by `CONTENT_ACTION_RE`, so
newsletter work never shows up as "unpublished saves" or blocks a site
publish (test in packages/db/test/newsletters.test.mjs).

## Built 2026-10-05, second pass (roadmap tiers 1-3)

| Feature | Where |
|---|---|
| **Copy as a new draft** (list row "Copy", editor button) | `lib/newsletters.js duplicateNewsletter` → `db.duplicateNewsletter` (content, look, audience, publish flag copied; new subject "… (copy)"; audit `newsletter.duplicate`) |
| **Default look** ("Use this look as the default") | `newsletter_defaults` singleton (`getDefaults`/`setDefaults`); `createNewsletter` seeds new drafts from it; audit `newsletter.defaults` |
| **Send a test to all admins** | `sendTest(id, { all: true })` → the four `PUBLISH_REVIEWERS` + the sender |
| **Bulk headers** | `List-Id: Utah Civic Compact newsletter <newsletter.utahciviccompact.org>`, `Precedence: bulk` beside List-Unsubscribe (send.js `buildMessage`) |
| **Throttle backoff** | `sendWithRetry`: TooManyRequests/Throttling/5xx/network → 3 retries (0.5 s, 2 s, 5 s); MessageRejected and the like are final |
| **Unknown deliveries** | `beginDelivery` reclaims a row stuck in `sending` for > 10 min (`STALE_DELIVERY_MINUTES`) on Retry / the stall re-kick — a crashed run's recipients are attempted once more (a possible duplicate beats a silent miss) |
| **Change the time while pending** | requester or owner, `rescheduleSend` → `db.reschedule` (pending only); audit `newsletter.reschedule` |
| **Diff on re-request** | `requestSend` copies the previous `requested_blocks` to `prior_blocks`; the review panel lists added / removed blocks (`blockDiff`) |
| **Per-recipient ledger (owner)** | editor page → "Per-recipient delivery" → `POST /mail/[id]/ledger` CSV; audit `newsletter.ledger` |
| **UTM tagging** | `renderEmail(doc, { siteUrl, campaign })` → `tagLinks`: every link into the site gets `utm_source=newsletter&utm_medium=email&utm_campaign=<slug>`; never `/api/` links, never the unsubscribe token, never a link that already has `utm_`. Same parameters in every copy — no per-recipient tracking. |
| **Web archive + View in browser** | see below |
| **Bounces and complaints** | see below |
| **Confirmed subscribers (double opt-in)** | see below |

### Web archive

A newsletter with **"Also publish a web copy"** ticked (default on; column
`publish_to_site`) gets a slug at request time (`archiveSlug`: `yyyy-mm-dd-
subject-words`, fixed for the row's life) and a `web_html` body rendered by
`@uccsite/newsletter/web renderWebBody` — semantic HTML with classes, no
inline styles (the site CSP is `style-src 'self'`). The email carries a
"View in browser" line pointing at `PUBLIC_ORIGIN/newsletters/<slug>`.

When the send finishes, `finishNewsletter` sets `archived_at` (sent +
publish_to_site + web copy present) and the Lambda invokes **PublishFn**
(`trigger newsletter:<id>`, env `PUBLISH_FUNCTION_NAME`, IAM invoke on the
publish function). The publish run (`aws/publish/render-db.js` →
`packages/render/newsletters.js buildNewsletterArchive`) renders
`newsletters.html` (index, newest first) and `newsletters/<slug>.html`
inside the Documents shell (`templates/documents/report.html`: header,
footer, SEO block; `css/newsletters.css`), adds both to the sitemap, and
the footer links to `/newsletters`. The index is always rendered (an
empty-state line until the first issue) so the footer link never 404s. If
the invoke fails the pages go live with the next publish of any kind.

Operator smoke on prod: `scripts/newsletter-smoke.mjs --env prod --no-archive`
— without the flag the smoke row would publish a throwaway page to the
live site.

### Bounces and complaints

`SesEventsFn` (`aws/ses-events`, both stacks; subscribed to the ops SNS
topic) records the configuration set's BOUNCE / COMPLAINT / REJECT events
in `email_events` (`packages/db/email-events.js classify`): one row per
recipient, `suppress = 1` for a permanent bounce (incl. SES's own
`OnAccountSuppressionList` bounce) or any complaint; transient bounces and
rejects are recorded but not suppressing. Staging sends go through the
prod identity's default set, so their events reach the **prod** topic and
the prod table — one more reason staging tests use the mailbox simulator.

- The audience query (`packages/db/audience.js`) excludes suppressed
  addresses everywhere (Mailing list count/CSV, newsletter recipients,
  `send-periodical.js`).
- Mailing list page: a "suppressed" status count/filter (each row says hard
  bounce vs spam complaint) + a "Recent bounces, complaints and rejects"
  table.
- Newsletter delivery panel: "N suppressed" = attempted recipients whose
  address has since been suppressed.

### Confirmed subscribers (double opt-in)

`subscribers.confirmed_at` (schema.js). The join form's welcome email now
carries a **"Yes, that's me"** button → `GET /api/confirm?token=…`
(`aws/api/routes.js confirmSubscription`; token purpose `confirm`, 30-day
TTL, same `@uccsite/tokens` format) which sets `confirmed_at` (idempotent)
and shows a confirmation page. Until then the address is **not** in the
newsletter audience (the welcome email itself still goes out). Petition
signers are confirmed at insert (signing = consent); re-signing up never
clears a confirmation; rows created before 2026-10-07 were grandfathered by
the migration (`UPDATE … WHERE confirmed_at IS NULL AND created_at <
'2026-10-07'`). The join-form success copy on the site tells people to
press the button. Mailing list page shows them as status "Not confirmed
yet" (filterable).

### Saved lists (2026-10-10)

A **saved list** (`mailing_lists`) is a named set of the Mailing list page's
filters, in one of two modes:

| mode | who an email goes to | table |
|---|---|---|
| `dynamic` | whoever matches the filters when the email is sent (how ad-hoc filters have always worked) | filters only |
| `frozen` | the people who matched when the list was last **frozen** — `mailing_list_members` (list_id, email) is that snapshot; **Update** re-takes it. Nobody joins a frozen list by signing up. | `frozen_at`, `frozen_count` + the members table |

Either way the **eligibility rules still apply at send time**: a frozen list
is `audienceQuery({}, { memberOf: id })` — the snapshot joined back to the
audience rows, so anyone who unsubscribed, bounced or was removed since the
freeze is skipped. Freezing never overrides an unsubscribe. The Saved lists
page shows "reaches N today" next to the frozen count so the drift is
visible.

**Filters** (`packages/db/audience.js normalizeFilters`; every key in
`FILTER_KEYS`; one control set, `app/audience-filters.js`, in all three
places; `describeFilters` reads them back for the audit rows and the review
panel):

| key | values | meaning |
|---|---|---|
| `residency` | `all` · `utah` · `outside` · `unknown` | best ZIP we hold (84xxx = Utah) |
| `zip` | 1–5 digits | best ZIP starts with (e.g. `841` = Salt Lake area) |
| `giving` | `any` · `monthly` · `onetime` · `none` | `any` = ≥1 donation or live subscription (same as the old `donors` tick box, still honoured); `monthly` = live subscription; `onetime` = donor without one; `none` = not a donor |
| `via` | `join` · `petition` · `member` (· `subscriber` = join or petition, older saved filters) | how the person first reached us: the join form; a petition signature (a signature within 5 minutes of the subscribers row's `created_at` — both are written by the same request; signing later leaves a join-form row as `join`); donation-checkout opt-in with no subscribers row |
| `petition` | slug · `any` · `none` | signed that petition / any / none at all |
| `not_petition` | slug · `any` | **EXCLUDE** signers of that petition (or of anything) |
| `history` | `never` · `reached` | a `sent` row in `newsletter_deliveries` or not (see below) |
| `last_sent_before` | date | no `sent` row on or after that date (never emailed counts) — "not emailed since" |
| `joined_after` / `joined_before` | date | `created_at` of the row (join / first signature / checkout), inclusive |
| `not_list` | list id | **EXCLUDE** everyone on that saved list (snapshot + by hand) — e.g. all except the people the dormant mailing went to |
| `list` | list id | send to a saved list instead (composer only; the other keys are then ignored) |

Dates and the ZIP prefix are bound parameters; every other value is a
closed set, so nothing user-typed reaches SQL text (tests in
`packages/db/test/audience.test.mjs`).

**Newsletter history filter** (`history: 'never' | 'reached'`, all three
places: Mailing list page, composer, saved lists): whether
`newsletter_deliveries` holds a `sent` row for the address. `never` = the
dormant part of the list. The ledger starts 2026-10-05 (the admin sender);
the June 2026 issue (`docs/emails/`) and anything else sent by other tools
is NOT in it, so "never received" means never via the admin. The purpose
this was built for: a frozen list of `history = never`, mailed once, then
(if wanted) **Update** before the next one — the people just mailed drop
out because the ledger now holds them.

**People added by hand** (`mailing_list_members.source = 'manual'`;
snapshot rows are `'snapshot'`, NULL for rows from before the column). Two
ways in: the Saved lists card's "People added by hand" (paste `email`, or
`email, First, Last`, one per line — `parsePeople`, ≤500 at a time) and the
Mailing list page's per-row **Add to list** select. A frozen list mails them
with the snapshot (`memberOf` = every row); a dynamic list mails them in
addition to the filter match (`audienceQuery(filters, { orManualOf })` →
`(filters) OR EXISTS manual`). **Update** / **Make dynamic** replace or drop
the snapshot rows only; by-hand rows stay. Eligibility still rules: a pasted
address with no mailing-list row, or one that is unconfirmed / unsubscribed
/ bounced, stays on the list and is never mailed — the card shows each
person's status and the add result says how many will not be mailed. Tick
**Also add anyone not yet on the mailing list as a confirmed subscriber**
and the unknown addresses get a `subscribers` row with `confirmed_at = now()`
(the editor is asserting the person asked for our emails; audit
`subscribers.add` per address, entityType `subscriber`); an existing
unconfirmed or unsubscribed row is never changed. "Remove from list" deletes
the member row only (the person stays on the mailing list). Audits
`list.add` (counts) and `list.remove`.

**Resolver.** `packages/db/lists.js audienceFor(client, audience, opts)` is
the one function that turns a stored audience (`{ residency, donors,
petition, history }` or `{ list }`) into `{ sql, params, description }`:
the composer count, the Mailing list CSV, the request's frozen recipient
count and the Lambda's recipient query all call it. `null` = the audience
names a list that no longer exists (admin: "choose another audience";
Lambda: the run fails). A list's own filters never carry `list`
(`ownFilters`), so a list cannot point at a list.

**Rules** (`apps/admin/lib/lists.js`, editor+, audit `list.<verb>`,
entityType `mailing_list`; not matched by `CONTENT_ACTION_RE`):

| Action | audit | Effect | Refuses when |
|---|---|---|---|
| New list | `list.create` | insert; a `frozen` list is frozen in the same transaction (never empty) | no name |
| Save name & filters | `list.save` | name + filters; a frozen list's snapshot is NOT retaken (press Update) | — |
| Update | `list.freeze` | snapshot ← everyone the filters match now; `frozen_count` stamped | list is dynamic; a newsletter on the list is pending / approved / sending ("in flight": the reviewer approved a number) |
| Freeze now / Make dynamic | `list.mode` | → frozen snapshots now; → dynamic drops the snapshot | in flight |
| Delete list | `list.delete` | members + row | in flight (drafts and sent newsletters keep their `{ list }`; a draft then shows "deleted — choose another audience") |
| Download CSV | `subscribers.export` (diff `audience` = the description) | `POST /subscribers/export` with `list=<id>` → `audienceFor` | list gone → 404 |
| Add people (paste) / Add to list (Mailing list row) | `list.add` (+ `subscribers.add` per new subscriber when ticked) | `addMembers` upsert `source = 'manual'` | no valid address; > 500; list gone |
| Remove from list | `list.remove` | deletes the member row | not on the list |

The Mailing list page's filter form is the shared `AudienceFilters` control
set plus status + search, with a **Save these filters as a list** link
(`/lists?<FILTER_KEYS>`, which seeds the new-list form) and, per subscribed
row, **Add to list**. Logs: `[lists] <who> created/froze/mode/deleted/added/removed …`
(id, name, mode, counts — no addresses).

### Mailing list management (2026-10-06)

`/subscribers` (editor+) is both the audience dashboard and the list manager.
Two row sets come from ONE template in `packages/db/audience.js`
(`peopleRowsSql`):

| | Rows | Used by |
|---|---|---|
| `AUDIENCE_ROWS_SQL` / `audienceQuery` | recipients only: `confirmed_at` set, `unsubscribed_at` null, no suppressing SES event; plus opted-in members with no `subscribers` row | "This email is going to N", CSV, newsletter sender, `send-periodical.js` |
| `DIRECTORY_ROWS_SQL` / `directoryQuery` | everyone we hold a row for, each with `status` (`subscribed` · `unconfirmed` · `unsubscribed` · `suppressed`, in that precedence), `confirmed_at`, `unsubscribed_at`, `unsubscribed_by`; `deliveries: true` adds `sent_count` / `failed_count` / `last_sent_at` from `newsletter_deliveries` | the page's table and status counts |

`status = 'subscribed'` is exactly the audience. Directory filters
(`normalizeDirectoryFilters`): the audience filters (incl. `history`, see
"Saved lists") + `status` (default `subscribed`; `all` = everyone) + `q`
(email/name substring, bound and backslash-escaped for ILIKE). A member with ANY `subscribers` row is
represented by that row alone in both sets.

**Soft unsubscribe.** `subscribers.unsubscribed_at` / `unsubscribed_by`
(schema.js). `GET|POST /api/unsubscribe` now UPDATEs (`unsubscribed_by =
'self'`) instead of DELETE, and still clears `members.newsletter_opt_in`.
Signing up again (`/api/subscribe`) clears both and resets `confirmed_at`
to NULL when the row was unsubscribed (they re-confirm from the new welcome
email); signing a petition clears both and leaves `confirmed_at` as is
(signing = consent). A member-only unsubscribe (no `subscribers` row) just
clears the opt-in, so the person leaves the directory.

**Actions** (`apps/admin/app/subscribers/actions.js`, editor+, each one
`withWriteTx` + `recordChange` entityType `subscriber`, entityId = email):

| Action | audit `action` | Effect | Refuses when |
|---|---|---|---|
| Remove | `subscribers.remove` | stamps `unsubscribed_at = now()`, `unsubscribed_by = <admin email>`; an opted-in member with no row gets an INSERTed, stamped row so the removal stays visible; `members.newsletter_opt_in = 0` | already unsubscribed; address unknown |
| Undo removal | `subscribers.restore` | clears both stamps, `confirmed_at = COALESCE(confirmed_at, now())` | `unsubscribed_by = 'self'` (a person's own unsubscribe is never reversed by staff) or not unsubscribed |
| Erase record | `subscribers.erase` | `DELETE FROM subscribers`, `newsletter_opt_in = 0`; `email_events`, `members`, `donations`, `petition_signatures` untouched | confirm field differs from the address; address unknown |

The page renders a row-level `ActionForm` for Remove / Undo removal and a
separate Erase form (retype the address). Errors come back inline
(`runAction`). Logs: `[admin] <actor> subscribers.<action> subscriber` (no
address in the log line).

### Opens (campaign-level, 2026-10-06)

Org decision: no per-person tracking, but an issue-level open count is
useful. Every SENT copy (never previews or test sends) carries a 1×1 pixel
`PUBLIC_ORIGIN/api/open?c=<newsletter id>`; `GET /api/open`
(`aws/api/routes.js newsletterOpen`, API role `INSERT` only) stores one row
in `newsletter_opens` (id, newsletter_id, at — no address, no IP, no user
agent) and returns the gif, `Cache-Control: no-store`. The admin shows
"About N opens (~X% of sent)" on the list and the editor, with the caveat
that Apple Mail pre-loads images (over-counts) and image-blocking clients
are never counted (under-counts). Rows are deleted with the newsletter.
Click tracking (redirect links) is deliberately NOT built — links stay
plain, UTM-tagged for site-side attribution only.

Test sends go to the four admins (+ the sender) with the subject prefixed
`TEST: ` — button **Test send (all admins)**; "Send me a test" is the
single-address variant.

## Raw HTML mode (2026-10-08)

Composer checkbox **Ignore all style — raw HTML**. The typed HTML is stored
as one `{ type: 'raw', html }` block (≤ 200,000 chars) in front of the
builder blocks (which are kept, not sent). No schema change. When a raw
block is present `renderEmail` returns the HTML **as typed** plus one
Unsubscribe link inserted before `</body>` (or appended) — skipped when the
author already used `{{unsubscribe_url}}`. No theme, header, footer, UTM
tags, open pixel or View-in-browser. The text twin is the HTML with tags
stripped + `Unsubscribe: <url>`. List-Unsubscribe headers are unchanged
(send.js). No web copy: `renderFrozen` treats raw as `publishToSite` off
(the site CSP would strip inline styles). The author must include the
postal address (CAN-SPAM). Editors are trusted; the admin preview iframe is
`sandbox=""`, so scripts in raw HTML never run there.

## Rendering

- **Letterhead copies the live site** (2026-10-09; css/styles.css tokens):
  header band = `theme.accent` (default `--navy #1b2f4e`) with the site's
  logo mark (`LOGO_URL` = `https://utahciviccompact.org/assets/logo-icon-dark.png`,
  the mark the site shows on navy; 38×44, served by the live site) beside
  "Utah Civic Compact" in white, both linking to `SITE_URL`; optional
  eyebrow (`theme.highlight`, default `--red-light #e74c3c`, uppercase
  12 px) and the headline (white, 800). Body: white card on cream
  `#f5f1ea`, gray-900 text, navy headings/links/buttons, cream quote with a
  highlight rule. Footer band = accent again: theme footer lines + the
  Unsubscribe link in white. Default font `sans` = the site's Inter stack
  (not embedded; clients fall back to their system sans); `serif` =
  Playfair/Georgia. Dark mode: navy-dark page `#0f1e33`, card `#16263f`,
  bands `#0f1e33` (`.em-band`), highlight for headings/links.
  `DEFAULT_THEME.eyebrow` is '' — an eyebrow equal to the org name (older
  drafts) is not drawn, the letterhead already says it. Existing drafts keep
  their stored look; "Reset to the site look" in the composer applies the
  new defaults. `newsletter_defaults` on prod was `{}` at the change, so
  new drafts get the site look without any action.
- **Rich blocks** (`{type:'rich', html}`, ≤200k chars; "Document (HTML)" in
  the composer, what an import produces): `styleRich` walks the opening
  tags and writes the house look INLINE per tag (p/li = text styles,
  h1–h2 = heading, h3–h6 = sub-heading, blockquote/pre = quote box,
  tables with rule-coloured cell borders, nested ul/ol tighter, empty `<p>`
  → `&nbsp;` so a blank line keeps its height) plus the dark-mode classes.
  Sanitized by `lib/newsletter-import.mjs sanitizeRich` on import AND on
  every save (`lib/newsletters.js saveNewsletter`), never by the renderer
  (which the browser preview also runs). Web copy: `<div class="nl-rich">`
  with the sanitized HTML as is (no inline styles → CSP-safe), styled by
  css/newsletters.css. Text twin: `htmlToText` (also used by raw mode).
- Table-based 600 px card, inline styles (Gmail strips `<style>` partially),
  `<meta name="color-scheme" content="light dark">` + a
  `@media (prefers-color-scheme: dark)` block and `[data-ogsc]` twins
  (Outlook). Gmail ignores author dark styles and recolours itself — the
  composer says so; a test send shows the truth.
- Text block markdown: paragraphs, `- ` bullets, `## ` sub-headings,
  `**bold**`, `*italic*`, `[text](https://…)`. Author text is escaped FIRST;
  link/image URLs must be `http(s):` (`mailto:` for links); anything else
  is dropped silently by `normalizeBlocks`.
- **Recipient placeholders** (2026-10-10, `packages/newsletter/fill.cjs
  recipientVars`; filled per copy in `send.js buildMessage` — subject, HTML
  (escaped) and text — and in the admin's test send): `{first_name}`,
  `{last_name}`, `{email}` from the audience row (the Mailing list page's
  name for the address: subscriber row, else member). No first name on file
  → `there` (`NO_NAME`), so "Hi {first_name}," never reads "Hi ,". Word-style
  `[First name]` / `[Last name]` / `[Email]` are aliases (`aliasTokens`);
  any other bracketed text is left as typed. Unknown `{tokens}` stay as
  typed. The `{{unsubscribe_url}}` token is untouched by the fill (its inner
  `{unsubscribe_url}` is not a known key) and replaced afterwards. The
  frozen `html`/`text` keep the tokens — the fill happens at send time, so
  the web copy (`web_html`) shows them literally; a newsletter meant for the
  archive should avoid them or accept that.
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
| Lambda env | `DSQL_ENDPOINT`, `PUBLIC_ORIGIN` (unsubscribe links), `SECRET_ARN_TOKEN_SECRET`, `SES_CONFIGURATION_SET` (prod `ucc-prod`), `PUBLISH_FUNCTION_NAME` (web-copy publish) |
| SesEventsFn | env `DSQL_ENDPOINT`; IAM `dsql:DbConnectAdmin`; SNS subscription on the stack's ops topic |
| Lambda IAM | `dsql:DbConnectAdmin`, `ses:SendEmail` on the identity + `ucc-prod` set with the From pin, `secretsmanager:GetSecretValue` on TOKEN_SECRET, `lambda:InvokeFunction` on itself (detached policy — CDK cycle otherwise) and on PublishFn |

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

## Reply-To (2026-10-10)

The From address is IAM-pinned to hello@, so the person is carried by
`Reply-To`. `packages/db/newsletters.js authorReplyTo(client, fromName)`
looks up `team_members.email` for the card whose `name` equals the From
name and returns it lower-cased **only if it ends in
`@utahciviccompact.org`** (a personal address typed into a team card is never
exposed to the list); blank name, no card, no email or an outside domain →
`null` → no header, replies land in hello@ as before. Used by the send
Lambda (`handler.mjs runOne`, logged `reply-to=<addr>` / `(none: hello@)`;
`send.js buildMessage` adds `ReplyToAddresses`) and by the composer's test
sends (`lib/newsletters.js sendTest`). Reply-To is not authenticated, so it
has no SPF/DKIM/DMARC effect. An editor sets the address on the Team page
(`team_members.email`). Replies arrive in the person's Zoho mailbox; an
inbox inside the admin is a plan, not built (docs/plans/ses-inbox.md).
