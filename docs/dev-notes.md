# Development notes

Plain-language record of what has been built, changed or fixed on the site and
the admin — newest first. Written for the people running the site, not for
engineers; the technical detail lives in `docs/changelog.md` and `docs/systems/`.

---

## 2026-10-05 — Upload images right where you use them

Image fields no longer send you to the Media Library first. Beside the
**Team headshot** field (Team & Bios and your own profile), inside a
newsletter's **Image** block, and on a document's **og:image** (the picture
shown when a page is shared), there is now an alt-text box and an
**Upload** button. Type what the image shows, choose the file, wait a few
seconds while it is processed, and the field fills itself in. The image
also appears in the Media Library as usual.

- **Editors:** alt text is required before the upload starts — that is the
  same rule the Media Library has always enforced.
- **Needs a person:** nothing.
- Technical detail: docs/systems/media.md "Inline upload".

## 2026-10-05 — Newsletters: write, preview and send email from the admin (Mail section)

The admin has a new **Mail** section. **Newsletters** is a small
Mailchimp-style composer: write the email from blocks (headings, text,
buttons, images, quotes, dividers), pick the colours and font, choose the
audience with the same filters as the Mailing list, and watch it render on
the right exactly as a phone would show it — with **Light / Dark** and
**Phone / Desktop** switches. **Send me a test** emails the saved version to
you. The **Mailing list** page moved under Mail too.

Sending follows the same rule as publishing the site: the writer **requests
the send** (now, or at a chosen Mountain-time date and time), a
**different** admin approves it (owners can approve their own), and only
then does it go out — from "Your Name from Utah Civic Compact"
<hello@utahciviccompact.org>, with an unsubscribe link in every copy. The
page then shows how many were delivered and any failures; a failed send can
be retried without emailing anyone twice. Requests show up on Publish &
Status and the other admins get an email, just like a publish request.

- **Editors and owners:** nothing to set up — open Mail → Newsletters. The
  non-technical editing guide has a step-by-step section.
- **Needs a person:** nothing. The operator script for sending is still
  there as a fallback but should not be needed.
- Technical detail: docs/systems/newsletters.md.

## 2026-10-05 — "Request publish" beside every Save button, and an email when a request needs a reviewer

Editors no longer have to walk over to Publish & Status to ask for a
publish: every Save button in the admin now has a **Request publish**
button next to it (collections, homepage, appeals, petition copy, settings,
documents, style rules and mappings, redirects, media alt text, your own
bio). It asks to publish everything saved so far — save first, then press
it. The message that appears tells you what happens next.

When the person asking is an **editor**, the other admins (Jarom, Conner,
Clark, Kaden — minus whoever asked) get an email from
hello@utahciviccompact.org saying a request is waiting, with the list of
saves and a link to Publish & Status. When an **owner** asks, nobody is
emailed: owners approve their own requests, so there is nothing for anyone
else to do. The Publish & Status request form behaves the same way.

- **Also fixed (approval bug hunt):** for the first minute after an
  approval the dashboard still showed the approved saves as "unpublished"
  with a working Request publish button, so people asked again for what was
  already going live. It now shows "Publishing now…" and refreshes itself
  until the publish lands; requesting or approving during that time is
  refused with an explanation. Times on Publish & Status and in the review
  email are now Mountain time (they were UTC with no label). The Decline
  button no longer appears on your own request, and asking twice says "your
  request is already waiting" instead of quoting your own email back.
- **Fixed the same day:** saves on the Petition page and the Donation appeals
  page were never counted as "unpublished", so Request publish said there was
  nothing to publish and Publish & Status did not list them. They count now.
- **Nothing to do** for editors or admins beyond using the new button.
- Staging never emails real people; a developer can point it at a test
  address if they need to see the email.
- Technical detail: docs/systems/admin.md "Publishing" and docs/systems/email.md.

## 2026-10-05 — Email: all sending moved to Amazon SES (step 3 of 3)

Every email the site sends now goes through Amazon SES: the welcome email
(sent when someone joins), the billing-portal link (sent when a member asks
to manage their donation), and the newsletter (sent by the operator's
script). Resend and Mailgun are no longer used. Nothing changes for
visitors: same sender address, same wording, same unsubscribe link. Bounced
or complained-about messages now reach the operations alert list and are
automatically kept off future sends.

- **Conner:** cancel the Resend and Mailgun accounts; nothing uses them now.
  The AWS copy of the Resend key is scheduled for deletion. Two small DNS
  cleanups for Mailgun are listed in the runbook — optional.
- **Sending the newsletter:** same command as before, minus the Mailgun key.
  Only the unsubscribe-signing secret is needed in `.env`.

## 2026-10-05 — Email: AWS approved production sending (step 2 of 3)

The DNS records for Amazon SES were confirmed in place and our domain is fully
verified, so we asked AWS to take the account out of its email sandbox.
**AWS approved it the same day.** The account may now send to anyone, up to
50,000 messages a day. In the AWS console this only shows under the
**US West (Oregon)** region; other regions show "Get started" and that is
normal.

Also done today:

- **Alert emails.** Jarom, Conner and Kaden were subscribed to the operations
  alert list (bounced email, failed publishes, spend warnings). **Each of you
  must click "Confirm subscription" in the AWS email you just received**, or
  you will not get alerts.
- **AWS console access.** Kaden now has an administrator login (Conner already
  had one). Jarom has Kaden's temporary password; it must be changed at first
  sign-in. Both should turn on two-factor (MFA) in the AWS console.

Nothing changes for editors. Emails still go out through Resend until the
developer switches the sending code over after AWS approves (step 3).

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

## 2026-10-05 — "Server Action was not found" when saving

If a save fails with that message, the admin was redeployed while the page
was open (it happened several times today). Nothing was saved. Reload the
page and save again. The admin now says exactly that, with a Reload button,
instead of the raw error.

## 2026-10-05 — Owners can publish their own changes

An **owner** no longer needs a second admin: request the publish as before,
then approve it yourself on Publish & Status (the page says it is your own
request). Editors still need a different admin to approve. Every
self-approval is recorded in the Audit Log as such.

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
