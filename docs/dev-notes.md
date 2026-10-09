# Development notes

Plain-language record of what has been built, changed or fixed on the site and
the admin — newest first. Written for the people running the site, not for
engineers; the technical detail lives in `docs/changelog.md` and `docs/systems/`.

---

## 2026-10-08 — Documents: a block builder is replacing the paste-HTML editor (step 1 of several)

Uploading a document was meant to be easy and was not: the file became one
big box of HTML, images had to be re-inserted by hand, and the styling only
showed up after saving. The editor is being rebuilt so a document is a set
of **blocks** (text, a quotation, a callout box, key figures, an image, a
table, file downloads, and so on) under a fixed header (eyebrow, title,
summary, date and author, contents list), each block with its own styling
choices and a live preview that updates while you type.

This first step is the engine underneath, not yet the screen: the model of
what a document is made of, the code that writes the page from it, and the
code that reads an uploaded or existing page into blocks. Every one of the
eight existing long-form pages reads into blocks and comes back out with
exactly the same words, so the new system will be able to host them.

The second step moves the styling of those pieces (the byline strip, the
contents box, the scope and finding boxes, stat cards, pull quotes, figures,
tables, download buttons, source cards, the collapsible sections and the
part navigation) into the site's one shared stylesheet. Until now each of
them lived only inside the page that first used it, which is why a new
document could not use any of them and the license-plate statement
published as plain text. The existing pages are not affected: they keep
their own copies until they are moved over.

The third step is the screen itself, on the test site first:

- **New document** now starts from a file. Pick a .docx, .md or .html, leave
  the title and slug blank if you like, and the draft opens in the builder
  with the eyebrow, title, summary, byline and sections already filled in.
  Pictures inside a Word file come in as Image blocks waiting for an upload.
- **The builder** replaces the HTML box: a Page header (hero, byline,
  contents list), then sections, each with its blocks. Every block has its
  own fields, a style choice (for instance which kind of box a callout is)
  and a small "Style" button for extra site classes. Thin "+ Add a block"
  bars sit between blocks; "+ Add a section here" between sections.
- **Add a block** opens a gallery: every block type drawn exactly as it will
  look on the site. Hover a type to see it, click to add it.
- **Live preview** on the right redraws a moment after each change, before
  anything is saved. Click a piece in the preview to jump to it; problems
  that would stop publishing (a missing picture description, for instance)
  show under the preview as you work.
- **Existing documents** keep their HTML box and gain a "Convert to blocks"
  button. Converting keeps every word and saves a revision first, so it can
  be undone from Revisions. The eight long-form pages will be converted and
  checked against their current look in the next step; do not convert them
  by hand yet.

The fourth step moved the eight existing long-form pages onto the builder,
on the test site. Each one was read into blocks, written back out, and the
old and new pages were photographed in a browser and compared pixel by
pixel: all eight match exactly (the comparison is kept in
`docs/migration/blocks-conversion.md`). Each conversion saved a revision
first. Those pages keep their own styling; a converted page shows "This
page's own style" on boxes and tables that came from it, and choosing a
site style replaces it.

The authoring kit (the file handed to Claude before writing) now explains
the three ways to hand back a piece and the small markers a writing tool
can put in a Markdown file so a quotation, a scope box, key figures or a
table arrive as the right block, already styled. Its page-fields block asks
for the eyebrow, author title and date; pictures may be in the draft; the
hand-over checklist matches the builder. Download it again to get the
current version. An uploaded HTML fragment written on the kit's older
section-container-prose frame now takes the site's standard document frame
on upload (only converted pages keep their own). The editing guide's
Documents section describes the builder.

Layout, from Jarom's notes: the Document and SEO boxes sit centred at a
reading width; the builder's editor and preview each take half of the
screen on desktop and stack (preview below) on a narrow one.

