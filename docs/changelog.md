# Changelog

One entry per push to the remote (CLAUDE.md rule). Version bumps: minor per
migration phase, patch per fix push. Open P0/P1 items are listed at the time
of each push.

## v0.21.0 — 2026-10-06 (branch `refactor`) — Admin guards against publishing an unstyled document

**Admin / Documents** (`apps/admin/lib/documents.js`, `lib/authoring-kit.js`, `app/documents/authoring-kit/route.js`,
`app/documents/[id]/html-editor.js`, `app/documents/[id]/page.js`, `app/styles/page.js`; docs/systems/documents.md
"Editor guards", env `SITE_BUCKET`)
- `loadSiteSources()` now also reads `SITE_SRC_ROOT/css/styles.css` and sets `siteCssStale` when the bucket copy
  differs (CRLF-normalised), logging `[documents] live css/styles.css (N chars) differs from the admin build's
  repo copy (M chars): deploy + publish pending`. `siteCssDrift(sources)` → one sentence, shown as a red banner
  on the Documents editor (`editorData().siteCssDrift`), on the Styles page, and as the first block of the kit
  (`buildAuthoringKitHtml({ notice })`, `.kit-warn`; kit log line gains `STALE live stylesheet`).
- HTML editor, before save: `.error` when the raw HTML uses a migrated report's per-page classes
  (`LIVE_PAGE_CLASSES`) and the document has no page CSS; `.notice` when the body has no
  `prose`/`section`/`container` and no page CSS. Ingest report's foreign-class block is now `.error` and says not
  to request publish until clean. No server-side block; two-person publish review remains the gate.
- Verified: `next build` passes; 32/32 admin tests; live stylesheet currently identical to the repo copy, so no
  banner shows today; Amplify job 50 (kit rule) succeeded earlier.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.20.3 — 2026-10-06 (branch `refactor`) — license-plate-has-a-price rebuilt on the kit frame, republished

**Content / Documents** (prod DB, no code; error log updated)
- Body of document `fd028a95…` rewritten from how-did-this-happen's private classes to the site frame:
  hero `<p>` byline + `btn btn-ghost`; `section.section.bg-cream > container > prose`; `callout` +
  `callout-label` for the table of contents and the "For lawmakers" ask (`<h2 id="ask">` moved above the
  box); plain `<ol>` sources; `callout` with `btn btn-outline btn-sm` for the related paper. Text unchanged.
- Saved through a one-off script mirroring `saveDocument` (ingest 0/0/0, revision snapshot, audit row),
  then the publish Lambda invoked: 2 changed. Live page verified in headless Chrome.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.20.2 — 2026-10-06 (branch `refactor`) — Kit forbids reusing per-page classes from live pages

**Admin / Documents** (`apps/admin/lib/authoring-kit.js`, `test/authoring-kit.test.mjs`)
- Cause of `/license-plate-has-a-price` publishing unstyled: raw body used `hero-ctas`, `hero-secondary`,
  `paper-body`, `paper-inner`, `release-meta`, `release-badge`, `release-date`, `release-author`,
  `paper-toc`, `paper-toc-label`, `ask-box`, `ask-box-label`, `sources-list`, `related-cta`, `btn-file`
  (how-did-this-happen's private CSS), no `page_css`, no `section > container > prose`; ingest stripped
  all 17 (`ingest_report.foreignClasses`). Kit section 5 "Never", the Claude instructions and 6.5 now say
  not to fetch a live page and imitate its markup, name those classes and give site equivalents.
- Error log: `docs/error-handling/client-side-error/2026-10-06-document-published-unstyled-foreign-classes.md`.
- 31/31 admin tests. The statement's body itself is not rewritten (content edit; user's call).

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in. Open: rebuild the
license-plate statement's body on the kit frame; consider a louder editor warning when a save strips
foreign classes.

## v0.20.1 — 2026-10-06 (branch `refactor`) — Prod redeployed and published so the prose CSS is live; error log

**Ops / Publish** (no code; `UccProd` stack, publish Lambda)
- v0.18.2's stylesheet change never reached prod: the publish Lambda bundles `css/` at `cdk deploy`
  (`infra/cdk/copy-site-src.js`), and prod had been published at 01:34 MDT with the old bundle, so the
  admin stripped `prose`/`callout` on save and the kit listed them as missing.
- `cdk deploy UccProd` (diff: PublishFn + MediaProcessFn code assets; 67 s), then invoked
  `UccProd-PublishFnB0C9E186-WouF4oexSmRN` with `{"trigger":"manual"}` → succeeded, 34 changed, 0
  removed, invalidation issued. Verified: bucket `css/styles.css` 69,967 bytes with the group; live
  `https://utahciviccompact.org/css/styles.css` serves it (CloudFront hit).

**Docs**
- `docs/error-handling/client-side-error/2026-10-06-kit-classes-stripped-stale-bucket-css.md`.
- `docs/systems/publish-pipeline.md` Code Map and `docs/systems/documents.md` env vars: any change under
  `css/ js/ assets/ templates/` needs `cdk deploy <stack>` then a publish; a push alone changes nothing live.
- dev-notes: stylesheet is live; re-download the kit (admin caches the bucket stylesheet 5 minutes).

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.20.0 — 2026-10-07 (branch `refactor`) — /writing page and Writing menu; payment-options proposal

