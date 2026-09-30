# Development notes

Plain-language record of what has been built, changed or fixed on the site and
the admin — newest first. Written for the people running the site, not for
engineers; the technical detail lives in `docs/changelog.md` and `docs/systems/`.

---

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