The statement "Your license plate has a price" was never styled like the
reports, so it is the one page meant to change: it was copied from
production to the test site and rebuilt on the site's standard document
frame (badge, date and author strip, contents box, the reports' headings)
with its words untouched. Review it in the test admin's builder; the same
rebuild runs on production as part of the conversion there.

Live on the public site since 2026-10-09 (published on Jarom's say-so): the
new styling, the eight pages (unchanged in look) and the restyled
license-plate statement. Every document in the production admin now opens
in the builder. Nothing left for a person on this one.
## 2026-10-08 — Officials lookup joins the mailing list

The officials lookup (lookup.utahciviccompact.org) has a "Send me the Utah
Civic Compact newsletter" checkbox. Browsers used to block it from reaching
our mailing list because the lookup lives at a different web address. The
sign-up endpoint now accepts sign-ups from that one address (no other). People
who tick the box get the same welcome email as the join form and must press its
confirm button before they receive newsletters. Live now.

Needs a person later: when Turnstile (the anti-bot check) is switched on, add
lookup.utahciviccompact.org to the Turnstile widget's hostnames in Cloudflare,
or the lookup's sign-ups will be refused.

## 2026-10-08 — "Find Your Officials" in the menus

The officials lookup (lookup.utahciviccompact.org) is now linked from the top
menu and the footer; it opens in a new tab.

- **Top menu:** the red **Get Involved** button now opens a short list:
  **Join the Compact** (the sign-up form, where the button used to go) and
  **Find Your Officials**. A separate top-level item would push the Donate and
  Get Involved buttons off the screen on laptop-width windows.
- **Admin:** on **Menus (header & footer)**, a dropdown now has a **Looks
  like** choice, so a dropdown can look like the red button (that is how Get
  Involved is set).
- **Footer:** in the **Get Involved** column.

Editors can move or rename either link on **Menus (header & footer)**. Both
show after the next publish.

## 2026-10-07 — Sitemap fixed for Google Search Console

Search Console said the sitemap had an "Incorrect namespace". One letter was
wrong in a web address inside the file (`schema` instead of `schemas`). Fixed,
and a test now checks it. After the next publish, open Search Console →
Sitemaps → **Resubmit**. Google still found all 21 pages in the meantime.

## 2026-10-06 — Headshots: fit the picture to the frame before uploading

Headshots on the site sit in a square frame, and until now the site just
took the middle of whatever was uploaded. A tall phone photo could lose the
top of someone's head; an off-centre shot could cut a face in half, and
there was no way to fix it except re-editing the photo elsewhere.

Now, when you upload a headshot (on the Team editor or on **My profile**), a
small window opens first: drag the picture around and zoom in or out until
the face sits where you want it inside the square, then click **Use this
crop**. Only what is inside the square is uploaded, so the site shows exactly
what you framed — the same way a profile-photo picker works on social media.

- Works on phones (drag with a finger, pinch to zoom).
- The original photo never leaves your device; the cropped square goes up as
  a JPEG and is processed like any other image.
- Picking an existing Media Library image, or uploading straight on the
  **Media** page, does NOT crop — those behave as before (the site shows the
  centre). Upload through the Headshot field if you want to frame it.
- Existing headshots are untouched. Re-upload one through the field to
  reframe it.

Nothing is needed from anyone; the change is live once this deploys.

## 2026-10-06 — Projects now link to the documents under them, and back

Reports, complaints and other long-form pages that belong to a project were
only reachable through the project's one button, and the admin had no way to
see which pages or files went with which project. Now a project is the parent
of its pages:

- **On the site**, each project's block on the Projects page lists the
  documents under it (a "Documents" list above "Files"), and every one of
  those pages ends with "This page is part of <project> · All projects",
  which jumps back to that project's block.
- **In the admin**, a document has a **Project** field (in its editor and on
  the New document form). The page a project's own button opens counts as
  that project's automatically, so the existing reports are already nested
  without anyone doing anything. All documents has a Project column and a
  "By project" filter line; the Projects page starts with each project's
  Documents, Files and on-the-site links.

What to do: nothing for the existing reports. For a new page that belongs to
a project, pick the project in the editor. The site shows the lists after the
next approved publish.

## 2026-10-06 — Mailing list: see who is still subscribed, remove people, search and filter

The Mailing list page used to show only the people an email would reach, and
the only way off the list was the unsubscribe link in an email. Now:

- **Status next to every name.** Subscribed, not confirmed yet (they have not
  pressed the button in their welcome email), unsubscribed (with the date and
  whether it was their own link or someone here), or bounced / complained.
  The counts at the top show how many of each we hold.
- **Remove and undo.** A **Remove** button on each row takes the person off
  the list, the same as if they had clicked unsubscribe. A removal made here
  can be undone with **Undo removal**; a person's own unsubscribe cannot be
  undone by staff — they sign up again. **Erase a record** at the bottom of
  the page deletes someone's mailing-list record for good, for a "please
  forget me" request. Every one of these is written to the audit log.
- **Filters and search.** Filter by status (the default is "Subscribed", which
  is exactly who an email goes to), search by email or name, and keep the
  residency / donor / petition controls. The "This email is going to N
  people" line and the CSV still describe recipients only, whatever the
  table is showing.
- **More detail per person.** Confirmed date, how many newsletters they have
  received and when the last one went out, failed sends, and whether a
  bounced address was a hard bounce or a spam complaint.
- Behind the scenes, unsubscribing no longer deletes the person's row; it
  marks it, so the page can show who left. Someone who unsubscribes and later
  signs up again has to confirm again from the new welcome email.

Nothing for editors to set up. The database change is already applied to
staging and production. The unsubscribe-link behaviour on the public site
changes when the API is next deployed.

## 2026-10-06 — Documents: archive a page for good

Every document now has a **Take down** block at the bottom with an
**Archive this document** button. Archiving is for a page that should not be
on the site any more, as opposed to setting it back to draft while you work
on it.

What archiving does, once the next publish request is approved:

- The page and its styling are deleted from the site and cleared from the
  cache, so the old copy stops being served everywhere within a minute or so.
- It leaves the sitemap, the author's page and the Writing list.
- Its web address answers "410 Gone" with a short "this page has been
  removed" message. That is the signal search engines treat as "drop this
  from results now", and it tells anyone with an old link that the removal
  was on purpose. A plain draft, by contrast, shows the ordinary "page not
  found".
- The address stays reserved, so nothing older can reappear there.

Nothing is lost on the admin side: the text, styling, settings and revision
history stay. Archived documents are hidden from the All documents list
behind an **Archived (N)** link. Open one and press **Restore as draft** to
bring it back; it returns to the site only when you set it to published and
a publish is approved again. Restoring an older revision of an archived
document also brings it back as a draft, never straight to live.

Delete still refuses a published document: archive first. Prefer Archive
over Delete for anything that has ever been live.

Left to do by a person: none for editors. The "410 Gone" answer needs one
infrastructure deploy; until that is done an archived page shows the normal
"page not found" instead, which is just as unreachable.

## 2026-10-06 — Petition link: the preview headline follows the form title, and the share picture is now on navy

Two sharing fixes.

- **Headline on the link.** When the petition link was posted or texted, apps
  showed "Sign the Petition" no matter what was typed in the admin, because
  that headline was fixed in the page itself. It now follows the **Form title**
  on the Petition page (today: "Get The Flock Off Our Streets"), which is also
  the browser-tab title. Blank = Sign the petition.
- **Share picture.** The logo file has a see-through background, so each app
  painted its own (white, grey, black) behind it. The default picture is now
  the white logo on the site's navy, sized for a wide preview card. It is the
  default for every page on the site and for documents, not only the petition.
  A picture chosen in **Share: preview image** still wins on the petition.

Nothing to do for editors. Apps cache link previews, so a link already posted
may keep the old look until the app refreshes it.

## 2026-10-06 — Users page: password reset fixed for invited people, and a way to remove someone

**Reset password** looked broken. It failed, with a confusing message about
*your own* password, whenever it was pressed for someone who had been invited
but never signed in. That is most people on the list today. The cause: there
is no password to reset until the person finishes their first sign-in, so the
sign-in service refuses. Also refused: a disabled account.

- For someone who has not signed in yet the button now reads **Resend
  invite** and sends them a fresh temporary password instead.
- For a disabled account the button is greyed out: enable them first.
- Any other refusal now shows the real reason instead of the wrong message.

**Remove a user** is a new section at the bottom of the Users page. Pick the
person, type their email to confirm, and their sign-in is deleted for good
(Disable remains the reversible pause). Nothing they did is lost: edits,
publish approvals, uploads, newsletter approvals and the audit log all keep
their name, because those records store the name itself and not a link to the
account. The audit log also records who was removed and what role they had.
You cannot remove yourself; another owner has to.

Also corrected the note at the bottom of the page: admin sessions last four
hours, not one, and signing someone out everywhere stops new sign-ins at once
but does not cut a session they already have open; that ends when its cookie
expires.

Nothing is left for a person to do.

## 2026-10-07 — New Writing page, and a Writing menu

**utahciviccompact.org/writing** lists everything we have published — reports,
statements, papers — newest first, with buttons to show just one kind. It
builds itself: publish a new document or statement and it appears there.

- The header has a new **Writing** menu: All writing · Statements · Reports ·
  Newsletters. The footer's Organization column links to it too.
- A document's **Category** decides its label. "Twenty-Five Years Later" is filed
  under Reports; set its Category to **Statements** to list it as a statement.
- The privacy policy (category Legal) is left out on purpose.

**Planned, not built:** a central **Payment options** page to define donation
asks once and reuse them anywhere. Written up for the technical team in
`docs/proposals/payment-options.md`.

## 2026-10-06 — Privacy policy rewritten to match what the site really collects

The privacy policy at utahciviccompact.org/privacy still described the old
Airtable tipline and nothing else. It now covers every way the site collects
information: the confidential tipline, the updates mailing list (and its
confirmation email), petitions (including that signatures may be delivered to
the officials a petition addresses, and that signing joins the mailing list),
donations through Stripe (and the opt-in public donor list), plus the small
automatic things: the bot check, the one-hour abuse rate limit, the per-issue
open count in newsletters, YouTube embeds, and hosting on Amazon Web Services.
It states how long each kind of record is kept and what requests we honor.

- **Live now** on the site and in the admin's **Documents → Privacy Policy**.
  Edit it there like any other document; the old wording is in its history.
- **Later the same day:** the storage paragraph briefly described how staff
  sign in to the admin. Removed — the admin is internal and not something the
  public policy should describe. It now says only that access is limited to
  staff who need it and that tips are seen only by editorial staff and leadership.
- **Two commitments in the text need a person to stand behind them** (both
  reversible by editing the page): the petition record we deliver will not
  include signers' email addresses or phone numbers, and a signer may ask to
  be removed before delivery. There is no remove-a-signature button in the
  admin; such a request goes to the developer for now.
- **Bug found, not yet fixed:** the tip form shows an *Attachments* file picker,
  but attached files are never sent anywhere. The policy deliberately does not
  mention attachments. Either wire attachments up or remove the field.
- The SES approval note in the operator runbook that said "the privacy page only
  describes the tipline" is now closed.
## 2026-10-06 — Publish & Status shows exactly what will change

Before anyone approves a publish, **Publish & Status** now lists **What will change
on the live site**, one row per section — Team & Bios, Petition, Menus, News &
Media, each document — with a count and who changed it. Click a row to see the
detail:

- **Edited: Kaden Payne** — Title: Chief Technology Officer → **Chief Technology Officer, Board of Directors**
- **Added / Removed** news stories, team members, menu links
- **Documents** — status changes (published → draft takes a page **off** the site), text edited (+120 words), styling changed

It shows the **net** effect: something changed and then changed back shows as no
change. The old list of individual saves is still there, folded under **Save log**.

## 2026-10-06 — Edit the menus and footer yourself

New in the admin: **Menus (header & footer)**, under Site Main.

- **Header menu** — rename, reorder (arrows), add a link or a whole dropdown,
  remove. **Into dropdown** / **Out of dropdown** moves a link between the top
  level and a dropdown such as About Us. Each top-level link can look plain, like
  the red **Donate** button, or like the outlined **Get Involved** button.
- **Footer columns** — the Organization / Get Involved / Contact columns: rename,
  add, remove, reorder, and edit their links.
- **Footer bottom line** — where **Privacy Policy** lives. Add more links there
  (Terms, Accessibility…).
- **Picking where a link goes** — the **Links to** box lists every page on the site
  (drafts are marked "not live"), or type any address.
- **Adding a new page** — create it in **All documents**, then pick it in Menus.

Nothing changes until you save and publish. The menus start out exactly as they
are on the site today — checked against all 19 live pages.

The privacy policy **text** has always been editable: All documents → **privacy**.

## 2026-10-06 — Petition: share buttons, and you control the donation ask

**Sharing.** /petition and the thank-you page now have share buttons:
Facebook, X, Bluesky, Text, Email, Copy link — and on phones, the phone's own
share menu. A link posted anywhere now shows a picture and the headline.

**The donation ask is yours to edit.** On the Petition page in the admin,
under the thank-you fields:

- **Amounts** — type them as dollars, e.g. `5, 10, 25, 50`. An **Other** button
  for any amount is always added.
- **One-time or monthly** — `both` shows a switch; or just `one-time` or `monthly`.
- Title, text, button and checkbox wording.
- **Share message** and **preview image** — paste a Media Library path; a
  1200×630 picture shows large. Blank uses the logo.

Everything blank looks exactly as before, plus the One-time / Monthly switch
and Other. Like any copy, it goes live when you publish.

## 2026-10-06 — Audit: changes made outside the admin

A check of everything changed directly (not through the admin) since the
move to AWS. Nothing broken; every change shows in the admin.

- **2 October:** two KUTV stories, two videos and the homepage press list
  were added straight into the database. They show in News & Media and
  Homepage, with a revision you can roll back from **Revisions**.
- **5 October:** five DNS records for Amazon email (SES), added in Cloudflare.
- A team-page change was saved and requested on 6 October but not yet
  approved — it isn't live until someone approves it on Publish & Status.
- An out-of-date copy of the code on Conner's laptop was renamed
  `uccsite-refactor-STALE-do-not-use`; publishing from it would have
  rolled the site back to 2 October.

## 2026-10-06 — Jarom's title is now "Director of Policy" everywhere

**What changed.** Jarom Gillins' role on the Team page and his author page
read "Senior Policy Director". The title field had already been changed to
"Director of Policy, Board of Directors" in the admin earlier today and
published, but the first sentence of his bio still said "Senior Policy
Director", so the Team page, the author page and the page descriptions
search engines show were out of step. The bio now says "Director of Policy"
too, the site was republished, and the copy of the team list kept in the
code and the SEO plan were updated to match.

**What editors do differently.** Nothing. The change shows in Team & Bios
as a saved-and-published edit under Jarom's account.

**Left to do.** Nothing on the site. The old wording on LinkedIn, X and
press bylines is outside the site and is Jarom's to update.

## 2026-10-06 — Guards so a document cannot quietly publish unstyled again

**What changed.** Three warnings now fire in the admin before a page can go
out looking like plain text:

- On a document's HTML box, before you save: a red warning if the HTML uses
  classes copied from one of the site's existing reports (those belong to
  that page alone and are removed on save), and a softer notice if the body
  has no page frame at all (no section, container or prose wrapper).
- In the ingest report after a save: "N classes removed, the page will
  publish without their styling" is now red, lists the names, and says not
  to request publish until the report is clean.
- On the Documents editor, the Styles page and at the very top of the
  downloaded authoring kit: a red banner whenever the live site's stylesheet
  is older than the code (that is what caused this evening's trouble: the
  new styles had been written but not yet deployed and published, so the
  editor could not know them). It says exactly what is pending.

**What you do differently.** Nothing, unless a banner appears. If the kit
opens with the red "may be incomplete" warning, ask for a deploy and publish
before writing, or download it again afterwards.

**Also checked.** The admin deployed with the new kit rules (build 50
succeeded) and the live stylesheet now matches the code, so none of the
banners should be showing today.

## 2026-10-06 — Why "Your license plate has a price" published as bare text

**What happened.** The statement was built with the authoring kit, but the
HTML that came back copied the structure of an existing paper on the site
(how-did-this-happen): classes such as paper-body, release-meta, paper-toc,
ask-box and btn-file. Those belong to that page's private stylesheet, not
to the site's, so the editor removed all seventeen of them on save (the
ingest report listed each one) and the page went live as unstyled text
under a correct hero. No page frame or prose wrapper was used either.

