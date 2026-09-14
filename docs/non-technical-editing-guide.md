# Editing the UCC Website — Guide for Team Members

Plain-language guide to the Utah Civic Compact admin: how to sign in, what
you can change, how changes reach the live site, and what still needs a
developer. No code knowledge needed.

The admin lives at **admin.utahciviccompact.org** (once hosting is switched
on; until then a developer runs it for you). It is separate from the public
site — nothing you do in the admin is visible to the public until you press
**Publish**.

---

## 1. Signing in

- You get an **invite email** from the site with a temporary password. The
  first sign-in asks you to choose a real password (12+ characters).
- After that, open **My profile & security** and set up at least one of:
  - an **authenticator app** (Google Authenticator, 1Password, Authy…) — a
    6-digit code at every sign-in;
  - a **security key or passkey** (YubiKey, Touch ID, Windows Hello, your
    phone) — signs you in without a password and cannot be phished.
  Keep two ways in (a key and the app, or two keys) in case one is lost.
- Forgot your password? An **owner** can send you a reset from the Users
  page. Lost your only second factor? An owner can remove it.
- Sign out with the button at the bottom of the sidebar. Sessions end after
  an hour on their own.

**Roles**

| Role | Can |
|---|---|
| **viewer** | look at everything, change nothing |
| **editor** | edit all content, upload images, request and approve publishes, see donors and subscribers |
| **owner** | everything, plus invite people, change roles, reset passwords |

---

## 2. Save, request, approve — the one thing to understand

Every editor page has a **Save** button. Saving changes the database only;
it is a draft. **Nobody can put something on the public site alone.**
Going live takes two people:

1. The writer opens **Publish & Status**. It lists every save since the
   site last went live. They add a short note for the reviewer and press
   **Request publish**.
2. **Any other editor or owner** opens the same page, reads the list and
   the note, and presses **Approve & publish** — or **Decline with notes**
   (a note is required, so the writer knows what to fix). You cannot
   approve your own request, owners included.
3. Approving renders every page from the database and pushes what changed;
   it takes about a minute and the page shows "Publishing…" then "Live".

Only one request can wait at a time. If you change your mind, **Withdraw**
it. Saves made after the request but before the approval go live with it —
the page shows them separately, so the reviewer sees exactly what they are
approving. Declined and approved requests, with their notes, stay listed
under "Recent publish requests".

Every save is kept in **Revisions** (last 20 per section). Restoring one
puts that version back as a draft; request a publish to take it live.

---

## 3. What you can edit

### Site Main
- **Site Settings** — organization name, contact email, Instagram, footer
  text, copyright line.
- **Homepage** — hero headline/subtitle, mission quote, about paragraphs,
  join section, donate section, donation pop-up text, the press strip.
  (The featured statement card is automatic: it is always the newest
  Statement.)
- **Team & Bios** — name, title, headshot, bio, and the person's admin email
  (that link lets them edit their own bio from their profile).
- **Statements**, **Policy Positions**, **News & Media** (articles and
  videos), **Projects** (each with its press articles and videos), **Report
  Coverage** — the lists the site pages are built from. Reorder with the
  arrows; the order you save is the order on the site.
- **Media Library** — upload images. **Alt text is required** before an
  image can be placed on a page (describe the image for screen readers).
  Pick an image in any "Headshot" field from the drop-down.

Text fields that say so accept simple formatting: `**bold**`, `*italic*`,
`[link text](https://…)`, blank line for a new paragraph.

### Documents (long-form pages: reports, whitepapers, the privacy policy)
- Open **All documents** → pick one, or **New document** (title + the URL
  slug, e.g. `box-elder-report` becomes utahciviccompact.org/box-elder-report).
- Paste the page's HTML (or upload an `.html` file) into the body box. On
  save the site cleans it: scripts, inline styles and anything unsafe are
  removed and the **ingest report** tells you exactly what changed. Fix
  anything it flags (an image without alt text, two `<h1>`s, a skipped
  heading level) — a page cannot be published with those.
- **SEO** panel: meta title/description (description is required to
  publish), social-card fields, JSON-LD. The preview shows how a search
  result will look.
- **Styling**: the tree on the left lists every element; the preview on the
  right is the real page. Click an element in either, then pick classes
  from the site's Style Kit. "Promote to template rule" makes that styling
  apply to every future document automatically.
- Set **Status: published** and save; the page goes live on the next
  Publish. Set it back to draft to take it down.
- Re-pasting a revised version keeps the styling you applied.

### Operations
- **Redirects** — when a page moves or is retired, send the old address to
  the new one. Takes effect on the next Publish.
- **Donations** — every donation with donor contact info. **Subscribers** —
  newsletter list, with a CSV download for the periodical. Both are
  personal data: don't paste them anywhere public.
- **Audit Log** — who changed what, when.

---

## 4. Things that need a developer

- Changing the **layout or design** of the homepage, team, news, statements,
  policy, projects, tip or donate pages (their templates are code).
- New **fonts**, site-wide CSS, new page types, new fields on a form.
- Anything involving **Stripe, email sending, the tipline, or secrets**.
- Adding a new class to the Style Kit that documents should use.

Ask in the usual channel with the exact text and a screenshot if it's
visual; a developer changes the code and publishes.

---

## 5. Safety notes

- Publishing is fast and public. Read the Publish & Status page after an
  approval — it tells you if anything failed. Reviewers: you are the second
  pair of eyes; open the changed pages before approving.
- If a publish shows an error naming a document, open that document: the
  same message is on its page, and the fix is usually alt text or a
  heading level.
- Don't share your temporary password or authenticator codes with anyone,
  including "IT" — nobody on the team will ever ask for them.
- Nightly, the content is backed up to the code repository automatically;
  Revisions cover the everyday "undo".
