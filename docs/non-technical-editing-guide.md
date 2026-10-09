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
  the list or type any address. **Looks like** makes a top-level link or a
  whole dropdown look like the red Donate / Get Involved buttons (Get Involved
  is a dropdown set that way). To add a **new page** to the menu, create it in
  All documents first, then pick it here. Every menu change waits for a
  publish like anything else.
- **Writing page** (`/writing`) — builds itself from published documents and
  statements; nothing to edit. A document's **Category** sets its label there
  (Reports, Statements, Whitepapers).
- **Petitions** — one entry per petition. Every petition belongs to a
  **project** and gets its own page under that project's address
  (`/projects/<project>/<slug>`), a thank-you page under it, a card on the
  project page and a spot on `/petitions`. **Status**: *draft* (not on the
  site), *open* (taking signatures), *closed* (the page stays with the final
  count, no form). Tick **Show in the homepage hero** on one open petition
  to make it the homepage hero. Each petition's page holds its copy, the
  thank-you page's donation window (**amounts** as dollars, e.g. `5, 10, 25`;
  **one-time, monthly or both**; an Other amount is always offered), the
  **share** message and preview picture, its signatures with a CSV, and the
  **Thank-you email** dropdown (each petition has its own; nothing chosen =
  the built-in email with that petition's headline). The slug
  cannot change once anyone has signed — close that petition and start a
  new one. **New petition** on the list page starts a draft.
- **Appeals** also holds the **Thank-you email after a donation** dropdown
  (same idea; a donation email must contain `{receipt}`).
- **Appeals → Donate section** also feeds the **Donate page**
  (utahciviccompact.org/donate, where the nav's red Donate button goes): the
  fields marked `/donate:` are its headline, intro and the three "where your
  money goes" points. Leave them blank and the page reuses the homepage
  title and body. The amounts, the form and the questions on that page are
  code.
- **Homepage** — hero headline/subtitle, mission quote, about paragraphs,
  join section, donate section, donation pop-up text, the press strip.
  (The featured statement card is automatic: it is always the newest
  Statement.)
- **Team & Bios** — name, title, headshot, bio, and the person's admin email
  (that link lets them edit their own bio from their profile).
- **Projects** — every project has its own page on the site
  (`/projects/<slug>`) and a **workspace** in the admin: open a project from
  the table at the top of the Projects page. *Overview* is the record (name,
  status, button, intro; **Part of** makes it a sub-project of another).
  *Folders & files* shows everything under it: its documents, and folders
  holding files and notes. *Notes* are internal working notes — type
  Markdown or upload a `.md`/`.docx`; nobody outside the admin ever sees
  them; a note can become a draft document with one click. *Activity* is
  who changed what. The list editor underneath adds projects, reorders them
  (the order on the site) and holds the press articles and videos. A
  document joins a project in its editor (**Project**) or by ticking several
  on All documents and choosing **Move**; it then lives at
  `/projects/<project>/<slug>`, and the old address redirects after the
  next publish. Renaming a project keeps everything attached.
- **Press & coverage** — every news story or TV segment about the Compact,
  once. Paste the link under **Add from link** and the card fills itself.
  Pick the **Project** it is about and it appears on that project's page and
  in the coverage strip inside that project's reports; tick **Homepage card**
  for the three "Recent Coverage" cards on the homepage (the first three
  ticked, in list order); tick **Hide from News & Media** to keep a story on
  the project page only. The list order is the order on News & Media.
- **Statements**, **Policy Positions** — the lists the site pages are built
  from. Reorder with the arrows; the order you save is the order on the site.
- **Media Library** — upload images. **Alt text is required** before an
  image can be placed on a page (describe the image for screen readers).
  Pick an image in any "Headshot" field from the drop-down.
  Or upload straight from the Headshot field: a window lets you drag and
  zoom the photo inside a square so the face sits where you want it; only
  what is inside the square is uploaded.

Text fields that say so accept simple formatting: `**bold**`, `*italic*`,
`[link text](https://…)`, blank line for a new paragraph.

### Documents (long-form pages: reports, whitepapers, the privacy policy)
- Open **All documents** → pick one, or **New document**: choose the file
  the piece was written in (a `.docx` from Word, Google Docs or Claude Docs,
  a Markdown `.md`, or an `.html`) and leave the title and URL slug blank to
  take them from the file, or type them (`box-elder-report` becomes
  utahciviccompact.org/box-elder-report). The draft opens in the builder.
- **Start with the authoring and style kit.** At the top of All documents,
  download the kit (one `.html` file: open it in a browser to read it, hand
  the file as it is to Claude) and give it to Claude, or to whoever is
  writing, before the draft starts. It holds the site's voice rules (the things we
  never publish: em dashes, "it's not X, it's Y", buzzwords and the rest),
  the fields the admin asks for, the HTML the editor accepts, and the site's
  own styling: the page frame a document sits in, a sample page that shows
  every site pattern in use, and every class Claude may use with the CSS
  behind each one. Ask Claude for prose, for Markdown with the kit's block
  markers (the piece arrives with its boxes, figures and tables already
  styled), or for the HTML fragment; the kit explains all three.
- **The builder.** A document is a *Page header* (eyebrow, headline, summary,
  hero buttons, the byline strip with badge, date and author title, the
  contents list) and then *sections*, each a heading with its *blocks*: Text,
  Quotation, Callout box, Key figures, Image, Table, File downloads, Call to
  action, Sources, Collapsible sections and more. Every block has its own
  fields, a style choice (which kind of box, which kind of table) and a
  *Style* button for extra site classes. The thin **+ Add a block** bars
  between blocks open a gallery that shows each block type as it will look
  on the site; **+ Add a section here** sits between sections. Arrows move a
  block or section; × removes it.
- **Preview** on the right redraws a moment after every change, before you
  save. Click a piece in the preview to jump to its block. Anything that would
  stop publishing (an image without alt text, a skipped heading level, a class
  the site does not know) shows under the preview as you work, and in the
  ingest report after a save.
- **Start from a file** (top of the builder) replaces the whole document with
  a new file. Pictures inside a Word file become Image blocks waiting for an
  upload: open the block, type the alt text, upload.
- An older document still shows the HTML box instead; **Convert to blocks**
  under its form reads it into the builder (a revision is saved first, so
  Revisions can undo it). The eight long-form pages were converted this way
  and look exactly as before; boxes and tables that came with them show "This
  page's own style" until you pick a site style for them.
- **SEO** panel: meta title/description (description is required to
  publish), social-card fields, JSON-LD. The preview shows how a search
  result will look.
- **Styling**: the tree on the left lists every element; the preview on the
  right is the real page. Click an element in either, then pick classes
  from the site's Style Kit. "Promote to template rule" makes that styling
  apply to every future document automatically.
- Set **Status: published** and save; the page goes live with the next
  approved publish (section 2). Set it back to draft to take it down for
  now (the address then shows the site's "page not found").
- **Archive** (the Take down block at the bottom of a document) is for taking
  a page down for good: with the next approved publish the page is deleted
  and cleared from the cache, it leaves the sitemap, the author page and
  Writing, and its address answers "410 Gone", which tells search engines
  and anyone with an old link that it was removed on purpose. The text,
  styling and revisions stay in the admin. Archived documents are hidden
  from All documents behind the **Archived (N)** link; open one and press
  **Restore as draft** to bring it back (then publish it again as usual).
  Prefer Archive over Delete for anything that has ever been live.
- Re-pasting a revised version keeps the styling you applied.
- **Project**: pick the project a page belongs to and it is listed under
  that project's block on the site's Projects page, with a "This page is
  part of …" link at the foot of the page back to the project. The page a
  project's own button opens counts automatically. On All documents, the
  "By project" line filters the list, and the Projects page links to each
  project's documents and files.

### Financial
- **Donations** — every donation with donor contact info, whether it was a
  one-time gift or a monthly payment, and whether the donor's monthly plan
  is still active. Filter by when, amount, Utah or not, type, plan state,
  ticker, or search a name or email; the figures at the top describe
  everything that matches. Personal data: don't paste it anywhere public.
- **Costs** — what running the site costs: the AWS bill by service and
  month, what Stripe took in, kept and paid out, the active monthly plans,
  and the services that cost nothing. Read-only; refreshes when opened.

### Operations
- **Redirects** — when a page moves or is retired, send the old address to
  the new one. Takes effect with the next approved publish (section 2).
- **Subscribers** (Mail → Mailing list) — newsletter list, with a CSV
  download for the periodical. Personal data: don't paste it anywhere public.
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

## Outgoing emails (Mail → Outgoing emails)

The page has two parts. **Automatic emails** are the ones a person gets right
after doing something — signing the petition, donating. **Newsletters** go to
the whole mailing list after a second admin approves them.

### Automatic emails

- The table at the top lists each moment an email goes out (*Petition signed*,
  *Donation received*) and which email is attached to it. With nothing
  attached, a built-in email goes out (its wording is fixed; the petition's
  headline and project fill it).
- To use your own design: **New automatic email**, write it exactly like a
  newsletter (blocks, look, preview, *Save & send me a test*). Then go to the
  petition under **Petitions** (Thank-you email — each petition has its own
  choice) or the **Appeals** page (Thank-you email after a donation) and
  pick it from the dropdown — **Use this email**. It
  goes out from then on; swap to another one or back to *Built-in email* any
  time, no publish needed. Edits to the email do not go live until you pick
  it again (the page says "edited since" when that is the case).
- Type `{first_name}` where the person's first name should appear (a draft
  pasted from Word that says `[First name]` or `[$amount]` works too — the
  brackets are read the same way; only `{receipt}` must be typed with curly
  braces). For a donation the name comes from the donor's record, so a
  returning donor who skipped the name box is still greeted by name. Petition
  emails can also use `{headline}` and `{project_name}`. Donation emails can
  use `{amount}`, `{type}` and `{date}`, and **must** contain `{receipt}` —
  that is where the amount/date table and the "not tax-deductible" line go
  (attaching refuses without it). Put `{receipt}` on a line of its own, after
  the thank-you text and before the sign-off, and do not type the
  "not deductible" sentence yourself — the receipt block carries it. **Send
  me a test** on an automatic email fills every placeholder with sample
  values (your first name, $25.00, today's date, the real receipt table) so
  you can see exactly what a donor gets. The Unsubscribe link fills itself
  in. The *Audience* box is ignored for automatic emails.

### Newsletters

1. **Start writing**: type the subject line and press *Start writing*.
2. **Compose** on the left: preview text (the line inboxes show after the
   subject), an optional headline for the navy letterhead band (the logo
   and "Utah Civic Compact" are always there, copying the site), **From**
   (your name — the email arrives as "Your Name from Utah Civic Compact"),
   the **audience** (same choices as the Mailing list page; press **Apply
   filters** to see how many people the chosen filters reach before you
   save), then the content as blocks — *Heading*, *Text* (plain writing; `**bold**`, `*italic*`,
   `[link text](https://…)`, "- " for bullets), *Button*, *Image* (paste the
   *Upload an image* right in the block after typing its alt text, or paste
   an address from the Media Library), *Quote*,
   *Divider*, *Document (HTML)* (a document's own HTML, shown in the
   email's look). Use ↑ ↓ ✕ to reorder or remove. Or **import a file**
   (.docx from Word / Google Docs / Claude Docs, Markdown, text or .html):
   the document comes in as written — blank lines, numbered and nested
   lists, tables, code, quotes, links, underline, checklists — as a
   Document block after the blocks you have, in the email's look; images
   from inside a Word file come out as Image blocks that need an upload. *Look* changes colours, font, the optional
   small line above the headline and the footer; **Reset to the site look**
   puts the site's navy-and-red defaults back.
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
- **Mailing list** (Mail → Mailing list) shows everyone we hold with a
  status: subscribed, not confirmed yet, unsubscribed (and whether it was
  their link or someone here), or bounced / complained. Filter by status,
  search by email or name, and see how many newsletters each person has
  received. **Remove** takes someone off the list (reversible with **Undo
  removal** while it was done here; a person's own unsubscribe cannot be
  undone — they sign up again). **Erase a record** at the bottom deletes
  their mailing-list record for good, for a "forget me" request.