**What changed.** The kit now says in three places not to imitate a live
page's markup, names the usual offending classes, and repeats that a class
seen on the site but missing from the kit's list does not exist for a
document.

**Fixed the same evening.** The statement's body was rebuilt on the kit's
frame (hero with the byline and two ghost buttons, then the cream content
band with the prose wrapper; the table of contents, the "For lawmakers" ask
and the "paper this follows" box are callouts; the sources are a plain
numbered list), saved as a new revision under Jarom's name, and published.
The previous version is in the document's revision history. Nothing in the
text changed.

## 2026-10-06 — New documents can look like the site's reports without any CSS

**What changed.** The site's stylesheet had no styles for the running text
of a document. The existing reports each carry their own private CSS, so a
new piece written with the authoring kit arrived as bare text with no space
between paragraphs, even with the right page frame. The stylesheet now has a
"Document prose" set: one wrapper that styles every plain heading,
paragraph, list, quote, table, picture caption and link inside it the way
the existing reports look, plus a white callout box, a dark callout box and
a small red label for them. The authoring kit, the sample page in it and the
admin's Styles page list them automatically.

**What you do differently.** Nothing new to learn. Give Claude the fresh
kit; its HTML now puts the running text inside the prose wrapper, so the
piece arrives styled. The kit also stops claiming the site prints a byline:
it does not, so a bylined piece carries its own "By Name, date" line at the
end of the hero.

