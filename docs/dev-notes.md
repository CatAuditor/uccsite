# Development notes

Plain-language record of what has been built, changed or fixed on the site and
the admin — newest first. Written for the people running the site, not for
engineers; the technical detail lives in `docs/changelog.md` and `docs/systems/`.

---

## 2026-10-05 — Jarom's admin account on the live site

Jarom's live-site admin account was under the wrong email (a personal Gmail
address), so sign-in at admin.utahciviccompact.org never worked for the
work address. The work address (jarom.gillins@utahciviccompact.org) is now an
owner on the live site; Cognito emailed a temporary password. The Gmail
account is disabled on both the live and the test site.

What to do: open the invite email, sign in, and on the first screen choose
"Sign in with password" (or "Try another way") if the page asks for a
security key first — none is set up yet. After setting a real password,
/profile offers an authenticator app and security keys.

Still open: with two owners signed in (Conner and Jarom), two-person
publishing works on the live site for the first time.

## 2026-10-05 — The petition hero is live; the admin now shows which hero is showing

- **Published:** utahciviccompact.org now opens with the petition hero and
  `/petition` takes signatures.
- **Admin → Homepage and Admin → Petition** open with a box titled *Which hero
  is showing?* It reads the live homepage on the spot and says whether it is
  the petition takeover or the standing hero, next to what is saved in the
  admin. Green = in sync; gold = saved but not yet published; red = the live
  check could not run (reload).
- The standing hero (Homepage → Hero fields) stays the default: blank the
  petition headline on the Petition page and it comes back on the next publish.

## 2026-10-05 — Petition: Utah vs out-of-state, a public counter, and "who is this email going to"

Follow-up to the petition launch below.

- **Anyone can sign, Utah is what counts.** Out-of-state signatures are kept
  but separated. Residency comes from the ZIP: every 84xxx ZIP is Utah.
- **Counter on the site.** The hero and /petition show "**N** Utahns have signed
  so far." (wording editable on Admin → Petition, field *Signature counter*).
  Only Utah signatures count; it appears once there is at least one and
  updates when someone new signs — no timed refresh.
- **Admin → Petition** now shows Utah / outside counts per petition, a
  residency switch, a Utah column, and the CSV can be Utah-only, outside-only
  or both (new `utah_resident` column).
- **Admin → Subscribers is now "Mailing list"** — everyone an email can reach
  (sign-ups, petition signers, donors who opted in). Controls: residency
  (Utah / outside / ZIP unknown), signed a given petition, donors only. The
  page says "This email is going to N people" and the CSV follows the same
  filters. The newsletter sending script takes the same options, so what the
  page shows is who gets the email.

- **Real copy is in.** The hero and /petition now quote the permit agreement:
  UDOT may terminate it if "UDOT determines that the public does not support
  the Company's activities." Staged for review; the live homepage flips on the
  next approved publish (or the operator's go).

**Needs a person:** approve the publish that puts the petition hero on the live
homepage.

## 2026-10-05 — Petition: the homepage now leads with "Tell UDOT" and collects signatures

The site can run a petition. The first one asks UDOT to revoke the special-use
permits for license-plate-reader cameras.

- **Homepage hero:** while a petition is on, the top of the homepage is the
  petition — label, headline, the UDOT provision, a red **Sign the petition
  now** button and a link to the ALPR report. Blank the headline and the old
  hero comes back.
- **/petition:** the form. Required: first and last name, ZIP, email.
  Optional: full address, phone. Under the button: "By signing this petition
  you agree to be included in future communications regarding our fight for
  Utahns." Signing also adds the person to the mailing list (without
  overwriting anything they already told us on the join form).
- **After signing:** a thank-you page ("…tell UDOT not to enable a
  surveillance state… $25 will help us carry this fight through the
  legislature") with **I can help** (opens a $10 / $25 / $50 / $100 chooser,
  $25 preselected, then Stripe) and **Not this time**.
- **Admin → Petition** (Site Main): every word of the campaign copy, the
  signature list, and **Download CSV** (name, email, ZIP, address, phone and
  the exact signing time). Change the slug to start a new petition later;
  old signatures stay under the old one.
- **Admin → Subscribers:** two new columns in the list and the CSV —
  **Donor** (has given through the site) and **Petitions** (which ones they
  signed) — so a mailing can be aimed at donors or signers.

**What is left for a person:**
- Enter the real copy on Admin → Petition (the headline and body currently
  carry placeholder wording for the UDOT provision), save, request a publish,
  and have a second admin approve it. The hero stays as it was until then.
- Decide whether the ZIP must be a Utah ZIP (today any 5-digit ZIP is accepted).

## 2026-10-05 — Email is moving from Resend to Amazon SES (step 1 of 3)

The site's emails (welcome message, billing-portal link, newsletter) still go
out through Resend. We are switching them to Amazon's own email service (SES),
which keeps everything inside the AWS account we already run.

- **Done:** the AWS side is set up — our domain is registered with SES, the
  signing keys exist, and bounced or complained-about emails will alert the
  operators.
- **Needs Conner:** five DNS records in Cloudflare (`docs/for-conner.md` §10.1),
  all set to "DNS only". Nothing about Zoho mail changes.
- **Then:** a one-time request to AWS to allow real sending (§10.3), usually
  answered within a day. After that the developer switches the code over.
- Until the switch, nothing changes for anyone; Resend keeps working if its key
  is set.

## 2026-09-30 — Add news stories by pasting a link

On **News & Media** and the homepage press list there is now an **Add from link**
box. Paste an article link, press **Fetch preview**, and you see the card a
social feed would show — picture, outlet, headline, summary. **Add to top** puts
it first in the list with everything filled in. Nothing is saved until you press
**Save**, and nothing goes live until a second admin approves a publish.

- Outlets already in the list keep their name and badge colour — KSL stays "KSL".
- Spanish stories get "Leer en …" and the Spanish language tag automatically.
- Utah News Dispatch and Forbes block previews. For those, the date and a draft
  headline come from the link itself; fix the headline and add a summary.
- The homepage shows three press items. Adding one there drops the oldest.

## 2026-09-30 — The site now runs on Amazon (AWS)

utahciviccompact.org switched from Cloudflare to AWS at 3:26 pm. Every page,
report, donor and subscriber came across and was checked against the old site.
Email (Zoho) was not affected.

- **Rollback:** point the two DNS records back at `uccsite.pages.dev`. The old
  Cloudflare site stays ready until **30 October 2026**, then gets retired.
- **Still to do:** Resend key (welcome and billing-portal emails), confirm the
  Stripe webhook address, copy tip history out of Airtable, nightly GitHub backup.

## 2026-09-30 — Admin has a permanent address

The admin runs at **admin.utahciviccompact.org**, hosted on AWS Amplify. It
rebuilds itself whenever code is pushed to the `refactor` branch. Sign-in needs
an authenticator app.

## 2026-09-24 — Publishing a file takes two people

Uploading a document to **Files** and pressing **Request publish** no longer puts
it on the internet by itself. A different admin has to approve a publish first,
same as every other change. **Unpublish** still works instantly with one person —
taking something down fast is a safety valve.

## 2026-09-23 — Old editor removed, homepage and team fixed

- The old content editor (Decap) was still reachable at `/admin` on the new site
  with no password. Removed.
- The homepage shows the three newest statements again, matching the old site.
- Team page: Kaden Payne added, Jarom's title and the new headshots copied over.

## Before 2026-09-23

The AWS version of the site was built and tested in September 2026. See
`docs/changelog.md` for that history.
