# Pending questions

Decisions made without an answer during hands-off sessions (CLAUDE.md
"Unanswered Questions"). Each entry: the question, the options, the choice
taken (the most reversible one). Answer by editing the code/content or
telling the agent; delete the entry once applied.

## 2026-10-05 — Petition build (docs/systems/petition.md)

1. **Does signing the petition add the person to the newsletter list?**
   Options: (a) yes, upsert into `subscribers` — the consent line says they
   agree to future communications; (b) no, keep signers separate.
   **Chose (a).** Reversible: drop the second upsert in `petitionSign`.
2. **Send the welcome email to petition signers?** Options: (a) no, the
   thank-you page is the acknowledgment; (b) yes, same as the join form.
   **Chose (a).** Reversible: dispatch the `welcome-email` job in `petitionSign`.
3. **Store IP / user agent with each signature as evidence?** Options:
   (a) no — privacy org, and the CSV for UDOT needs name/ZIP/time, not IPs;
   (b) yes. **Chose (a).** Adding a column later is additive.
4. ~~Restrict ZIP to Utah?~~ **Answered 2026-10-05:** collect from anywhere,
   separate Utah from outside, count Utah only. Residency = ZIP 84xxx
   (`packages/db/audience.js`). Follow-on choices made without an answer:
   the public counter hides while the Utah count is 0; **refresh: answered
   2026-10-05 — only when someone new signs** (cache invalidated by a Utah
   signature; no timer);
   the mailing list's residency uses the best ZIP on file (subscriber ZIP,
   else newest petition ZIP, else member ZIP) and people with no ZIP are
   their own "ZIP unknown" audience rather than lumped in with Utah.
5. **Where does the petition copy live?** Options: (a) a `petition` group on
   the homepage singleton, edited on a dedicated admin page; (b) a new
   `petitions` table/collection. **Chose (a)** — ADR
   docs/decisions/petition-copy-in-homepage-group.md.
6. **Rate limit for `/api/petition`?** 5/hour like the join form would block
   a volunteer signing people up from one phone. **Chose 20 / IP / hour.**
7. **"Not this time" on the thank-you page** goes to `/` (homepage). The
   modal's own dismiss just closes the modal.

## Privacy policy rewrite (2026-10-06, no answer possible in a hands-off session)

The rewritten policy at /privacy makes two commitments nobody had stated
before. Both chosen as the most privacy-protective, most reversible reading;
change the page text if the org decides otherwise.

1. **What goes to UDOT / the legislature with a petition?** Options:
   (a) names + ZIP (+ street address where given), no email or phone;
   (b) the full CSV incl. email and phone. **Chose (a)** and the policy says so.
   The admin CSV export still contains everything, so whoever delivers it
   must trim the email and phone columns first (or the dev adds a
   "delivery" export).
2. **Can a signer withdraw before delivery?** Options: (a) yes, by emailing
   info@ (no admin button exists; the dev deletes the row); (b) no. **Chose
   (a)**; the policy says "before delivery". Add a per-signature delete to
   admin /petition if requests actually arrive.
3. **Tip attachments.** The tip form shows an Attachments picker but
   js/tip.js never sends files. Options: (a) remove the field; (b) build
   upload to the media bucket under a private tips/ prefix. **Not chosen**
   — left as found; the policy does not mention attachments.

## 2026-10-09 — Transactional emails + petition filed under a project (docs/systems/email.md, petition.md)

1. **"Petitions filed under their respective project" — one live campaign
   linked to a project, or several petitions open at once?** Options: (a) keep
   the one-campaign model and add a Project field (hub shows the petition,
   signatures carry the project, email links it); (b) a `petitions`
   collection (slug, project, copy, open/closed) with its own pages under
   `/projects/<path>/petition` and several open at once. **Chose (a)** — it
   fulfils the filing without re-plumbing the hero/form/thank-you pages;
   signatures already key on the slug, so (b) can be built on top later
   without touching the data.
2. **Email on every signature or the first only?** Options: (a) first only;
   (b) every re-sign. **Chose (a)** — a re-sign is the same person; sending on
   each would let anyone trigger repeat mail to an address they do not own.
3. **Receipt on monthly renewals (`invoice.paid`)?** Options: (a) no — only the
   checkout; (b) yes, monthly. **Chose (a)**; Stripe's own receipts can cover
   renewals if switched on in the Stripe dashboard. Reversible: dispatch the
   job from `handleInvoicePaid`.
4. **Where monthly donors manage their membership.** The receipt says to email
   info@utahciviccompact.org (no public portal page exists; the portal API
   needs an emailed magic link). Option: build a /manage page that posts to
   `POST /api/create-portal-session`.