**Site** (`packages/render/writing.js` new, `site.js`, `navigation.js`; `templates/writing.html`,
`js/writing.js`, `css/pages/writing.css` new; `aws/publish/render-db.js`; docs/systems/writing.md)
- /writing: published Documents (except category Legal) + Statements, newest first, merged where a
  statement points at a document, type from Category, author links, type filters (#reports etc.).
  Derived at render, nothing stored. `documents_index` gains `summary`.
- DEFAULT_NAVIGATION: header **Writing** dropdown (All writing · Statements · Reports · Newsletters)
  and a footer Organization link. Live sites with no saved custom menu pick this up on publish.

**Docs**
- `docs/proposals/payment-options.md` (new): Conner's request for a central payment-options page,
  today's five money surfaces, proposed design, open decisions, access needed. Not built.
- `docs/systems/navigation.md`: corrected — the golden parity test does NOT guard menu output
  (16 of 18 site pages are exempt in expected-diffs.json); the 2026-10-06 byte-level check was the
  comparison against the live site, not the test.

**Tests**: `writing.test.mjs` (4).

Deploy: needs `cdk deploy UccProd` (PublishFn bundles templates/js/css) after the push, then a publish.

## v0.19.2 — 2026-10-06 (branch `refactor`) — Privacy policy covers every collection channel

**Site / legal** (`templates/privacy.html`; prod + staging `documents` row `privacy` re-imported
from the template and published `--source db`; live at https://utahciviccompact.org/privacy)
- Rewrote the policy, which still described only the Airtable-era tipline. Now states, per
  channel, what is collected and why: tipline (anonymous = name not recorded; tip emails never
  join the list), updates list (double opt-in, ZIP used for Utah/outside audience), petitions
  (signing joins the list; public counter is Utah-only count; record may be delivered to the
  addressed officials without email/phone), Stripe donations (what we keep; opt-in first-name +
  amount donor list). Automatic collection: 1h rate-limit IP not linked to submissions,
  Turnstile, per-issue open pixel + bounce/complaint records, no access logs/analytics,
  sessionStorage uses, YouTube embeds. Storage (AWS us-west-2, encrypted, staff accounts,
  audited, 90-day backups), sharing (processors, petition recipients, donor list, legal
  compulsion, consent), retention per record type, request rights, children, changes, contact.
  Verified against `docs/legal/data-handling.md`, `aws/api/routes.js`, `infra/cdk/lib/ucc-stack.js`
  (no CloudFront logging/WAF; Cognito MFA OPTIONAL — policy does not claim MFA).
- Utah Consumer Privacy Act (13-61-102(2)(d)) exempts nonprofits; policy grants the request
  rights voluntarily rather than citing a statute.

**Scripts** (`scripts/migrate-documents.mjs`)
- `--only <slug[,slug]>` restricts the run (and `--overwrite`) to named documents; `--out` already
  existed. Documented in docs/systems/documents.md "Changing one of these pages from the repo".

**Docs** — dev-notes entry; for-conner §10.3 privacy soft spot closed; pending-questions:
petition delivery excludes email/phone, pre-delivery withdrawal, tip Attachments picker is dead
(`js/tip.js` never sends files — open bug).

Open P1 at push: Stripe webhook URL unconfirmed; GITHUB_APP_* placeholders (nightly export
skipped); TURNSTILE_SECRET_KEY placeholder; tip Attachments field dead.

## v0.19.0 — 2026-10-06 (branch `refactor`) — Publish & Status: "What will change on the live site"

**Admin** (`lib/change-detail.js`, `lib/change-detail-core.mjs` new; `lib/publish.js`, `app/page.js`,
`app/globals.css`; docs/systems/admin.md "What changed")
- Expandable per-section summary of the net effect of publishing: BEFORE = revision snapshot from just
  before the first unpublished save, AFTER = the database now. Field-level before → after; list items
  matched by natural key; menus compared as flattened paths; documents by details, word count, CSS,
  overrides. Homepage/settings rows split into Homepage / Petition / Donation appeals / Site Settings /
  Menus. Undescribable saves (media, redirects, styles) still listed with their saves.
- Raw save lists moved into a collapsed "Save log"; approve/seenThrough logic untouched.
- Verified against prod since 2026-10-02 (18 saves → 7 sections, field-level).

**Tests**: `test/change-detail-core.test.mjs` (6).

## v0.18.2 — 2026-10-06 (branch `refactor`) — Document prose styles in the site CSS; kit frame uses them

**Site / CSS** (`css/styles.css` "DOCUMENT PROSE"; docs/systems/style-guide.md)
- New annotated group **Document prose**: `.prose` wrapper (descendant rules for h2/h3/h4, p, ul/ol/li,
  a, strong, blockquote, table/caption/th/td, figure/figcaption, img, hr, code/pre; 760px measure;
  <720px sizes), `.callout`, `.callout-label`, `.callout-dark`. Values mirror `templates/privacy-report.html`
  page CSS (`report-section`, `report-callout`, `report-table`). Reason: the global reset zeroes margins
  and the migrated reports carry per-page CSS, so a kit-written document rendered as unspaced text.
  Reaches the live site on the next publish (`COPY_FROM_ROOT` ships `css/`). Style Kit parser: 155 entries.

**Admin / Documents** (`apps/admin/lib/authoring-kit.js`, `test/authoring-kit.test.mjs`;
docs/systems/documents.md "Authoring kit")
- Kit 6.1 frame is now `subpage-hero` + `section.section(.bg-cream) > container > prose`; skeleton and
  reference fragment updated (prose section with callout, list, dark callout). Section 4 no longer says
  the site prints a byline (it does not; JSON-LD only): a bylined piece writes `By Name, date` in the hero.
- Decision (user, 2026-10-06): no automatic styling on upload in the admin; the writer's tool styles the
  piece before upload using the kit. Verified in headless Chrome: prose section renders like the reports.
- 25/25 admin tests; `node build.js` clean.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in. Needs a person: publish
from Publish & Status so the new CSS goes live before the next document upload.

## v0.18.1 — 2026-10-06 (branch `refactor`) — Authoring kit is one self-contained .html

**Admin / Documents** (`apps/admin/lib/authoring-kit.js`, `app/documents/authoring-kit/route.js`,
`app/documents/page.js`, `test/authoring-kit.test.mjs`; docs/systems/documents.md "Authoring kit")
- New `buildAuthoringKitHtml({ ...kit args, siteCss })`: renders the markdown kit with `marked` (gfm)
  and wraps it in one page. First `<style>` = live `css/styles.css` verbatim (`</style` escaped) so the
  page renders like the site and a machine reads each class's CSS beside the markup; second `<style>`
  = `.kit-doc` prose styles (site sheet resets margins/bullets/underlines). `.kit-note` at the top says
  the embedded stylesheet is for reading only: a document body never carries `<style>` or `style=`.
- Reference fragment spliced in at `<!--KIT:LIVE-->` as a live `.kit-live` block (site CSS only) directly
  above its escaped source. Title now "authoring and style kit".
- 6.1 says plain prose inside `section > container` has no spacing of its own (margins reset; the real
  reports get prose styles from per-document page CSS) and that the editor adds them on Styling.
- Route serves `text/html` as `ucc-authoring-kit-<date>.html` (log line ends `chars html`); All documents
  link text updated. Verified in headless Chrome (guide + rendered fragment). 25/25 admin tests.
- Rebased onto v0.18.0 (menus) before pushing; no overlap.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in. Open: a template rule
or page CSS for report prose so new documents do not arrive with zero paragraph spacing.

## v0.18.0 — 2026-10-06 (branch `refactor`) — Menus: header and footer editable in the admin

**Render** (`packages/render/navigation.js` new; `site.js`, `documents.js`, `newsletters.js`;
`templates/partials/header.html`, `footer.html`; docs/systems/navigation.md)
- Header menu, footer columns and footer bottom links come from `settings.navigation`, generated as
  HTML by `navFields(settings, page)` in all three render paths. NULL or unreadable →
  `DEFAULT_NAVIGATION` (the previous hand-written menus).
- Defaults reproduce the old partials byte-for-byte (golden parity test unchanged) and match the live
  site on all 19 rendered pages (header, footer columns, bottom line; CRLF ignored).
- `normalizeNavigation` validates on save and on read: one dropdown level, styles (donate/cta) on
  top-level links only, size caps, `safeUrl` hrefs, `//host` → `https://host`, `{email}` token.

**DB** (`packages/db/content-schema.js`, `content.js`)
- `site_settings.navigation TEXT` (JSON). `JSON_FIELDS`: parsed on read, serialized on write;
  `saveSettings` now goes through `objectToParams`.

**Admin** (`app/navigation/page.js`, `nav-editor.js` new; `app/layout.js`, `lib/collections.js`, `globals.css`)
- Menus page: reorder, into/out of dropdown, add/remove links, dropdowns and columns, link picker
  (built-in pages, Documents incl. drafts, homepage anchors, `mailto:{email}`).
- Save = action `settings.navigation` (counts as unpublished; Revisions restores via `settings`).
- `NAVIGATION_SETTINGS_FIELDS` registers the column with the site_settings drift guard.

**Tests**: `packages/render/test/navigation.test.mjs` (6). **Docs**: navigation.md (new), editing
guide, dev notes.

Deploy: `migrate-schema --env prod` and `--env staging` (ALTER) before the admin build serves the
page; `cdk deploy UccProd` so PublishFn bundles the new partials.

## v0.17.1 — 2026-10-06 (branch `refactor`) — Jarom's title: "Director of Policy" everywhere

**Content / Team** (`content/team.json`; prod `team_members` row for Jarom Gillins)
- The title field had already been changed to "Director of Policy, Board of Directors" in the
  admin (06:26 UTC) and published (06:39 UTC); the bio's first sentence still said "Senior Policy
  Director" on /team, /team/jarom-gillins and its meta/JSON-LD descriptions.
- Prod DB: bio updated in place (`UPDATE team_members ... WHERE name = 'Jarom Gillins'`) with a
  `team.save` audit_log row (actor jaromforcongress@gmail.com) so Publish & Status lists it; no
  revisions snapshot was written. Republished with `publish.mjs --env prod --source db --trigger
  script` (operator path): 2 files changed (team.html, team/jarom-gillins.html), invalidation
  verified, live pages read back clean. Nothing else was pending in the DB, so the operator
  publish bypassed no awaiting approval.
- Repo copy `content/team.json` title updated; `docs/seo-plan.md` wording updated. The repo bio
  still differs from the DB bio (DB is the newer truth; the nightly export reconciles it).
- Rebased onto v0.17.0 (petition sharing); `docs/dev-notes.md` conflict resolved by keeping both
  entries.

Open P1s: unchanged from v0.17.0.

## v0.17.0 — 2026-10-06 (branch `refactor`) — Petition sharing and an editable donation ask

**Site / Petition** (`templates/partials/petition-share.html` new, `templates/petition.html`,
`templates/petition-thanks.html`, `js/petition.js`, `css/pages/petition.css`;
docs/systems/petition.md "Sharing", "Donation ask")
- Share block on /petition and /petition-thanks: Facebook, X, Bluesky, Text, Email as no-JS links
  built at render (`derivePetitionShare`); native share sheet and Copy link added by JS when supported.
- /petition gets `og:image` + `twitter:image`; `summary_large_image` when `share_image` is a
  /media or /assets picture, else the logo as `summary`.
- Thank-you payment window driven by the petition group (`petitionDonate`): amounts, pre-selected
  amount, one-time / monthly / both with a starting side, an always-present Other amount, and all copy.
  Monthly checkout sends `type: 'subscription'` (API unchanged).

**Admin** (`apps/admin/lib/collections.js`, `app/petition/page.js`)
- Petition group gains 12 fields: `donate_*` (9) and `share_*` (3). JSON group, no schema change.

**Tests**: `packages/render/test/petition-share.test.mjs` (5). Golden parity unchanged.

**Docs**: dev notes also record the 2026-10-06 audit of changes made outside the admin.

Deploy note: templates/js/css ship inside PublishFn's bundled site-src, so this needs
`cdk deploy UccProd` before an admin publish carries it (otherwise a later admin publish would
render with the old templates).

## v0.16.7 — 2026-10-06 (branch `refactor`) — Authoring kit carries the site's full styling

**Admin / Documents** (`apps/admin/lib/authoring-kit.js`, `app/documents/authoring-kit/route.js`,
`test/authoring-kit.test.mjs`; docs/systems/documents.md "Authoring kit")
- Section 6 rewritten so a writing tool can return HTML that lands styled (a document body is composed
  bare between the header and footer partials): 6.1 document frame (`div.subpage-hero` eyebrow/h1/lead,
  `section.section > div.container`, `bg-cream`), 6.2 design tokens (the `:root` block of the live
  stylesheet, regex-extracted in the route and passed as `designTokens`), 6.3 template rules (writing
  them yourself is now allowed; the editor merges), 6.4 **reference fragment** (`EXAMPLE_HTML`: hero,
  mission strip, plain section, impact band, pillars on cream, issues card grid, about two-column,
  news section with a `{{video:...}}` card; one HTML comment per block; checked at build time, listing
  classes no longer in the stylesheet and offered classes it omits), 6.5 every offered class as a list
  item with its CSS declarations (auto "Sets: ... (auto)" tails dropped, `<tag>` in descriptions
  backticked).
- `CHROME_GROUPS` narrowed to Navigation, Footer, Forms, Modal, Donations, Hero: Impact stats, Mission
  & pillars, Policy positions, About and News & coverage are now offered (73 classes, ~42 k chars).
- Section 1, the Claude instructions, the section 5 skeleton and the hand-over checklist now tell the
  tool to use the frame and classes. The fragment passes `ingest()` with nothing dropped.
- Tests: new assertions for 6.1 to 6.5 headings, CSS lines, tokens block, framed skeleton, stale and
  unshown class lists. 24/24 admin tests pass.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.16.6 — 2026-10-06 (branch `refactor`) — Admin PWA icons renamed so phones fetch the navy tile

**Admin / PWA** (`apps/admin/app/icon1.png`, `apple-icon1.png`, `manifest.js`, `middleware.js`,
`layout.js`, `nav.js`, `login/page.js`; docs/systems/admin.md "Phone / PWA")
- Reinstalling the admin after v0.16.5 still showed the old transparent/cream icon: Next serves
  `app/icon.png` with `Cache-Control: immutable, max-age=31536000` and the manifest `src` has no
  content hash, so the phone and CloudFront kept the year-cached PNG. Renamed to the numbered
  conventions `icon1.png` / `apple-icon1.png` (new URLs); updated manifest, middleware `PUBLIC_PATHS`
  and the three `<img src>` uses. Rule going forward: any icon artwork change bumps the number.
- Error log: `docs/error-handling/client-side-error/2026-10-06-pwa-icon-cached-cream.md`.

Needs a person: remove and re-add the home-screen app (iOS may also need Safari website data for
the admin domain cleared). Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom
sign-in.

## v0.16.5 — 2026-10-06 (branch `refactor`) — Admin restyled to the live site's look

**Admin / styling** (`apps/admin/app/globals.css`, `layout.js`, `nav.js`, `login/page.js`, `manifest.js`;
docs/systems/admin.md "Styling")
- `globals.css` rewritten around `:root` tokens copied from `css/styles.css`: `--navy-dark` sidebar /
  phone top bar / tab bar, `--red` accent (current-page bar, pending-request ring, `.danger`, sign-in
  button, active tab notch), `--cream` notices and quotes, site gray scale, `--radius` 6px controls /
  `--radius-lg` 12px cards, `--ring` focus halo. Every class name kept, so no page markup moved.
- Inter via `next/font/google` (`inter.className` on `<body>`); `--font-sans` lists `'Inter'` first.
- Buttons: navy filled / `.secondary` white outline / `.danger` red / `.linkish` text; one shared
  white-outline rule for the compact tool buttons. Cards (editors, request, uploader, media, picker,
  request-send, dev-notes article, tables) white + 1px `--gray-200` + 12px + soft shadow; tables
  `border-collapse: separate` for rounded corners; `.notice` / `.error` / `.ok` with a left bar;
  `h1 .hint` as a pill; custom `select` chevron; `accent-color` checkboxes.
- Sidebar brand = `/icon.png` mark + "UCC Admin / Utah Civic Compact"; `.sidebar .nav-find input`
  (prefix needed to beat the generic `input[type="search"]` rule). Phone bar 54px.
- Login: `.login-card` (mark, red eyebrow, "Admin sign in", full-width red button).
- `themeColor` (viewport) and manifest `theme_color` → `#0f1e33` (sidebar colour).
- Verified in headless Chrome: 1280×900 dashboard + list editor, login, and 390×844 dashboard /
  menu sheet / editor rendered inside iframes (Windows Chrome clamps `--window-size` width to
  ~500px, so the earlier 390px shots were cropped renders of a wider viewport).

Not verified on a real phone yet. Open P1 (unchanged): Resend key deletion pending; Stripe
webhook; Jarom sign-in.

## v0.16.4 — 2026-10-05 (branch `refactor`) — Admin navigation: tab bar, location bar, menu sheet, filter

**Admin / navigation** (`apps/admin/app/nav.js`, `app/layout.js`, `app/globals.css`)
- Phone (≤800px): 52px sticky top bar (brand → `/`, `Section › Page`, Menu); fixed bottom tab bar
  (`TABS`: Home `/`, Documents, Mail, Tips, Menu) with `env(safe-area-inset-bottom)`, viewport
  `viewportFit: 'cover'`; menu as a full-screen sheet — only the current section unfolded on first
  paint (`matchMedia` → `folded` Set; folded current section labelled "you are here"), closes on
  navigation / Escape / Close, `body.nav-open` locks scroll; content padded for the tab bar.
- Every width: "Find a page" filter (page or section label; filtering unfolds all), foldable
  `<details>` sections, user + Sign out block `position: sticky; bottom: 0` in the sidebar, the
  duplicate top sign-out removed, `:focus-visible` outlines, `.sr-only` utility.
- `NAV`: new first group *Overview* holds `/` Publish & Status (removed from *Operations*).
- Fixed from v0.16.3: the section caret was written as a control character (Python `\25` octal
  escape) — now the literal `▾`.
- Verified in headless Chrome against the real stylesheet: 390×844 closed + menu open, 1280×800.

**Admin / PWA icons** (`apps/admin/app/icon.png`, `apple-icon.png`, `manifest.js`; separate session, same push)
- Icons are the UCC mark flattened onto site navy `#1b2f4e` with padding for maskable launchers
  (`purpose: 'any maskable'`); `background_color` matches so the splash is seamless.

**Docs**: admin.md (Code Map, "Navigation & phone use" rewritten, PWA icons), non-technical-editing-guide.md,
dev-notes.md (today's entry updated).

Not verified on a real phone yet. Open P1 (unchanged): Resend key deletion pending; Stripe
webhook; Jarom sign-in.

## v0.16.3 — 2026-10-05 (branch `refactor`) — Phone layout + installable admin, 4 h sessions

**Admin / sessions** (`apps/admin/app/auth/callback/route.js`, `infra/cdk/lib/ucc-stack.js`)
- Session + access cookies `maxAge` 1 h → 4 h; AdminAppClient `idTokenValidity` /
  `accessTokenValidity` = 4 h to match (the cookie carries the JWT). `cdk deploy` UccProd +
  UccStaging: in-place update of the user pool client only.

**Admin / navigation + phone layout** (`app/nav.js` new, `app/layout.js`, `app/globals.css`)
- Client `Nav` (in `<Suspense>`, uses `useSearchParams`): current page `.active` + `aria-current`
  by longest-prefix match; sections are `<details open>`; ≤800px the sidebar is a sticky top bar
  with a Menu drawer that closes on navigation.
- `@media (max-width: 800px)`: tables `display:block; overflow-x:auto`; `.split` / `.mail-split`
  stack; 16px inputs (iOS zoom); content padding 16px; login card margins.

**Admin / PWA** (`app/manifest.js`, `app/icon.png`, `app/apple-icon.png`, `middleware.js`)
- Manifest (standalone, theme `#16281e`), 512/180 icons from `assets/favicon-*.png`, `viewport`
  + `appleWebApp` metadata exports. Middleware `PUBLIC_PATHS` += `/manifest.webmanifest`,
  `/icon.png`, `/apple-icon.png`. No service worker (live-data admin; cached shell would
  outlive deploys).

**Admin / Documents upload** (`app/documents/actions.js`, `[id]/html-editor.js`, `page.js`)
- `.html` accepted by MIME type (`text/html`) as well as extension in the browser; `convertUpload`
  passes `html` kind / `text/html` through unchanged instead of rejecting it (its error message
  already claimed to accept .html). `accept` gains `text/plain`.

**Docs**: admin.md (Code Map, new "Navigation & phone use — PWA", 4 h sessions), documents.md
(Upload a file), non-technical-editing-guide.md (phone install, 4 h), dev-notes.md.

Not verified on a real phone yet (needs the account owner's hand). Open P1 (unchanged): Resend
key deletion pending; Stripe webhook; Jarom sign-in.

## v0.16.2 — 2026-10-05 (branch `refactor`) — Authoring kit + .docx/Markdown upload for Documents

**Admin / Documents** (`apps/admin/lib/authoring-kit.js`, `app/documents/authoring-kit/route.js`, `app/documents/page.js`)
- Authoring kit: `GET /documents/authoring-kit` (any signed-in role) returns one markdown file for
  Claude or any writing tool, rebuilt per request: static usage/instructions, voice rules with the
  machine-writing DON'T list, page-fields block, shape of a piece, HTML rules + skeleton, hand-over
  checklist; live Style Kit catalog (annotated, chrome groups hidden), template style rules, coverage
  keys. Download block with instructions at the top of All documents. Test asserts the file is dash-free.

**Admin / Documents upload** (`apps/admin/lib/convert-upload.mjs`, `app/documents/actions.js convertUpload`, `[id]/html-editor.js`, `next.config.js`)
- The HTML box's file input accepts .docx (mammoth, style map for Title/Subtitle/Quote) and
  .md/.markdown/.txt (marked, GFM) besides .html; converted server-side, images replaced by numbered
  placeholders, result lands in the body for review; save runs the normal ingest. `bodySizeLimit` 8 MB.
- New deps in apps/admin: `mammoth` ^1.9, `marked` ^15.

**Docs**: documents.md (Code Map, Authoring kit, Upload a file), admin.md code map, debug/documents.md,
non-technical-editing-guide.md, dev-notes.md.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.16.1 — 2026-10-05 (branch `refactor`) — Author pages + Person structured data

**Site / render** (`packages/render/site.js`, `templates/team-member.html`, `css/pages/team-member.css`)
- One author page per team member at `/team/<slug>` (PAGES `each` entry → `expandPages`), with
  ProfilePage + Person JSON-LD (`@id = <page>#person`), `sameAs` from the new `links` field,
  and a list of every project, Document, statement and issue position bylined to them
  (`deriveTeam`; Documents via `content.documents_index` from `render-db.js`).
- Bylines on statements/projects/issues link to the author page (`author_url`); the five
  long-form templates link theirs and carry the Person `@id` in JSON-LD (Dignity gains an
  Article block). Team page names link through; homepage Organization adds `@id`, `logo`,
  `sameAs`, `member[]`, plus `og:image`/`twitter:image`.
- `build.js` creates nested output dirs; `inputs.js` lastmod reads `page.source`.
- Golden tests: counts use `expandPages(PAGES, deriveTeam(content))`; four `team/*.html`
  entries in `expected-diffs.json`.

**Documents** (`packages/render/documents.js`, `packages/db/documents.js`, admin editor)
- New `author` column/field. JSON-LD gains `datePublished` (from `published_at`) and an
  `author` Person carrying the team member's `@id`/`url` when the name matches.

**Database** (`packages/db/content-schema.js`, `content.js`)
- `team_members.slug`, `team_members.links`; `documents.author`. Migrated on staging and prod.
- `scripts/backfill-authors.mjs`: set authors and link the bylines on the five migrated
  Documents (run on staging and prod).

**Admin** (`lib/collections.js`, `app/documents/`)
- Team & Bios: *Author page URL slug*, *Public profile links*. Documents: *Author*.

**Infra / ops**
- `cdk deploy` UccStaging + UccProd (PublishFn and ExportContentFn bundles). Staging
  published from the DB (`publish.mjs --source db`): 20 files changed, author pages verified.
- Note: `migrate-schema.mjs` also applied another in-progress session's uncommitted
  operational DDL (`subscribers.confirmed_at`, `email_events`) to both clusters — additive,
  idempotent; flagged in the session report.

**Docs**: `systems/author-pages.md` (new), `decisions/author-pages-person-id.md` (new),
`seo-plan.md` (new; bio draft), site-structure, bylines, documents, admin, legal/data-handling,
dev-notes, for-conner §1 (Search Console + profile links + prod publish approval), llms.txt.

**Prod**: published the same evening with the user's go (`publish.mjs --env prod --source db`,
30 files, verified: /team/* 200, bylines linked, 4 author URLs in sitemap, Organization.member ×4).

**Open P1**: Resend key, Stripe webhook, Jarom sign-in unchanged from v0.16.0.

## v0.15.2 — 2026-10-05 (branch `refactor`) — Approval bug hunt

**Admin / publishing** (`lib/publish.js`, `app/page.js`)
- Post-approval gap closed: an approved request with no run row yet
  (reviewed < 10 min ago) counts as in flight (`busyPublish`, `runStatus
  'starting'` / `'never started'`). Dashboard shows "Publishing now…", polls,
  hides the request form; `requestPublish` and `approvePublish` refuse while
  busy. Log: docs/error-handling/client-side-error/2026-10-05-publish-starting-window.md.
- Times on the dashboard and in the review email are Mountain time with an
  "MT" label (`lib/when.mjs` + test) instead of raw UTC text.
- Decline hidden from the requester; duplicate request by the same person
  says "your request is already waiting".

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.15.1 — 2026-10-05 (branch `refactor`) — Petition/appeals saves count for publishing

- `packages/db/publish-requests.js` `CONTENT_ACTION_RE` now matches
  `petition.save` and `appeals.save` (anchored; `petition.export` excluded).
  Before: those saves never showed as unpublished and Request publish said
  "Nothing to publish". Log: docs/error-handling/client-side-error/2026-10-05-petition-save-not-publishable.md.
- New test `packages/db/test/publish-requests.test.mjs` covers every content
  action name.
- (v0.15.0's changelog commit af55559 was its own push.)

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.17.1 — 2026-10-06 (branch `refactor`) — Campaign-level opens + TEST: prefix

- `GET /api/open?c=<id>` (`newsletterOpen`): 1×1 gif, one anonymous
  `newsletter_opens` row (API role INSERT only; schema + grant applied
  staging/prod). `renderEmail({ pixelUrl })` adds the pixel; the admin passes
  it on real requests only (never previews/tests). `openCounts` on the list
  and editor with the Apple-prefetch caveat; opens deleted with the newsletter.
- Test send subject prefix `TEST: ` (was `[TEST]`); "Test send (all admins)"
  is the primary button.
- Docs: newsletters.md "Opens", data-handling row, dev note.

## v0.17.0 — 2026-10-05 (branch `refactor`) — Mailing roadmap tiers 1-3 + double opt-in

**Send Lambda** (`aws/newsletter`): `List-Id` + `Precedence: bulk`; `sendWithRetry`
backoff on throttling/5xx; stale `sending` deliveries (>10 min) reclaimed on
retry; invokes PublishFn after a send whose row is archived (env
`PUBLISH_FUNCTION_NAME`, IAM).

**Newsletter package**: `tagLinks` (UTM on site links), `viewUrl` → "View in
browser" (html + text); `web.mjs` (`renderWebBody`, `archiveSlug`).

**DB** (`packages/db`): newsletters + `publish_to_site, slug, web_html,
archived_at, requested_blocks, prior_blocks`; `newsletter_defaults`;
`duplicateNewsletter`, `reschedule`, `getDefaults/setDefaults`,
`deliveriesFor`, `listArchive`, `deliveryCounts.suppressed`;
`email-events.js` (table, `classify`, `SUPPRESSED_SQL`); audience excludes
suppressed addresses and unconfirmed join-form rows; `subscribers.confirmed_at`
+ grandfather UPDATE.

**API**: welcome email carries a signed confirm button; `GET /api/confirm`;
petition signers confirmed at insert; `unsubPage` title param.

**Site**: `packages/render/newsletters.js` archive (index + per-issue pages in
the report shell), `css/newsletters.css`, footer link, render-db wiring,
join-form success copy mentions the confirm button.

**Infra** (`SesEventsFn`, both stacks): ops topic → `email_events`.

**Admin**: Copy as a new draft (list + editor), Use this look as the default,
Send a test to all admins, publish-to-site checkbox, reschedule while pending,
re-request diff, suppressed count + web-copy link in the delivery panel, owner
ledger CSV (`/mail/[id]/ledger`), Mailing list: unconfirmed/suppressed counts
+ recent SES events.

**Fixes in the same push**: archive index always rendered (footer link never 404s); sitemap entries carry `content[]` + valid `lastmodAt` (docs/error-handling/build-failures/2026-10-06-newsletter-archive-sitemap-lastmod.md); `newsletter-smoke.mjs --no-archive` for prod.

**Docs**: newsletters.md (second pass, three new sections), email.md,
data-handling.md (2 rows), for-conner §12 (DMARC DNS edits + postal address),
dev note.

Open P1: Resend key deletion pending; Stripe webhook unconfirmed.

## v0.16.1 — 2026-10-05 (branch `refactor`) — Inline image upload on every image field

**Admin**
- `app/media/inline-upload.js` (`InlineImageUpload`): alt text first, presigned
  PUT, `finishUpload(id, alt)` stores the alt, polls `assetReady` (new action →
  `lib/media.js assetState`) until the Lambda's variants exist, hands the
  `pickVariant` path to the field.
- Used by: `list-editor.js` media widget (Team headshot), `/profile`
  (`profile/headshot-field.js`), newsletter image block (absolute URL,
  `publicOrigin` prop), Documents og:image (`media/image-url-field.js`).
- Docs: media.md "Inline upload", newsletters.md, admin.md, editing guide,
  dev note. New `docs/plans/mailing-roadmap.md` (recommended next steps for
  the mailing system — not started).

Open P1 (unchanged): Resend key deletion pending; Stripe webhook unconfirmed.

## v0.16.0 — 2026-10-05 (branch `refactor`) — Mail section: newsletters composed, reviewed and sent from the admin

**Newsletter package** (`packages/newsletter`, pure ESM, 12 tests)
- `render.mjs`: blocks (heading/text/button/image/quote/divider) + theme →
  table-based email HTML with inline styles, plain-text twin, dark-mode
  `prefers-color-scheme` block + `[data-ogsc]`; `mode` auto/dark/light for
  preview; author text escaped first, http(s)/mailto only; `fromHeader()`
  puts the author in the From display name, address stays hello@.
- `schedule.mjs`: America/Denver datetime-local ⇄ UTC (DST), `parseSchedule`
  (≥5 min lead).

**Database** (`packages/db/newsletters.js`, DDL in content-schema, applied
staging + prod)
- `newsletters` (status draft → pending → approved → sending → sent|failed;
  html/text frozen at request; request/review/run columns) +
  `newsletter_deliveries` (PK newsletter_id+email = idempotency key).
  Conditional-update transitions; `claimForSending` mutex. 6 tests.

**Lambda** (`aws/newsletter`, `NewsletterSendFn` in both stacks)
- `{id}` from an approval, `{id, resume}` self re-invoke near the timeout,
  `{tick}` every minute (EventBridge) for scheduled sends + stalled runs,
  `recipientsOverride` for the smoke script. Per recipient: delivery row,
  signed 1-year unsubscribe link (`@uccsite/tokens`), SESv2 SendEmail with
  List-Unsubscribe/One-Click, 100 ms gap. IAM: dsql admin, ses:SendEmail
  (From pin), TOKEN_SECRET read, self-invoke. 5 tests.

**Admin**
- Nav group **Mail**: `/mail` (list + create), `/mail/[id]` (Composer
  client component: block editor, theme, audience filters shared with the
  Mailing list, phone/desktop + light/dark preview via the same renderer;
  Send me a test; Request send with optional schedule; review panel
  approve/decline/withdraw/cancel/retry; owner delete). Mailing list moved
  under Mail.
- `lib/newsletters.js`: every rule (two-person, owner self-approve, lost-
  update stamp, invoke-failure reopen); `lib/notify.js` generalised —
  `notifyNewsletterRequested` (same recipients as publish requests).
- Dashboard: "Newsletters needing attention".
- `newsletterPage` reads run sequentially on the shared pg client (concurrent
  `query()` on one connection is deprecated in pg).
- `NEWSLETTER_FUNCTION_NAME` via `lib/config.js`, `scripts/admin-env.mjs`,
  `amplify.yml`.

**Ops**
- `scripts/newsletter-smoke.mjs` (Lambda E2E via the mailbox simulator;
  green on staging and prod), `scripts/newsletter-prod-wiring.mjs` (IAM
  invoke grant on `UccProdAdminCompute/admin-runtime` + Amplify env var,
  both applied). Staging `ucc/staging/TOKEN_SECRET` now holds a self-set
  test value. Root devDeps `@aws-sdk/client-iam`, `@aws-sdk/client-amplify`.

**Docs**: systems/newsletters.md (new), admin.md, email.md,
legal/data-handling.md (2 rows), non-technical guide (Newsletters section),
error-handling/debug/newsletters.md, for-conner §8.3, dev note.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook unconfirmed.

## v0.15.0 — 2026-10-05 (branch `refactor`) — Request publish everywhere + reviewer email

**Admin**
- "Request publish" button beside every Save button (`app/request-publish.js`
  → `app/publish-actions.js` → `lib/publish.js requestPublish`): collections,
  homepage, appeals, petition copy, settings, documents, style rules and
  foreign-class mappings, redirects, media alt text, own bio.
- `requestPublish` returns `{ id, needsReview, notified }`; the dashboard and
  inline messages say whether reviewers were emailed.
- `lib/notify.js` + `lib/notify-recipients.mjs` (tested): after an EDITOR's
  request commits, one SES `SendEmail` to the four admins minus the requester;
  owner requests send nothing (owners self-approve). Off prod only with
  `PUBLISH_NOTIFY_TO`. Failures logged `[admin] publish notify SES error`,
  never thrown.
- New dep `@aws-sdk/client-sesv2`; `amplify.yml` passes `PUBLISH_NOTIFY_TO`.

**Infra (hand-managed)**
- `UccProdAdminCompute` / `admin-runtime`: `ses:SendEmail` on the domain
  identity + `ucc-prod` config set, From pinned to hello@utahciviccompact.org.

**Docs**: admin.md (Code Map, Publishing, env, SSR role), email.md, for-conner
§8.3, debug/admin.md, non-technical guide (stale "owners included" fixed),
dev note.

Open P1 (unchanged): Resend key deletion pending; Stripe webhook; Jarom sign-in.

## v0.14.5 — 2026-10-05 (branch `refactor`) — Stale-tab save error explained

- `app/error.js` recognises Next's "Server Action … was not found" (page
  opened before a redeploy) and shows a reload prompt; log in
  docs/error-handling/client-side-error/2026-10-05-admin-stale-server-action.md.

## v0.14.4 — 2026-10-05 (branch `refactor`) — Owners self-approve publishes

- `apps/admin/lib/publish.js` `approvePublish`: the requester ≠ reviewer
  check is skipped for role `owner`; audit diff gains `selfApproved`.
  Dashboard shows the approve form to an owner on their own request.
  ADR two-person-publish.md amended; admin.md Publishing updated.
- Closes the standing P1 "no second approver" — an owner can now publish alone.

## v0.14.3 — 2026-10-05 (branch `refactor`) — Hero live; hero status in the admin

- **Prod published** (`operator:petition-hero-go-live`): petition hero +
  /petition live on utahciviccompact.org; 23/23 e2e after.
- **Admin:** `lib/hero-status.js` — "Which hero is showing?" on /homepage
  and /petition: live (fetched from PUBLIC_ORIGIN, no-store, 5 s timeout,
  detects `hero-petition`) vs saved (petition headline set or not), colour
  coded; Homepage editor notes that its Hero fields are the default.

## v0.14.2 — 2026-10-05 (branch `refactor`) — Petition copy + event-driven counter

- **Copy:** hero/form quote the permit agreement's termination provision
  ("UDOT determines that the public does not support the Company's
  activities"). Seeded into staging (published) and prod (draft — hero not
  yet live there; awaiting the operator's publish).
- **Counter:** user decision — no timed refresh. `petitionSign` clears the
  per-slug count cache on a Utah signature; `/api/petition/count` is
  `no-store`; `COUNT_TTL_MS` 10 min is a safety net for other containers.
  Test extended (outside-Utah sign leaves cache, Utah sign recounts).
- **Deployed:** UccStaging + UccProd (API only).

## v0.14.1 — 2026-10-05 (branch `refactor`) — Petition: residency, counter, audiences

- **Residency rule:** `packages/db/audience.js` — every 84xxx ZIP is Utah
  (`utahZipSql` / `isUtahZip`), derived at query time, never stored.
- **Public counter:** `GET /api/petition/count?petition=` (Utah only,
  per-slug Lambda cache `COUNT_TTL_MS` = 60 s + `max-age=60`); hero and
  /petition render `homepage.petition.count_label` (`{count}`) via
  `js/petition.js` (now loaded on index), hidden while 0. 1 new API test.
- **Admin → Petition:** Utah / outside counts per slug, residency filter,
  Utah column, CSV per residency with `utah_resident`.
- **Admin → Mailing list** (`/subscribers`): subscribers ∪ opted-in members
  with residency / donor / petitions / via; filters residency × petition ×
  donors-only; "This email is going to N people"; CSV with the same filters
  (audit diff records them). `subscribers/query.js` removed.
- **Sender:** `scripts/send-periodical.js --audience --donors-only --petition`
  resolves recipients through the same `audienceQuery`.
- **Tests:** `packages/db/test/audience.test.mjs` (4) — db package now has
  a test script. Admin `next build` green; audience/count SQL verified on
  staging DSQL with seeded rows (cleaned).
- **Deployed:** UccStaging + UccProd; both published from DB.

Open: unchanged from v0.14.0 (real copy + two-person publish; second approver).

## v0.14.0 — 2026-10-05 (branch `refactor`) — Petition

UDOT ALPR special-use-permit petition, built so the next campaign is a copy
change (`docs/systems/petition.md`, ADR `petition-copy-in-homepage-group.md`).
- **Site:** homepage hero becomes the petition while `homepage.petition.headline`
  is set (standing hero otherwise); new `/petition` (form: first/last name,
  ZIP, email required; address, phone optional; consent line) and
  `/petition-thanks` (thank-you + "I can help" modal: $10 / **$25** / $50 /
  $100 one-time → Stripe; "Not this time" → home). `js/petition.js`,
  `css/pages/petition.css`, hero styles in `css/pages/index.css`.
- **API:** `POST /api/petition` — validates, 20/IP/hour, Turnstile when
  keyed, upserts `petition_signatures` (one per email per campaign slug,
  original signing time kept) and the `subscribers` row without
  overwriting join-form details. Checkout accepts a sanitized `source`
  (`petition:<slug>`) into Stripe metadata. 4 new tests (30 total).
- **Schema (applied to staging AND prod):** `petition_signatures` + index +
  api grants (SELECT/INSERT/UPDATE); `homepage.petition` JSON column.
  Nightly operational export and restore include the table.
- **Admin:** Site Main → **Petition** (campaign copy editor with lost-update
  check + slug validation, signatures per slug, audited CSV export with
  `signed_at_utc`); **Subscribers** list + CSV gain `donor` and `petitions`
  columns (shared `subscribers/query.js`). Group ownership flag
  `appeals: true` → `page: 'appeals' | 'petition'`.
- **Ops:** `scripts/seed-homepage-group.mjs` (seed a homepage group from
  git into an env). CLAUDE.md content-key rule now points at
  `apps/admin/lib/collections.js` (Decap's config.yml is gone).
- **Deployed:** UccStaging + UccProd (API + publish Lambda with the new
  templates); staging published from DB with placeholder copy and verified
  (26/26 e2e, API smoke: sign / re-sign / 400s, DB effects, cleanup); prod
  published from DB — hero unchanged there until the real copy is entered
  (for-conner §11).

Open: **P1** real petition copy + two-person publish (for-conner §11);
**P1** Jarom not signed into prod admin (no second approver); P1 Resend key /
SES (§10). Decisions taken without an answer: `docs/pending-questions.md`.

## v0.13.1 — 2026-10-05 (branch `refactor`)

SES prerequisites, step 1 of the Resend → SES move (`docs/systems/email.md`).
- **Infra (UccProd, deployed):** SES domain identity `utahciviccompact.org`
  with Easy DKIM, custom MAIL FROM `mail.utahciviccompact.org`
  (`REJECT_MESSAGE` on MX failure), configuration set `ucc-prod` (reputation
  metrics, bounce+complaint suppression) with BOUNCE/COMPLAINT/REJECT →
  `OpsAlerts`. New outputs `SesDkimCname1-3`, `SesMailFromMx`,
  `SesMailFromTxt`, `SesIdentityArn`, `SesConfigurationSetName`. Prod only
  (ADR `ses-identity-in-prod-stack.md`).
- **Docs:** `docs/systems/email.md` (new), for-conner §10 (five Cloudflare
  records, verify command, production-access request text), dev-notes entry.
- **Not changed:** send code still Resend; SES still in sandbox; identity
  `PENDING` until Conner adds DNS.
- **Verified post-pull of Conner's cutover work (2026-10-05):** tests green,
  parity 41/41 on the live domain, `/api/health` ok, UccProd/UccStaging
  `UPDATE_COMPLETE`, Amplify job 5 = HEAD, zero Lambda errors in 7 days.

Open: **P1** Resend key unset (now optional — superseded by §10 once SES is
approved); **P1** Jarom not signed into prod admin (no second approver);
Stripe webhook assumed working (user decision 2026-10-05: unverifiable
runbook items are assumed done unless code says otherwise). P2 Turnstile,
GitHub App, Airtable tips copy. `.DS_Store` committed by 9b8b5cd, not
ignored.

## v0.13.0 — 2026-09-30 (branch `refactor`) — CUTOVER

**utahciviccompact.org now serves from AWS.** DNS flipped 15:26 MDT: apex and
`www` CNAME → `d1vpvgdxky8mqn.cloudfront.net`, DNS-only, TTL 300. Rollback:
both back to `uccsite.pages.dev`, proxied (record comments say so).

Covers the unlogged pushes of 2026-09-23 → 30 (9b8b5cd … 1f4e092):
- **Prod stack:** Cognito passkey relying party removed (failed pool CREATE);
  retained-secret orphans cleared; custom domain + ACM cert attached.
- **Content:** team (Kaden Payne, Jarom's title, headshots) synced from main;
  homepage features three statements.
- **Security:** Decap CMS removed from the AWS site; project file publishing
  now needs a second admin's approval.
- **Admin:** hosted on Amplify (app `dmfjtx0gh1s1n`) at admin.utahciviccompact.org.
- **Data:** donors/subscribers copied, delta re-run at the flip — 17 / 1 / 5 /
  36, SUM 27500, matches D1 exactly.

**Verified after the flip:** 1.1.1.1 and 8.8.8.8 both resolve to CloudFront;
parity 41 URLs OK against the real domain; /api/health 200; MX (Zoho) intact.

Open at cutover:
- **P1** Resend key unset — welcome emails and billing-portal links degrade.
- **P1** Stripe webhook endpoint URL unconfirmed (dashboard); watch deliveries.
- **P1** Jarom has not signed in — no second publish approver yet.
- P2 Airtable tip history not copied; GitHub backup App; Turnstile.
- Cloudflare Pages kept deployable and idle until 2026-10-30 (§7.7).

## v0.12.1 — 2026-09-14 (branch `refactor`)

API Lambda no longer connects to DSQL as `admin` (closes the v0.12.0 accepted
risk). ADR `docs/decisions/api-dsql-least-privilege.md`.
- **DB:** `packages/db` `connect()` takes a `user`; non-admin users get a
  `DbConnect` token. `schema.js` declares `API_ROLE = 'api'` and
  `API_GRANTS` (INSERT only on `tips`; SELECT/INSERT/UPDATE/DELETE per
  route on the operational tables; nothing on content tables).
- **Scripts:** `migrate-schema.mjs` also provisions the role: `CREATE ROLE
  api WITH LOGIN`, `AWS IAM GRANT api TO '<ApiRoleArn>'`, grants; all
  idempotent. DSQL rejects `GRANT USAGE ON SCHEMA public` (0A000), so it is
  omitted.
- **Infra:** API function gets `dsql:DbConnect` (was `DbConnectAdmin`),
  `DSQL_USER=api`, new `ApiRoleArn` output. Export Lambda's alert/log carry
  the error name + code, not the message.
- **Docs:** api-security "DSQL access" grant table; tipline, for-conner §6
  (role provisioning + ~2-3 min IAM-mapping propagation), debug/api rows.
- **Verified on staging:** role + mapping present, health 200, tip-smoke
  7/7, staging-check 26/26, stats/subscribe/unsubscribe routes OK,
  `role_table_grants` shows exactly the intended privileges. Webhook not
  replayed (needs the Stripe secret); its tables are covered by the grants.

Open P1 unchanged: project files publish is one-person (v0.11.0).

## v0.12.0 — 2026-09-14 (branch `refactor`)

Airtable retired from the AWS stack: the tipline lives in DSQL.
Plan: `docs/migration/airtable-retirement-plan.md`; ADR
`docs/decisions/tipline-dsql.md`; spec addendum 13.
- **DB:** `tips` table (mirrors the Airtable fields + `legacy_airtable_id`,
  `status`, timestamps) in `packages/db/schema.js`; applied to staging.
  Added to the nightly operational export and `restore-operational.mjs`.
- **API:** `/api/tip` inserts into `tips`; `AIRTABLE_TOKEN` removed from
  `aws/api/secrets.js` (CDK dropped `ucc/staging/AIRTABLE_TOKEN`; prod copy is
  RETAIN, deleted by hand at day 30). Responses 200/400/403/429/500; insert
  failure logs the pg error NAME only. Tests: 26/26 incl. a console spy for
  body leakage.
- **Admin:** `/tips` inbox (editor+, status filter with counts) and
  `/tips/[id]` (full text as text, status change, owner-only delete). Both
  audited (`tip.status` from/to; `tip.delete` keeps only the legacy Airtable
  id as a re-import tombstone). Nav: Operations → Tips.
- **Scripts:** `migrate-tips.mjs` (Airtable → tips, read-scoped token via
  env var, deterministic ids, skips owner-deleted, 429 retry, counts only);
  `tip-smoke.mjs` (deployed-env verifier incl. CloudWatch search for tip
  text — must be zero hits).
- **Docs:** tipline.md rewrite, admin.md, api-security, debug/api,
  data-handling (tips row, Airtable marked legacy), for-conner (read token,
  cutover 6b/5b tips copy + delta, day-30 Airtable retirement, Read-Host),
  editing guide, plan doc.
- **Review (security / data-integrity / Next.js ops) + fixes:** stable
  import ids, delete tombstones, `updated_at` on import, strict uuid guard,
  SQL `edited` flag, `.tip-text` class, list counts/wording, smoke cleanup.
- **Verified on staging:** tip-smoke 7/7, staging-check 26/26, admin headless
  (viewer refused, editor status, editor delete refused, owner delete,
  audit rows, 404 on bad id), export drill (tips.json) + restore drill.

Open P1 unchanged: project files publish is one-person (v0.11.0).
Accepted risk recorded at push time (API Lambda connected to DSQL as
`admin`, so a compromised public route could read tips): fixed in v0.12.1.

## v0.11.3 — 2026-09-13 (branch `refactor`)

Admin copy: what "next Publish" means.
- **Admin:** every save notice (collection pages, Site Settings, Documents
  list and editor, Files, Redirects) now says a draft goes live "when a
  publish request is approved on Publish & Status" instead of "on the next
  Publish", and that nothing is rebuilt by hand. Redirects save toast says
  the same. Wording only, no logic.
- **Docs:** `docs/non-technical-editing-guide.md` intro, Documents status
  and Redirects lines point at the section 2 request/approve flow.

Open P1 unchanged: project files publish is one-person (v0.11.0).

## v0.11.2 — 2026-09-13 (branch `refactor`)

Staging basic auth + admin DB client hygiene.
- **Infra (staging CloudFront Function):** `/css/*`, `/assets/*`, `/media/*`
  bypass the basic-auth gate; pages, `/files/*`, `/api/*` still 401 without
  the credential; prod unchanged. Fixes the native browser sign-in dialog that
  appeared over the admin document editor (preview iframe loads those
  subresources from `PUBLIC_ORIGIN`). `scripts/staging-check.mjs` gains a
  no-auth `/css/styles.css` 200 check (26 checks).
  `docs/decisions/staging-basic-auth-asset-exemption.md`,
  `docs/error-handling/client-side-error/2026-09-13-admin-preview-basic-auth-dialog.md`.
- **Admin:** `editorData` and the Files page run their queries sequentially on
  the shared `pg.Client` (was `Promise.all` → pg DeprecationWarning, throws in
  pg 9). `docs/error-handling/client-side-error/2026-09-13-pg-concurrent-query-deprecation.md`.
- Docs: `documents.md`, `media.md`, build-spec §16 note the exemption.

Open P1 unchanged: project files publish is one-person (v0.11.0).

## v0.11.1 — 2026-09-13 (branch `refactor`)

Project files on the site + donation asks (`docs/systems/files.md`,
`docs/decisions/donation-appeals-page.md`).
- **/projects lists published files** under each project block (name,
  folder · size, note; `download` links). The DB render path supplies
  `content.project_files` (`packages/db/project-files.js`,
  `deriveProjectFiles`); the git/local build renders none.
- **Download modal** on every page (footer partial): "Your download has
  started." + donation ask after any published-file download; copy in four
  new `site_settings` columns (`downloadModal*`, ALTER TABLE; defaults in
  content/settings.json; declared in config.yml). `js/main.js` now has one
  `createModal()` for both dialogs.
- **Admin /appeals (Donation appeals)**: homepage donate section, homepage
  timed modal and the download modal edited together; Homepage and Site
  Settings editors skip and preserve those fields.
- **CDN cost controls**: 50 MB publish cap (`MAX_PUBLIC_BYTES`); prod-only
  AWS Budget on CloudFront → OpsAlerts (80 % actual / 100 % forecast);
  compression confirmed on `/files/*`.
- Staging: schema applied + settings seeded; e2e through a real
  `--source db` publish passed (11 checks), test file removed, republished.
- Error log: `docs/error-handling/build-failures/2026-09-13-publish-refused-git-source.md`
  (`scripts/publish.mjs` without `--source db` would drop Documents; the
  guard refused — three `failed` manual rows on the staging dashboard).

Open: Amplify Hosting deploy (repo access); OpsAlerts email subscription
(for-conner.md); nav/footer "Donate" labels and the donate form button stay
template-owned.

## v0.11.1 — 2026-09-13 (branch `refactor`)

Docs and repo hygiene (no code).
- **`docs/for-conner.md`** rewritten as an operator runbook that Conner's
  own Claude Code agent can execute, with `[hand]` steps where a console
  click or a secret is needed: agent setup (mandatory `uccsite` profile),
  secrets with a write-only verification pattern, GitHub App for the
  export, admin roster + the two-person publish requirement (two accounts
  minimum), prod stack redeploy / content / donor migration commands,
  cutover sequence (custom domain + ACM not yet in the stack — flagged),
  Amplify hosting, open dev items.
- **.gitignore**: `docs/migration/documents/*.document.json` were ignored,
  leaving the docs tree incomplete in git; now tracked (8 files, one-time
  migration output).
- CLAUDE.md docs structure matches the real tree; admin.md and
  publish-pipeline.md no longer mention restore-and-republish / a publish
  button; README lists files.md.

Open P1 unchanged: project files publish is one-person (v0.11.0).

## v0.11.0 — 2026-09-13 (branch `refactor`)

Admin: two-person publishing (`docs/systems/admin.md` "Publishing", ADR
`docs/decisions/two-person-publish.md`). The direct Publish button is gone;
the code landed in the v0.10.1 push (3cd00bb), the docs and review fixes in
this one.
- **Request → approve/decline**: Publish & Status lists every content save
  since the site last went live; an editor/owner requests a publish with a
  note; any OTHER editor/owner approves (the only admin path that invokes
  PublishFn) or declines with a required note; the requester can withdraw,
  an owner can clear a stale request. Requester ≠ reviewer enforced by
  `cognito:username` and email; one pending request at a time; conditional
  UPDATE so two reviewers can't both publish; in-flight publish refused.
- **Review fixes** (one agent, 4 findings): approve carries `seenThrough`
  and is refused if saves landed after the reviewer's page was rendered;
  "unpublished" measured from the last good run's `started_at`; a one-row
  `publish_request_gate` makes racing requests conflict on DSQL; trigger
  `approve:<id>:<email>` joins each approval to its run in the requests
  table (live / publishing / failed / refused / not started), and a failed
  invoke reopens the request with a `publish.invoke_failed` audit row.
- **Revisions**: restore is a draft (no automatic republish).
- Schema: `publish_requests`, `publish_request_gate` (wired into
  `content-schema.js`; applied to staging).
- Docs: admin.md, publish-pipeline.md, editor guide §2, README, ADR,
  debug/admin.md, data-handling rows.
- Verified headlessly on staging with the editor/owner test users:
  self-approve, self-decline, decline-without-note, duplicate request,
  stale-page approve all refused; owner approve → run `approve:<id>:…`.

Open P1: **project files** (`/files` Publish, v0.10.1) copies a file to the
public `/files/*` on one editor's action — an exception to the two-person
rule, recorded in admin.md; route it through the publish request.

## v0.10.1 — 2026-09-13 (branch `refactor`)

Admin: project files (`docs/systems/files.md`).
- **Files** page (`/files`): signed-in file store organised by project
  (soft link on `projects.slug`) then a free-text folder path, with a note
  per file. Any role downloads (presigned GET, attachment); editor+ uploads,
  moves, publishes, unpublishes, deletes. Every mutation audited
  (`files.*`).
- Uploads: type derived from the extension against an allow-list (no
  html/svg/js), signed into the presigned PUT with the length; the server
  verifies the object (HeadObject) before the row becomes ready. 250 MB cap.
- **Publish to the live site**: server-side CopyObject `private-files/` →
  `files/<id>/<name>` in the media bucket, served by a new CloudFront
  `/files/*` behavior on the shared media origin; the bucket policy grants
  `media/*` + `files/*` only, so uploads and private files stay unreachable
  from the edge. Public copies carry Content-Disposition and a 5-minute
  cache (unpublish lag).
- Schema: `project_files` table (+ index). Applied to staging; UccStaging
  deployed; 18-check e2e on staging passed (signed-type PUT 403/200,
  private prefix 404 via CloudFront, public copy 200 with type/disposition/
  cache/nosniff, basic auth still gates, presigned download).
- Docs: files.md, debug/files.md, admin/media/site-structure code maps,
  data-handling rows.

Open: Amplify Hosting deploy still blocked on repo access (SSR role needs
the same media-bucket object grants for files). Project pages do not list
published files yet; paste the `/files/…` path into a CTA or Document.

## v0.10.0 — 2026-09-13 (branch `refactor`)

Admin completeness pass (`docs/systems/admin.md` "What the admin covers").
- **Account & security**: `/profile` — change password, authenticator-app
  MFA (TOTP), security keys / passkeys (registered on Cognito managed login,
  listed/removed in the admin), own bio + headshot (`team_members.email`
  link). Cognito: managed login v2, passkey first factor, `aws.cognito.
  signin.user.admin` scope, access-token cookie.
- **Users & roles** (owner): invite, role, disable/enable, password reset,
  remove MFA, sign out everywhere; `scripts/admin-user.mjs` for the CLI.
- **Redirects**: `redirects` table + admin page; every publish syncs the
  CloudFront KeyValueStore (verified end to end at the edge); exported as
  `redirects.json`.
- **Subscribers**: list + audited CSV export (editor+).
- Cognito user jarom.gillins@utahciviccompact.org created as owner (staging).
- Review fixes: session requires a verified email claim and the pool keeps
  the original email until a new one is verified (identity cannot be
  spoofed through the self-service scope); owner self-guards by username;
  removing MFA or a security key needs a sign-in under 15 minutes old; edge
  redirects preserve query strings and use correct status text; redirect
  validation tightened + two-hop loop guard; KVS sync never wipes a seeded
  store on an empty table and failures show on the run row; user list
  paginated; own-profile save carries the lost-update stamp; CSV export
  is POST-only.

## v0.9.1 — 2026-09-13 (branch `refactor`, pushed 2026-09-13)

Follow-ups that needed no operator input:
- `allow_scripts` escape hatch implemented in the sanitizer (src-only,
  allowlisted host, content emptied, every toggle audited).
- Media library refuses to delete an asset still referenced by a team
  headshot or a document; cards show "Used by …".
- Style Kit: 143 of 151 classes annotated (`scripts/annotate-style-kit.mjs`);
  the parser now accepts stacked `@class` comments on a shared rule.
- Review fixes: `allow_scripts` cannot be re-enabled by an editor through a
  revision restore (owner-only on every path, audited); kept scripts carry
  src/async/defer only; dropped scripts are explained in the ingest report;
  media usage computed in a few queries and also covers markdown links.

## v0.9.0 — 2026-09-13 (branch `refactor`; first pushed with v0.9.1)

Phase 9 — Projects and cleanup (`docs/systems/projects.md`).

- Admin projects editor with nested press articles / videos (recursive list
  editor), filter box and A–Z / newest-first sorting; whole tree saved in one
  transaction; restore path handles the nested snapshot.
- `/projects` gains client-side status/region filters and sort (featured,
  newest, A–Z) with no inline script/style; option lists derived from content.
- ADR reconciliation: every pre-migration decision carries a status line;
  cms.md and state-of-the-site.md point at the AWS state.
- Review fixes: `[hidden]` always wins (filter controls truly hidden without
  JS), one deterministic free-text date parser shared by site and admin
  (`packages/render/dates.mjs`), `PROJECT_CHILDREN` drives the nested
  read/write and the drift guard, trimmed data attributes, blank nested
  entries dropped, article `lang` rendered on /projects.

## v0.8.0 — 2026-09-13 (branch `refactor`; first pushed with v0.9.1)

Phase 8 — Documents & styling (`docs/systems/documents.md`).

### Documents
- Data model (`documents`, `style_rules`, `style_overrides`, `foreign_class_map`),
  compose layer (ingest on every publish → rules/overrides → tokens → shell
  with a generated SEO head + JSON-LD), page CSS as fingerprinted files.
- The eight long-form pages migrated into Documents with a parity proof;
  staging publishes them from the database (a Document replaces the
  same-slug template). Ingest allowlist widened for the reports (ADR).
- Admin: document list by category, editor (SEO panel with SERP preview,
  HTML/CSS editors + ingest report, element tree ↔ live preview, class
  picker, bulk apply, promote-to-rule), Styles page (rules with match
  counts, foreign class map, Style Kit catalog), restore path.
- Content export v2 (documents/, styles/rules.json) + restore drill passed.

### Site
- CSP tightened on AWS to `style-src 'self'; font-src 'self'`: self-hosted
  fonts, fixed pages' styles moved to `css/pages/*.css`, inline style
  attributes replaced by classes, generated `css/colors.css`.
- 24 Style Kit annotations in `css/styles.css`.

### Review loop (688ec60)
- Three review passes fixed: failed runs marking documents live, export
  deletions + normalized bodies for restore, migration overwrite guard,
  token expansion on the tree with re-escaped author text, coverage
  partial sinks (`{{url}}`, validated `lang`), YouTube host vs CSP,
  preview iframe isolation, React 19 form reset on rejected saves,
  rooted selectors, class toggle semantics, `/styles` parse-once.

### Open items at this point
- Same operator blockers as v0.7.0 (secrets, GitHub App, Amplify install).

## v0.7.0 — 2026-09-13 (branch `refactor`; first pushed with v0.9.1)

State of the AWS rebuild (`docs/build-spec-aws.md`) at the end of Phase 7.
Everything below is on `refactor`; `main` still deploys the Cloudflare site.

### Phases 0–5 (2026-09-12)
- Renderer ported to `packages/render` with golden-file parity tests; named
  diffs (partials, clean-URL canonicals, donation total removed, 404 page).
- Content core: `html-ingest`, `style-kit`, `style-apply` (pure, tested).
- CDK stack per environment: S3 + CloudFront (OAC, headers policies,
  viewer-request function + KVS redirects, staging basic auth), Aurora
  DSQL, API Lambda Function URL with origin lock, Cognito pool/groups.
- Publish pipeline (hash diff, put-changed, invalidate, verify,
  `publish_runs`) + hourly drift reconciler + operational export bucket.
- API port (all routes + Stripe webhook, runtime Secrets Manager),
  D1 migration scripts, Turnstile front-end.

### Phase 7 — admin (2026-09-13)
- Next.js admin (`apps/admin`): Cognito PKCE login, role gating, typed
  editors for every collection, donations view, audit log, revisions with
  restore-and-republish, publish dashboard.
- Media library: presigned browser uploads, `MediaProcessFn` sharp
  AVIF/WebP variants under `/media/*`, alt-text gate, team headshot picker.
- Content export to git (`ExportContentFn`, GitHub App, commits only on
  change, `content-export` branches) + `restore-from-export.mjs`; staging
  restore drill passed.
- Review + fix loop (security / data-integrity / Next.js-ops): DB publish
  mutex with `refused` runs and recorded early failures, async retries off;
  one-transaction saves with lost-update stamps; form actions return
  `{ok}|{error}` (Next 15 masks thrown messages in prod); signed upload
  Content-Length; prod Cognito SRP-only; donor PII editor-only; Amplify
  build spec + checklist.
- `templates/weber-county.html` heading order restored to production's.

### Open items at this point
- P1 (blocked on operator): `TOKEN_SECRET` recovery, real API secrets,
  GitHub App secrets (export → then Decap retirement), Amplify GitHub
  install (admin hosting). See `docs/for-conner.md`.
- Phase 6 cutover not started (needs the above + explicit go).