**Decision recorded.** No automatic styling is added on upload; the writer's
tool styles the piece before it is uploaded, and the editor adjusts on the
Styling tab if needed.

**Published.** The new stylesheet is live on utahciviccompact.org and in
the admin as of about 1:50am on 6 October (the site's stylesheet only
changes when the system is redeployed and then published; both were done).
If you downloaded the kit before then, download it again: it now lists the
Document prose classes and the sample page uses them.

## 2026-10-06 — The authoring kit now carries the site's styling

**What changed.** The authoring kit (the file you download at the top of All
documents and hand to Claude) used to describe the site's writing rules and
the HTML the editor accepts, but told Claude to leave styling alone and
listed only a couple of dozen class names with one-line descriptions. It
now carries the site's styling in full: the frame a document page sits in
(the dark hero with the headline, then the centred content sections), the
site's colours, fonts and spacing values, and every class Claude may use
together with the exact CSS each one applies, grouped the way the site uses
them (typography, buttons, stats bands, cards, utilities). Claude is told to
use them. There is also a full worked example: one sample page, in the site's
voice, that uses almost every one of those classes the way the site itself
does (hero, framing line, plain section, stats band, numbered cards on cream,
linked card grid, two-column recommendation with a quote card, press
coverage with a video), with a note on each block saying what it is for. A
machine reading the kit sees the use case, not just the class name. The kit
checks the example against the live stylesheet every time it is generated
and says which classes it leaves out.

