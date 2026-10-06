# Editing the UCC Website — Guide for Team Members

Plain-language guide to the Utah Civic Compact admin: how to sign in, what
you can change, how changes reach the live site, and what still needs a
developer. No code knowledge needed.

The admin lives at **admin.utahciviccompact.org** (once hosting is switched
on; until then a developer runs it for you). It is separate from the public
site — nothing you do in the admin is visible to the public until a publish
request is approved (section 2). Nobody rebuilds anything by hand.

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
- Sign out with the button under your name in the sidebar. Sessions end after
  four hours on their own.
- **On a phone**, open the admin in Safari (iPhone) or Chrome (Android) and
  use *Share → Add to Home Screen* (iPhone) or *Install app* from the menu
  (Android). It then opens full-screen like an app. The bar at the top shows
  where you are; the tabs along the bottom jump to Publish & Status,
  Documents, Mail and Tips; **Menu** opens everything else, with a
  *Find a page* box at the top. Wide tables scroll sideways.

**Roles**

| Role | Can |
|---|---|
| **viewer** | look at everything, change nothing |
| **editor** | edit all content, upload images, request and approve publishes, write newsletters and request/approve sends, see donors, subscribers and tips |
| **owner** | everything, plus invite people, change roles, reset passwords, delete tips |

---

## 2. Save, request, approve — the one thing to understand

Every editor page has a **Save** button. Saving changes the database only;
it is a draft. **Nobody can put something on the public site alone.**
Going live takes two people:

1. The writer presses **Request publish** — it sits beside every **Save**
   button, or on **Publish & Status**, which lists every save since the
   site last went live and takes an optional note for the reviewer. Save
   first: the request covers what has been saved, not what is still in the
   form. If the writer is not an owner, the other admins get an email
   saying a request is waiting.
2. **Any other editor or owner** opens the same page, reads the list and
   the note, and presses **Approve & publish** — or **Decline with notes**
   (a note is required, so the writer knows what to fix). Editors cannot
   approve their own request; owners can.
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
- **Menus (header & footer)** — the menu at the top of every page and the
  footer links, including **Privacy Policy** on the bottom line. Reorder with
  the arrows; **Into dropdown** / **Out of dropdown** moves a link between the
  top level and a dropdown such as About Us. In **Links to**, pick a page from
  the list or type any address. To add a **new page** to the menu, create it in
  All documents first, then pick it here. Every menu change waits for a
  publish like anything else.
- **Petition** — the campaign copy, the thank-you page's donation window
  (**amounts** as dollars, e.g. `5, 10, 25`; **one-time, monthly or both**; an
  Other amount is always offered) and the **share** message and preview
  picture used when people post the petition link.
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
- **Start with the authoring kit.** At the top of All documents, download
  the kit (one `.md` file) and give it to Claude, or to whoever is writing,
  before the draft starts. It holds the site's voice rules (the things we
  never publish: em dashes, "it's not X, it's Y", buzzwords and the rest),
  the fields the admin asks for, the HTML the editor accepts, and the site's
  own styling: the page frame a document sits in, a sample page that shows
  every site pattern in use, and every class Claude may use with the CSS
  behind each one. Ask Claude for prose, or for the HTML
  fragment; the kit explains both. The HTML fragment is the one that arrives
  already looking like the site, so prefer it when the piece is finished.
- Fill the body box one of three ways: paste HTML; **upload a file** (a
  `.docx` from Word, Google Docs or Claude Docs, a Markdown `.md`, or an
  `.html`; Word and Markdown are converted to HTML for you, and any pictures
  inside are replaced by a placeholder you swap for an image from Media); or
  type. On save the site cleans it: scripts, inline styles and anything unsafe are
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
- Set **Status: published** and save; the page goes live with the next
  approved publish (section 2). Set it back to draft to take it down.
- Re-pasting a revised version keeps the styling you applied.

### Operations
- **Redirects** — when a page moves or is retired, send the old address to
  the new one. Takes effect with the next approved publish (section 2).
- **Donations** — every donation with donor contact info. **Subscribers** —
  newsletter list, with a CSV download for the periodical. Both are
  personal data: don't paste them anywhere public.
- **Tips** — confidential tipline submissions. Open one to read it and mark
  it *In review* or *Closed*; owners can delete a tip. Nobody can edit what
  the tipster wrote. Never copy tip contents out of the admin.
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

## Newsletters (Mail → Newsletters)

1. **Start writing**: type the subject line and press *Start writing*.
2. **Compose** on the left: preview text (the line inboxes show after the
   subject), an optional headline for the green band, **From** (your name —
   the email arrives as "Your Name from Utah Civic Compact"), the
   **audience** (same choices as the Mailing list page), then the content
   as blocks — *Heading*, *Text* (plain writing; `**bold**`, `*italic*`,
   `[link text](https://…)`, "- " for bullets), *Button*, *Image* (paste the
   *Upload an image* right in the block after typing its alt text, or paste
   an address from the Media Library), *Quote*,
   *Divider*. Use ↑ ↓ ✕ to reorder or remove. *Look* changes colours, font,
   the small line above the headline and the footer.
3. **Preview** on the right is what a phone shows. Switch **Light / Dark**
   and **Phone / Desktop** to check both. Gmail does its own dark-mode
   recolouring, so also use **Send me a test** — it emails the saved version
   to you with `[TEST]` in the subject.
4. **Save**, then **Request send**. Leave the time empty to send as soon as
   someone approves, or pick a date and time (Mountain time, at least five
   minutes ahead) to schedule it. The other admins get an email.
5. **Review** (a different admin, or an owner for their own): read the
   preview, then *Approve* (sends now, or at the scheduled time) or
   *Decline with notes*. The writer can *Withdraw* a request to keep editing,
   and anyone can *Cancel* a scheduled send before it starts.
6. **After sending** the page shows how many were delivered and any
   failures. A failed send can be *Retried*; people already sent to are
   skipped.

A request freezes the email: once requested it cannot be edited until it is
withdrawn, declined or cancelled (the requester or an owner can still
*change the send time* of a pending request). Only owners can delete a
newsletter.

Also useful:

- **Copy** (on the list, or *Copy as a new draft* in the editor) starts a
  new draft from any earlier email.
- **Use this look as the default** makes the current colours, font, small
  header line and footer the starting point for every new newsletter — set
  it once, and put the org's postal address in the footer when there is one.
- **Test send (all admins)** emails the saved version to the four admins with
  `TEST:` at the start of the subject; **Send me a test** goes to you only.
- After a send, the list and the page show **about how many opens** the
  issue got — per issue, never per person, and only a rough signal.
- **Also publish a web copy** (ticked by default) puts the sent email at
  utahciviccompact.org/newsletters/… and adds a "View in browser" link to
  the email. Untick it for an email that should stay email-only.
- After a send, the page shows delivered / failed / **suppressed** counts.
  Suppressed means the address bounced hard or marked us as spam; it is
  skipped automatically from then on. The Mailing list page lists them,
  along with sign-ups who have not pressed the confirm button yet.
