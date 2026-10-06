# Mailing system — recommended next steps (plan, 2026-10-05)

Written after building the Mail section (docs/systems/newsletters.md). Nothing
here is started; each item says what, why, effort, and what it touches. Order
is my recommendation. Items marked **decision** need an org call first.

## Tier 1 — quick wins (hours each; do in the next session)

1. **Reply-To the author.** From is `"<Name> from Utah Civic Compact"
   <hello@…>`; a reply today lands in the hello@ box. Set `Reply-To` to the
   author's `@utahciviccompact.org` address (team_members.email) when the
   From name is a team member. Touches `aws/newsletter/send.js`
   (`ReplyToAddresses`), nothing else. Zero deliverability risk (Reply-To
   is not authenticated). *Decision:* confirm replies should go to the
   person, not the shared inbox.
2. **Duplicate a newsletter.** "Copy as new draft" on a sent/declined email
   (blocks + theme + audience, new subject). Most newsletters start from
   the last one. `lib/newsletters.js` + a button on `/mail`.
3. **Bulk-header hygiene.** Add `List-Id: <newsletter.utahciviccompact.org>`
   and `Precedence: bulk` beside the existing List-Unsubscribe headers.
   Helps Gmail/Yahoo bulk-sender classification and keeps auto-replies and
   out-of-office bounces off hello@. `send.js` only.
4. **Throttle-safe sending.** The loop treats SES `TooManyRequestsException`
   like any failure (recipient marked failed, Retry needed). Add a short
   exponential backoff (3 tries) for throttling/5xx before recording a
   failure. `send.js`, test in `aws/newsletter/test`.
5. **Default look lives in Site Settings.** Theme (colours, font, eyebrow,
   footer) is per email; a new draft starts from `DEFAULT_THEME`. Store the
   org default once (site_settings columns or a JSON group in homepage) and
   seed new drafts from it, so a palette change is one edit. `collections.js`
   + `lib/newsletters.js createNewsletter`.
6. **Test to the whole team.** "Send a test to all admins" next to "Send me
   a test" (the four reviewer addresses). Trivial; lets reviewers see the
   real Gmail/Apple rendering before approving.

## Tier 2 — bounces, complaints and who is really on the list (a day)

7. **Record bounces and complaints per address.** SES already routes
   BOUNCE/COMPLAINT/REJECT to the ops SNS topic (email only) and the
   account-level suppression list silently drops those addresses on later
   sends — which shows up as "failed" deliveries each time. Add an SNS →
   Lambda (or SQS) subscription that writes `email_events(email, type,
   subtype, at, message_id)`; the audience query excludes hard bounces and
   complaints; Mailing list shows the reason; the newsletter's delivery
   panel shows "N suppressed" instead of "N failed". Touches CDK (topic
   subscription + small Lambda), `packages/db/audience.js`, `/subscribers`,
   `data-handling.md`.
8. **Per-recipient delivery view (owner).** Today the editor page shows
   counts only. An owner-only expandable table / CSV of the ledger
   (address, status, error) for a given send, audited like the subscriber
   export. `app/mail/[id]`.
9. **Resolve "unknown" deliveries.** Rows left `sending` by a crashed run
   are neither sent nor retried. On Retry (and on the stall re-kick), treat
   `sending` rows older than 10 minutes with no message id as not sent and
   attempt them. `packages/db/newsletters.js beginDelivery` + tests.
10. **Unsubscribe scope check.** `/api/unsubscribe` removes a *subscriber*
    row; an opted-in Stripe *member* who unsubscribes from a newsletter may
    still be selected by the audience union. Verify and, if so, flip
    `members.newsletter_opt_in` too. `aws/api/routes.js`.

## Tier 3 — the newsletter as part of the site (two to three days)

11. **Web archive + "View in browser".** Publish each sent newsletter at
    `/newsletters/<yyyy-mm>-<slug>` through the existing publish pipeline
    (a Document generated from the frozen HTML at send time, or a new
    render page), list them on a `/newsletters` index, and put a "View in
    browser" link in the email header. Good for SEO, for people who hear
    about an issue later, and for transparency. Touches
    `packages/render`, `aws/publish/render-db.js`, the send Lambda (writes
    the archive row), nav. *Decision:* archive everything, or only when the
    writer ticks "publish to the site".
12. **UTM tagging.** Append `utm_source=newsletter&utm_medium=email&utm_campaign=<id-or-slug>`
    to every link into utahciviccompact.org at render time so site
    analytics (if/when added) attribute traffic. No per-recipient tracking,
    no open pixels — consistent with the org's stance on surveillance.
    `packages/newsletter/render.mjs`.
13. **Request diff on re-review.** When a declined newsletter is re-requested,
    show the reviewer what changed since the last request (blocks diff from
    the audit snapshot). Needs `newsletter.save` to store a snapshot in
    `revisions` (lib/data.js already supports it) and a small diff view.
14. **Edit the schedule while pending.** A pending request's time is fixed;
    changing it means withdraw → re-request. Allow the requester/owner to
    change `scheduled_for` on a pending row (audited). Small.

## Tier 4 — policy / ops (needs people)

15. **DMARC to `p=quarantine`** once Mailgun is cancelled and the SPF
    `include:mailgun.org` is removed (for-conner §10.4): every sender is
    then SES (DKIM-aligned) or Zoho. Watch the DMARC reports for a week
    first. *Decision + hand:* Conner.
16. **Double opt-in for the join form.** Today a join-form email is on the
    list immediately (welcome email, no confirmation). Confirmed opt-in
    lowers complaint risk and is what Gmail/Yahoo bulk-sender rules push
    toward. Costs some sign-ups. *Decision.* If yes: a `confirmed_at`
    column, a signed confirm link in the welcome email (packages/tokens),
    audience excludes unconfirmed after 7 days.
17. **Postal address in the footer.** CAN-SPAM wants a physical or PO-box
    address; the default footer says "Salt Lake City, UT". Put the real
    address in the default theme footer once there is one. *Hand:* the
    org.
18. **Retire `scripts/send-periodical.js`** after two successful admin sends,
    or keep it documented as the break-glass path. Either is fine; the
    audience logic is shared so it cannot drift.

## Not recommended

- Open/click tracking per recipient (pixels, redirect links): at odds with
  the org's position on surveillance, and the list is small enough that it
  would not change decisions.
- A/B subject lines: the list is too small for a meaningful split.
- Moving to a third-party ESP: SES + the admin now covers composing,
  review, scheduling, unsubscribe and bounce handling; the remaining gaps
  (7, 11) are a day or two each.