**Why.** A document's body is dropped straight between the site header and
footer with nothing around it. HTML written without the site's classes
therefore lands as plain, unstyled text and someone has to style it by hand
on the Styling tab. With the styling rules in the kit, the HTML Claude hands
back can be uploaded and look like the site on arrival.

**What you do differently.** Download a fresh kit before each piece (it is
rebuilt from the live stylesheet every time). When the draft is finished,
ask Claude for the HTML fragment rather than prose if you want it to arrive
styled; the prose route still works and is styled afterwards in the editor.

**One file, as a web page.** Later the same day the kit became a single
`.html` file instead of a `.md`: open it in a browser and the writing rules
read as a normal page, the sample page renders with the site's real
stylesheet (dark hero, stats band, cream cards, press coverage), and its
source sits right under it. The site's stylesheet is embedded in the file so
it renders and so Claude can read each class's CSS beside the markup; a note
at the top says the site itself never accepts inline styles, only the
classes. Hand the file to Claude unchanged.

**Nothing to finish.** No keys or decisions needed. One thing worth knowing:
a plain paragraph inside the site's content frame has no spacing of its own
(the real reports get theirs from per-document page CSS), so a new piece
still needs the report prose styles added on the Styling tab, or a template
rule written once for all reports.

## 2026-10-06 — Home-screen icon: the navy tile now actually reaches phones

