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
   the public counter hides while the Utah count is 0; it refreshes every
   60 s (`COUNT_TTL_MS` in aws/api/routes.js — "update timing tbd");
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