**What changed.** Yesterday's fix put the UCC mark on a navy tile, but phones
that reinstalled the app still got the old cream/transparent one. The admin
tells browsers its icon files never change (cached for a year), and the
install screen asks for them by plain name, so a phone kept the copy it
already had. The icon files now have new names, so every phone fetches the
navy version fresh.

**What you do.** Remove the app from the home screen and add it again; it
should come back on navy. On iPhone, if it still shows the old tile, Settings
→ Safari → Advanced → Website Data → remove admin.utahciviccompact.org, then
add again.

**For the future.** Whenever the icon artwork changes, it needs a new file
name (`docs/systems/admin.md` "Phone / PWA" says how), or phones keep the old
one for a year.

## 2026-10-06 — The admin now looks like the site

**What changed.** The admin used to be a green-and-gold back office that
shared nothing with utahciviccompact.org. It now uses the site's own look:
the deep navy of the site's header and footer for the sidebar, phone top bar
and tab bar; the site's red as the accent (the bar beside the page you are
on, the ring around a publish request waiting for review, the Sign in and
Delete buttons); the site's cream for notes and quoted messages; and the
site's typeface, Inter. Every box — editors, the publish request, media
cards, tables — is a white rounded card with a soft shadow, buttons and
fields have the same rounded corners and focus glow as the site's forms, and
the sign-in page is a centred card with the UCC mark.

**Nothing moved.** Every page, button and field is where it was; only the
appearance changed. On a phone the layout from yesterday (top bar, bottom
tabs, menu sheet) is the same, restyled to match. Installed-app users will
notice the status bar colour change to navy.

**Not yet done.** Still not checked on a real phone — the layout was verified
in a desktop browser at phone width. If anything looks off on your device, a
screenshot is enough to fix it.

---

## 2026-10-05 — The admin works on a phone, sessions last four hours

**Phone layout.** The admin used to be a desktop-only layout: a fixed sidebar
that ate a phone screen, tables wider than the viewport, two-column editors
that never stacked. On a phone (or any narrow window) there is now a bar
across the top that says where you are (for example *Operations › Tips*),
tabs along the bottom for the places most often checked from a phone
(Publish & Status, Documents, Mail, Tips) and a **Menu** tab that opens the
full navigation as a sheet: only the section you are in is unfolded, the
others open with a tap, and a *Find a page* box at the top filters the list
as you type. The sheet closes itself when you pick a page. Wide tables
scroll sideways with a finger, the Documents style editor and the newsletter
composer stack their columns, and form fields are sized so iPhones stop
zooming in when you tap one.

**Add it to your home screen.** iPhone: open the admin in Safari, tap Share,
then *Add to Home Screen*. Android: open it in Chrome and choose *Install
app* from the menu. It opens full-screen like an app, with the UCC icon on
the site's navy blue (the logo is transparent, so phones were painting it on
a cream tile).
There is no offline mode on purpose: every screen shows live data, so an
offline copy would only ever be stale.

**Navigation on every screen.** Publish & Status now sits at the top of the
sidebar instead of halfway down. The page you are on is highlighted, each
section (Site Main, Documents, Mail, Operations, Account) folds away when you
tap its name, a *Find a page* box at the top of the sidebar filters the
list, and your name with the Sign out button stays pinned at the bottom.

**Sessions.** You stay signed in for four hours instead of one. A role change
or a forced sign-out by an owner therefore takes up to four hours to bite
unless the owner uses *sign out everywhere*. Sensitive changes on *My
profile & security* still ask for a sign-in less than 15 minutes old.

**Documents: .html upload.** Uploading an .html file into a document's HTML
box now also works when the phone's file picker hands the file over without
its name ending in .html.

Needs a person: open the admin on an actual phone, sign in, add it to the
home screen, and try one edit on each of Documents, Mail and a list page;
report anything cramped. Details in `docs/systems/admin.md` ("Navigation &
phone use").

## 2026-10-05 — Long-form writing: an authoring kit for Claude, and Word/Markdown upload

Writing a report used to mean producing HTML by hand and pasting it into a
document. Two changes make that easier.

**The authoring kit.** At the top of All documents there is now a download
link for one file, the authoring kit. Give it to Claude (attach it to a chat,
or add it to a Claude Project so every chat there uses it) before you start
writing. It tells Claude how the site writes and what it never publishes
(em dashes, "it's not X, it's Y" framings, lists of three for rhythm,
buzzwords, vague "experts say" attributions, invented figures, and the rest
of the machine-writing tells), the page fields the admin asks for (title,
slug, category, author, meta description), how a piece is shaped, and the
exact HTML the editor accepts, including the classes that are applied
automatically and the ones a writer may use. You then ask Claude for one of
three things: prose only (write in Claude Docs, Word or Google Docs and save
a .docx), the HTML fragment to paste, or a conversion of a draft you already
wrote. The kit is rebuilt from the live stylesheet every time it is
downloaded, so download a fresh one for each new piece.

**Upload a file.** The document editor's upload box now takes a .docx (from
Word, Google Docs or Claude Docs) or a Markdown .md file as well as .html.
Word and Markdown are converted to clean HTML on the spot and put in the
body box for you to review and save; the usual ingest report still runs on
save. Pictures inside a Word file are not carried over: each one becomes a
numbered placeholder paragraph, and you upload the image on Media and insert
it in its place with alt text.

- **Editors:** before a new piece, download the kit and hand it to the
  writer. When the draft comes back, upload it or paste it; nothing else
  changes. Styling, preview, SEO and the two-person publish are as before.
- **Unfinished:** template styling rules are what make a plain draft land
  styled; the kit lists whichever rules exist. If none exist for the report
  template yet, add them on the Styles page (promote-to-rule from any
  document) and the next kit download will carry them.

## 2026-10-05 — Author pages: every team member now has a page of their work

Each person on the Team page now has their own page at
utahciviccompact.org/team/first-last (for example /team/jarom-gillins). It
shows the bio and headshot and lists everything on the site written by that
person — investigations, reports, statements, policy positions. Clicking a
name on the Team page, or any "By …" byline anywhere on the site, goes there.

Why: a search for a team member's name was showing their outside history and
nothing from this site. The site named people but gave search engines nothing
to attach the name to. Each author page now carries structured "this is a
person, this is their work" data that every bylined page points back at, and
the homepage lists the team the same way.

- **Editors:** Team & Bios has two new fields. *Public profile links* — one
  URL per line (LinkedIn, X, a personal site). Fill this in for each member;
  it is what tells search engines the person on LinkedIn and the author here
  are the same person. *Author page URL slug* — leave blank unless a name
  changes. Documents have a new **Author** field: type the team member's full
  name exactly as it appears on the Team page, or the piece will not show on
  their author page.
- **Needs a person:** (1) each member adds their profile links; (2) Jarom's
  bio rewrite is drafted in docs/seo-plan.md — edit it there, then paste into
  Team & Bios; (3) register the site in Google Search Console and submit the
  sitemap (steps in docs/for-conner.md). The pages went live on production
  the same evening (operator publish).
- Technical detail: docs/systems/author-pages.md.

## 2026-10-06 — Newsletter open counts (per issue, not per person) and the test-send button

Each sent newsletter now shows **about how many times it was opened** on
the Newsletters list and on its page. The count is per issue: nothing
records *who* opened it, and no address or device is stored. Treat it as a
rough signal — Apple Mail "opens" every email on the reader's behalf, and
other mail apps block images entirely.

The **Test send (all admins)** button is now the main test button. It emails
the saved draft to Jarom, Conner, Clark and Kaden with `TEST:` at the start
of the subject. "Send me a test" still sends to you alone.

- **Nothing to set up.** Test sends never count as opens.
- Technical detail: docs/systems/newsletters.md "Opens".

## 2026-10-05 — Newsletters, round two: bounces, confirmations, web archive, quality-of-life

Follow-ups to this morning's Mail section:

- **Copy as a new draft** on any newsletter, and **Use this look as the
  default** so every new draft starts with the org's colours, font and footer.
- **Send a test to all admins** beside "Send me a test".
- **Change the send time** of a pending request without withdrawing it, and
  when a declined email is re-requested the reviewer sees **what changed**.
- **Web copy.** By default each sent newsletter is also published at
  utahciviccompact.org/newsletters/… (the email gets a "View in browser"
  link; the footer of the site links to the archive). Untick "Also publish
  a web copy" in the editor to keep one email-only.
- **Bounces and spam complaints** are now recorded: addresses that hard-
  bounce or complain are skipped automatically from then on, and the
  Mailing list page shows them.
- **Confirmed sign-ups.** The welcome email now has a "Yes, that's me"
  button. Until someone presses it they get nothing but that one email.
  People who signed a petition count as confirmed, and everyone who joined
  before today is grandfathered in. The join form on the site tells people
  to look for the button.
- Behind the scenes: list-mail headers, automatic retries when Amazon
  throttles, recipients left in limbo by an interrupted send are retried,
  links in emails carry campaign tags (no per-person tracking), owners can
  download one send's per-recipient delivery list.

- **Conner:** two DNS edits and, a week later, one more — runbook §12. Also
  the org's postal address for the email footer when there is one.
- Technical detail: docs/systems/newsletters.md.

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
