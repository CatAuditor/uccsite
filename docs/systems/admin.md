# Admin App (apps/admin — Phase 7)

Cognito-gated content editing + publish. Next.js 15 (JavaScript, no CSS
framework), runs locally via `next dev` against a deployed environment;
Amplify Hosting at `admin.utahciviccompact.org` at rollout.

## Code Map

```
apps/admin/
  middleware.js            cookieless requests → /login (verification is NOT here);
                           manifest + icons pass through for the install flow
  app/layout.js            root layout: session → nav groups, Inter via next/font (class on
                           <body>), viewport/themeColor; signed-out = bare .login-only main
  app/globals.css          the whole admin stylesheet — design tokens copied from the live
                           site (see "Styling"), every component class, the phone block
  app/nav.js               navigation (client): find-a-page filter, folding sections,
                           current page; phone top bar (Section › Page) + bottom tab bar
                           + full-screen menu sheet (see "Navigation & phone use")
  app/manifest.js          web app manifest → /manifest.webmanifest (installable PWA);
  app/icon1.png,           icons = the UCC mark on site navy #1b2f4e (512 maskable / 180). Numbered:
  app/apple-icon1.png      Next serves them immutable for a year, so a changed icon gets a new number.
  lib/config.js            env-driven config (scripts/admin-env.mjs writes .env.local)
  lib/aws-account.js       wrong-account guard: STS GetCallerIdentity vs UCC_ACCOUNT_ID,
                           once per process, before any DB use (no-op when unset)
  instrumentation.js       Next boot hook: runs the account guard so a wrong profile
                           is loud in the terminal at startup
  lib/auth.js              hosted-UI authorization-code + PKCE (server-side),
                           ID token in httpOnly cookie, aws-jwt-verify on EVERY
                           read, roles from cognito:groups, requireRole()
  lib/data.js              withDb + recordChange (revisions last-20 + audit_log)
                           + latestPublishRuns
  lib/collections.js       field specs per collection (the config.yml successor —
                           but the DB is the schema; adding a field is a migration)
  lib/collection-save.js   sanitize → baseline (lost-update) check → alt-text
                           gate → scoped wipe-and-load → revision + audit, ONE txn
  lib/actions.js           runAction: { ok } | { error } result convention
  lib/publish.js           two-person publishing: request / approve / decline /
                           withdraw; the ONLY admin code that invokes PublishFn
  app/action-form.js       client form wrapper rendering that result
  app/request-publish.js   "Request publish" button beside every Save button (client);
                           calls app/publish-actions.js requestPublishInline
  lib/notify.js            review-request email via SES (lib/notify-recipients.mjs:
                           pure recipient list + body, tested)
  lib/when.mjs             DSQL text timestamp → "Oct 5, 9:14 PM MT" (tested)
  app/error.js             backstop error boundary
  lib/media.js             media library server helpers (docs/systems/media.md)
  lib/files.js             project files server helpers (docs/systems/files.md)
  lib/account.js           Cognito self-service (password, TOTP, passkeys) +
                           owner user administration
  app/profile              My profile & security: change password, authenticator
                           MFA, security keys / passkeys, own bio + headshot
  app/users                owner-only: invite, role, disable, reset password
                           (resend invite before first sign-in), remove MFA,
                           sign out everywhere, remove access (delete)
  app/redirects            redirects table → CloudFront KeyValueStore on publish
  app/mail, app/mail/[id]  Newsletters: block composer + phone/desktop light/dark preview,
                           test send, two-person send request/approve, schedule
                           (docs/systems/newsletters.md; lib/newsletters.js)
  app/subscribers          Mailing list (editor+): everyone we hold with a status
                           (subscribed / unconfirmed / unsubscribed / suppressed), residency /
                           donor / petitions labels, per-person newsletter counts, status +
                           search + "who is this email going to" filters, audited CSV;
                           actions.js = Remove / Undo removal / Erase record (audited);
                           query = packages/db/audience.js (shared with the sender) —
                           docs/systems/newsletters.md "Mailing list management"
  app/petition             Petition (editor+): campaign copy (homepage.petition group,
                           page: 'petition'; Project dropdown = widget 'project', thank-you
                           email subject/body), filed-under line, signatures per slug
                           (+ project), audited CSV export (docs/systems/petition.md)
  app/tips                 tipline inbox (editor+): list w/ status filter, [id] detail,
                           status change (audited tip.status), owner-only delete
                           (audited tip.delete, no snapshot) — docs/systems/tipline.md
  app/page.js              Publish & Status: unpublished saves → publish request
                           → a different admin approves (async PublishFn invoke)
                           or declines with notes; request history + publish_runs
                           history (Publishing…/Live hh:mm/failed)
  app/appeals              Donation appeals: homepage donate section + timed modal +
                           download modal, one save (docs/decisions/donation-appeals-page.md)
  app/settings, /homepage, /team, /statements, /issues, /press,
  /projects                collection editors (generic ListEditor client component;
                           press = every story, placements derived — docs/systems/press.md)
  app/media/inline-upload.js  InlineImageUpload — upload beside any image field (team/profile
                           headshot, newsletter image block, document og:image; media.md)
  app/media                media library: presigned-PUT uploads, sharp variants
                           via the MediaProcessFn Lambda, alt text, delete
                           (docs/systems/media.md)
  app/files                project files: upload, project/folder organisation,
                           download, publish to /files/* (docs/systems/files.md)
  app/revisions            revisions browser + restore (a draft — goes live
                           through a publish request like any save)
  app/donations            staff view: every donation + contact info (addendum 2)
  app/audit                audit trail
  app/documents            Documents list/create + [id] editor (Phase 8,
                           docs/systems/documents.md); app/styles rules/kit;
                           documents/authoring-kit/route.js = kit .md download
  lib/documents.js         editor data, Style Kit, preview, match counts,
                           the Project chooser's project list
  app/projects             the project tree + list editor; [slug] = the project
                           WORKSPACE (record, folders of files + notes, notes,
                           activity); [slug]/notes/[id] one note; lib/projects.js
                           (docs/systems/projects.md "Admin")
  lib/authoring-kit.js     the authoring kit markdown (voice rules + live Style
                           Kit + template rules) — documents.md "Authoring kit"
  lib/convert-upload.mjs   .docx (mammoth) / .md (marked) → HTML for the
                           document body upload
  lib/hero-status.js       live-vs-saved hero check shown on /homepage and /petition (petition.md)
scripts/admin-env.mjs      stack outputs → apps/admin/.env.local
```

## What the admin covers (site-management audit, 2026-09-13)

| Site need | Where |
|---|---|
| Every collection the templates render (settings, homepage, team, statements, policy positions, projects, press — one list feeding News & Media, the homepage cards, the hubs and the coverage strips) | Site Main editors |
| Long-form pages, their styling, SEO, JSON-LD | Documents + Styles |
| Images | Media Library |
| Files (PDFs, spreadsheets, records…) shared between staff, optionally published at `/files/…` and listed on /projects | Files |
| Every donation ask (homepage section, timed modal, download modal) | Donation appeals |
| The petition campaign: hero takeover, /petition copy, thank-you ask, public Utah-only counter; signatures split Utah / outside + CSV | Petition |
| Moved / retired URLs | Redirects (synced to the edge on publish) |
| Publish (two-person rule), rollback, history | Publish & Status, Revisions, Audit Log |
| Donors; the mailing list with audience controls (residency, donors, petition signers) + CSV; remove / restore / erase people on the list | Donations, Mailing list |
| Newsletters: write (blocks or a .docx/.md/.html import), site letterhead look, live audience count, preview (phone, light/dark), test, request → approve → send (now or scheduled) | Mail → Newsletters (docs/systems/newsletters.md) |
| Confidential tips: read, triage status, delete | Tips (editor+; delete is owner) |
| Accounts, roles, MFA, security keys | Users (owners), My profile (everyone) |

Not in the admin by design: secrets (Secrets Manager), templates for fixed
pages (developer-owned, spec §3.3). The newsletter moved INTO the admin on
2026-10-05 (Mail → Newsletters); `scripts/send-periodical.js` remains an
operator fallback.

## Account & security (spec §11)

- Sign-in: Cognito **managed login** (newer hosted pages). First factor is a
  password or a **passkey / security key** (`allowedFirstAuthFactors:
  password + passkey`); optional **authenticator-app (TOTP) MFA**.
- The pool's passkey relying-party ID is the pool domain, so security keys
  are registered on the pool's `/passkeys/add` page (the profile page links
  there and it returns to `/profile`, which is a registered callback URL).
  Listing and removing keys happens in the admin via the user's access token.
- The OAuth scope `aws.cognito.signin.user.admin` is requested so the access
  token (second httpOnly cookie, `ucc_admin_access_token`) can call the
  user's own ChangePassword / TOTP / WebAuthn APIs. Both cookies expire in 4 h
  (2026-10-05; was 1 h) — the same as the app client's id/access token
  validity in CDK, since the cookie carries the JWT and cannot outlive it.
  Because that scope also lets a user change their own email attribute, the
  session only accepts a **verified** email claim and the pool keeps the
  original email until a new one is verified (`keepOriginal`); owner
  self-guards compare `cognito:username`, not email. Turning MFA off or
  removing a security key requires a sign-in less than 15 minutes old
  (`auth_time`).
- Team & Bios carries two author-page fields (slug, public profile links) — docs/systems/author-pages.md.
- Everyone can edit their **own** bio, title and headshot on `/profile` when a
  team member carries their email (`team_members.email`, set by an editor in
  the Team editor; never published). Other people's entries: the Team page.
- Owners manage users on `/users`: invite (Cognito emails a temporary
  password), role (owner/editor/viewer group), disable/enable (+ global
  sign-out), force password reset, remove authenticator MFA, sign out
  everywhere, remove access. Admin cookies last four hours: a role change or
  sign-out takes effect at the next sign-in unless the user is signed out
  everywhere and their cookie has expired. Every action writes an `audit_log`
  row (`user.*`, `account.*`).
- **Reset password** (2026-10-06): Cognito's `AdminResetUserPassword` refuses a
  user who has never completed first sign-in (`FORCE_CHANGE_PASSWORD` —
  "User password cannot be reset in the current state") and a disabled user.
  The action reads the user first: not enabled → clear error; never signed
  in → `AdminCreateUser MessageAction=RESEND` (a fresh temporary-password
  invite, audited `user.invite_resent`, button reads **Resend invite**);
  otherwise the reset (`user.password_reset`). `lib/account.js friendly()`
  passes the admin APIs' own `NotAuthorizedException` text through; only the
  self-service token errors become "Current password is incorrect…" — see
  docs/error-handling/client-side-error/2026-10-06-admin-reset-password-force-change.md.
- **Remove a user** (2026-10-06): owner picks the user and types their email
  to confirm; the action is `removeUser` → `AdminUserGlobalSignOut` then
  `AdminDeleteUser` (`lib/account.js deleteUser`), audited `user.delete` with
  `{ email, name, role, status }` in the diff. Self-removal refused. Nothing
  in DSQL references the Cognito user — `audit_log.actor`, every `*_by`
  column, `documents.author` and `team_members.email` hold the email or name
  as text — so their history, approvals and bylines keep their attribution.
  `publish_requests.requested_by_user` (cognito:username) is display-only.
  Needs `cognito-idp:AdminDeleteUser` on the SSR role (added to
  `UccProdAdminCompute`/`admin-runtime` 2026-10-06; local profile has it).
- CLI equivalent for the first owner: `node scripts/admin-user.mjs --env
  staging --email … --name "…" --group owner`.

## Navigation & phone use — PWA (2026-10-05)

- `app/layout.js` (server) builds the nav groups per session role — the
  dashboard (`/` Publish & Status) is its own first group, *Overview* — and
  renders `app/nav.js` (client, inside `<Suspense>` because it reads
  `useSearchParams`). The current page is found by longest-prefix match on
  `pathname?query` (so `/documents/abc` lights "All documents" and
  `/documents?category=Reports` lights that category only; `/` only exactly)
  and gets `.nav-link.active` + `aria-current`.
- Sidebar (every width): a **Find a page** filter at the top (matches page or
  section label; all sections unfold while filtering), sections as `<details>`
  the user can fold, the signed-in user + Sign out as a block stuck to the
  bottom of the (scrolling) sidebar. `:focus-visible` outlines throughout.
- Phone (≤800px, `globals.css` "Phone layout"): the sidebar becomes a 54px
  sticky **top bar** — brand mark (→ `/`), `Section › Page` for the current page,
  Menu — plus a fixed **bottom tab bar** (`TABS` in nav.js: Home = `/`,
  Documents, Mail, Tips, Menu; `env(safe-area-inset-bottom)` padding,
  `viewportFit: 'cover'`). The menu is a **full-screen sheet** under the bar:
  on first paint only the current section is unfolded (`folded` state from
  `matchMedia`; a folded current section says "you are here"), it closes on
  navigation, Escape or Close, and `body.nav-open` locks page scroll. Content
  gets bottom padding for the tab bar. Tables become `display:block;
  overflow-x:auto`, `.split` (Documents style editor) and `.mail-split`
  stack, inputs are 16px (iOS focus zoom).
- Verified by rendering the component's markup against `globals.css` in
  headless Chrome at 390×844 (closed, menu open) and 1280×800
  (2026-10-05); not yet on a real phone.
- Installable: `app/manifest.js` (standalone, theme `#0f1e33` = site
  `--navy-dark` = the sidebar/top bar, splash/background `#1b2f4e` = site
  `--navy`, start `/`),
  `app/icon1.png` 512 (`purpose: any maskable`) + `app/apple-icon1.png` 180: the
  transparent UCC mark (white + gold) flattened onto `--navy` `#1b2f4e` and
  padded to the inner 70% so maskable launchers and iOS (which fills alpha
  with black) both show navy. Regenerate with sharp from the site favicon,
  not by re-saving the transparent source. `viewport` + `appleWebApp`
  exports in `layout.js`. **Numbered filenames on purpose**: Next serves
  `app/icon*.png` with `Cache-Control: immutable, max-age=31536000` and only
  its own `<link>` tags get a content-hash query; the manifest `src` cannot,
  so Android's install flow reused the year-cached old PNG at `/icon.png`.
  Any future icon change: bump to `icon2.png` / `apple-icon2.png` and update
  manifest, middleware `PUBLIC_PATHS`, and the three `<img src>` (layout,
  nav, login). Middleware lets `/manifest.webmanifest`, `/icon1.png`
  and `/apple-icon1.png` through without the cookie. **No service worker** by
  design: every screen is a live DB read and a cached shell would outlive
  Amplify deploys; Chrome and Safari install without one.
- Sessions are 4 h (callback cookie `maxAge` = CDK `idTokenValidity` /
  `accessTokenValidity` on AdminAppClient). Sign-in on a phone goes through
  the same Cognito managed login; passkeys work in standalone mode on iOS 16+.
- Status: built, `next build` clean; not yet verified on a real phone.

## Styling (2026-10-06)

- One file, `app/globals.css`, no framework (spec §15). Its `:root` tokens
  are copied by hand from the live site's `css/styles.css` so the admin reads
  as the same product: `--navy #1B2F4E`, `--navy-dark #0F1E33` (sidebar, phone
  top bar, tab bar), `--red #C0392B` (accent: current-page bar, pending
  request ring, danger buttons, sign-in button), `--cream #F5F1EA` (notices,
  quoted notes), the site gray scale, `--radius 6px` controls / `--radius-lg
  12px` cards, `--ring` focus halo. Change a site colour → change it here too.
- Typeface: Inter, loaded with `next/font/google` in `app/layout.js`
  (downloaded at build time, served by the admin itself; `inter.className`
  on `<body>`). `--font-sans` in the CSS lists `'Inter'` first so the mock
  pages below render the same way with a local `@font-face`.
- Component vocabulary (all class names are unchanged from before the
  restyle, so pages did not have to change): `button` = navy filled,
  `.secondary` = white outline, `.danger` = red, `.linkish` = text link; the
  compact tool buttons (`.item-tools`, `.list-tools`, `form.inline`, media /
  picker / mail tool rows) share one white-outline rule. Cards (`form.editor`,
  `section.request`, `.uploader`, `.media-card`, `.picker`, `.request-send`,
  `.dev-notes article`, tables) = white, 1px `--gray-200`, 12px radius, soft
  shadow. `.notice` cream with a navy left bar; `.error` / `.ok` red / green
  with a matching bar; status text classes unchanged. `h1 .hint` renders as a
  pill (Tips count). Tables use `border-collapse: separate` so the rounded
  corners clip; the phone block still makes them `display:block;
  overflow-x:auto`.
- Sidebar: navy-dark, brand = `/icon1.png` mark + "UCC Admin / Utah Civic
  Compact"; links are 6px-radius rows, the current page gets a red left bar;
  the Find box is a dark input (`.sidebar .nav-find input` — the `.sidebar`
  prefix is what beats the generic `input[type="search"]` rule). The phone
  tab bar marks the active tab with a red top notch.
- Login (`app/login/page.js`): `.login-card` — mark, red eyebrow, "Admin sign
  in", a full-width red button; errors keep `.error`.
- Verified 2026-10-06 in headless Chrome against the real stylesheet with
  static markup copied from the components: 1280×900 dashboard + list editor,
  390×844 dashboard / menu sheet / editor, login. Windows Chrome clamps a
  headless window to ~500px wide, so phone widths must be rendered inside a
  390px `<iframe>` on a wide page (media queries and `position: fixed` follow
  the iframe), not with `--window-size=390,…`.

## Auth

- Login → Cognito hosted UI (`ucc-admin-<env>.auth.us-west-2.amazoncognito.com`),
  code + PKCE exchanged server-side; ID token stored httpOnly/SameSite=Lax,
  1h expiry (re-login after; no refresh flow yet).
- `getSession()` verifies the JWT on every server read. Roles: `owner` >
  `editor` > `viewer`; an authenticated user in no group has NO access —
  the callback refuses to set the cookie and `/login?error=nogroup` says why.
- Sign-out is a POST (`/logout`); redirects in the callback/middleware are
  built from `APP_ORIGIN`, never the request Host.
- Donor PII (`/donations`) is `editor`+ (spec §11: viewer = read-only
  content; editor "reads form submissions"). Viewer sees every content
  editor read-only and the audit/revision lists.
- Prod Cognito client: SRP only (no `USER_PASSWORD_AUTH` — staging keeps it
  for scripted smoke tests), `preventUserExistenceErrors`, no localhost
  callback. Cognito callback/logout URLs and the media bucket CORS come
  from ONE origin list in the stack.
- **Every server action calls `requireRole('editor')`** — UI disabling is
  cosmetic, authorization lives in the data layer (spec §11).
- No self-signup. Users are created with `admin-create-user` (see
  docs/for-conner.md). Staging test users: test-{owner,editor,viewer}@…

## Editing model

Saves write the DATABASE only (with a `revisions` snapshot pruned to the
last 20 per entity, and an `audit_log` row); the live site changes on the
next approved publish (see "Publishing" below). An approval invokes the
PublishFn Lambda asynchronously; the dashboard polls `publish_runs` for
Draft/Publishing…/Live/Failed/Refused (the Lambda holds the real mutex —
docs/systems/publish-pipeline.md).

## Publishing (two-person rule, 2026-09-13)

Newsletters follow the same rule with their own table and pages — see
docs/systems/newsletters.md; the dashboard lists newsletters needing
attention above the publish request.

No post or update goes live on one person's say-so. `lib/publish.js` +
`packages/db/publish-requests.js` (table `publish_requests`, DDL wired into
`content-schema.js`; ADR docs/decisions/two-person-publish.md):

1. **Request** (editor+): the dashboard lists the content audit rows since
   the last `succeeded`/`noop` publish run ("unpublished saves"); the
   writer adds an optional note and submits — or presses **Request
   publish** beside any Save button (`app/request-publish.js`, same
   `requestPublish`, no note). Refused if a request is already pending or
   there is nothing to publish. Audit `publish.request`. **Email (2026-10-05):**
   after the commit, `lib/notify.js` mails the four admins (fixed list in
   `lib/notify-recipients.mjs`, minus the requester) **only when the request
   needs someone else** — an owner's request mails nobody since owners
   approve their own. Off prod nothing is sent unless `PUBLISH_NOTIFY_TO`
   (comma list) is set, so staging test editors never page real people. A
   mail failure is logged (`[admin] publish notify SES error`) and never
   fails the request; the success message tells the writer whether anyone
   was emailed.
2. **Review** (a DIFFERENT editor/owner — compared by `cognito:username`
   AND email — **or an owner reviewing their own request** since 2026-10-05;
   self-approvals are audited `publish.approve` with `selfApproved: true`):
   - **Approve** → the form carries `seenThrough` (the newest save the
     reviewer's page listed); inside the transaction any content audit row
     after it refuses the approval ("more saves landed since you opened
     this page — reload") so nobody approves what they have not seen. Then
     row set `approved` by a conditional `UPDATE … WHERE status =
     'pending'` (two reviewers racing: one wins, the other sees "just
     reviewed by someone else"), audit `publish.approve`, THEN the Lambda
     is invoked with `trigger = approve:<request id>:<reviewer email>`
     (outside the transaction, so a 40001 replay can't invoke twice).
     Refused while a publish is in flight. If the invoke itself fails the
     request is reopened (`pending`, audit `publish.invoke_failed`) and the
     reviewer is told nothing started. The request table joins each
     approval to its run by that trigger: "Approved — live / publishing… /
     FAILED / refused / not started".
   - **Decline** → note REQUIRED; row `declined`; audit `publish.decline`.
     The writer sees the note on the dashboard's request history.
   - **Withdraw** → the requester (or an owner clearing a stale request);
     audit `publish.withdraw`.
   **Starting window (2026-10-05):** the Lambda writes its `publishing`
   row only after rendering and diffing the site against S3 (30-60 s; a
   noop run only at the end), so `inFlightPublish` sees nothing meanwhile.
   `busyPublish` in `lib/publish.js` therefore also treats an `approved`
   request with no run row yet, reviewed < 10 min ago, as in flight
   (`runStatus = 'starting'`; past the window `'never started'`). While busy:
   the dashboard shows "Publishing now…" instead of the request form and
   polls (`Refresher`), Approve is disabled, and `requestPublish` /
   `approvePublish` refuse server-side — before this, people re-requested
   saves that were already going live. The requester's own pending request
   is reported as "Your publish request is already waiting"; Decline is
   hidden from the requester (the server refused it anyway).
   **Times** on the dashboard and in the review email are Mountain time with
   an "MT" label (`lib/when.mjs`, tested) — DSQL text timestamps are UTC and
   were shown raw before.
3. A publish renders the whole database, so saves made AFTER the request
   go live too; the pending panel lists them separately ("Also saved after
   the request") so the reviewer knows what they are approving (and the
   `seenThrough` check above guarantees the list was complete).

"Unpublished" = content audit rows (`CONTENT_ACTION_RE` in
`packages/db/publish-requests.js` — every `<collection>.save`, document, media,
redirect, style actions, `.restore`, plus `petition.save` and `appeals.save`
since 2026-10-05; a new save action MUST be added there or it never counts,
test `packages/db/test/publish-requests.test.mjs`) after the `started_at` of the newest
succeeded/noop run (the Lambda snapshots the database right after it
starts, so a save committed during a render is still unpublished).
`requestPublish` bumps a one-row `publish_request_gate` inside its
transaction so two racing requests conflict (DSQL only detects write-write
conflicts) and the loser sees the winner's pending row.

The request stores its change list (`changes` JSON = the audit rows it
covered) for the record. Viewers see everything read-only.

**Explicit exceptions** (paths that change the public site without a
second admin): developer CLI publishes (`scripts/publish.mjs`) and the
Lambda's own redirect-verify runs — operator actions, not content edits;
and **unpublishing** (any editor can take a public file down at once —
the rule stops things going up, not coming down).

**Project files no longer bypass the rule (2026-09-24).** `app/files`
"Publish" records a request; `promoteRequestedFiles` does the S3 copy in
`approvePublish`, after a second admin approves — before the Lambda
invoke, since the render selects on `public_key`. ADR
docs/decisions/project-files-two-person-publish.md.

Review fixes 2026-09-13 (the rules every editor page follows):

- **One transaction per save** (`withWriteTx` in lib/data.js): the
  wipe-and-load / upsert, the revision snapshot and the audit row commit
  together, replayed whole on a DSQL 40001 abort. packages/db helpers take
  `tx: false` inside it.
- **Lost-update check**: the form carries a `baseline` stamp
  (`collectionStamp` = count + MAX(updated_at); `singletonStamp` =
  updated_at); the save re-reads it in the transaction and refuses with
  "Someone else saved this since you opened it…" on mismatch.
- **Actions return `{ ok } | { error }`** (lib/actions.js `runAction`)
  and pages render them through `app/action-form.js` (useActionState).
  Next 15 masks thrown action messages in production, so throwing would
  turn "needs alt text" into a generic crash that also discards the
  editor's unsaved list. `app/error.js` is the backstop for render-time
  failures.
- **Restore** runs in the same transaction shape, refuses unknown entity
  types before touching anything, applies the alt-text gate to snapshots,
  and does NOT publish: the restored content is a draft that goes live
  through a publish request like any save (it appears in the request's
  change list as `<type>.restore`).
- **Singleton drift guards** at boot: `SETTINGS_FIELDS` ∪
  `APPEAL_SETTINGS_FIELDS` ≡ `FIELD_MAPS.site_settings` (disjoint);
  `HOMEPAGE_GROUPS` keys ≡ homepage JSON columns (field keys inside a group
  follow templates/index.html). Groups flagged `page: 'appeals'` (and the
  appeal settings fields) are edited on `/appeals` only, `page: 'petition'`
  on `/petition` only; Site Settings, Homepage, Appeals and Petition each
  save `{ ...current, ...ownFields }` so no page nulls another's columns.

## Link previews — "Add from link" (2026-09-30)

On Press & coverage: paste a link →
**Fetch preview** → a social-feed style card → **Add to top** with the fields
filled. Nothing saves until **Save**.

```
app/list-editor.js      LinkAdder — shown when a list has url + headline fields;
                        inserts at the top; maxItems caps a list (homepage press = 3,
                        the last entry drops). A host or outlet already in the list
                        keeps its outlet name and badge colour.
lib/unfurl.js           'use server' unfurlLink(url) — editor+. Fetches with
                        redirect:'manual', re-checking EVERY hop against private /
                        loopback / link-local / metadata ranges (it runs under the
                        compute role). 8 s timeout, 1.5 MB cap, html only.
lib/unfurl-parse.mjs    pure: Open Graph → outlet, headline (site suffix stripped),
                        excerpt (≤320 chars), date ("August 20, 2026", Utah time),
                        url (tracking params stripped), read_more ("Read on X →" /
                        "Leer en X →"), lang_attr; previewFromUrl for blocked sites.
test/unfurl-parse.test.mjs  8 tests incl. the SSRF ranges.
```

**Blocked outlets.** Utah News Dispatch sits behind a Cloudflare bot challenge
and Forbes 403s; no honest server fetch passes either (the crawler identifies
itself as UCC-LinkPreview and does not impersonate Facebook or Slack). On
401/403/429/503 or a challenge page, the card is built from the link alone —
outlet, date from the URL path, a DRAFT headline from the slug — and says so;
the editor fixes the headline and adds the summary.

Logs: `[unfurl] <email> <host> ok | blocked (HTTP n) → from-link fallback | → HTTP n | failed: <ErrorName>`.
Preview images are only shown in the admin; the public site's cards have no
image field.

## Development notes tab (2026-09-30)

`/dev-notes` (Operations → Development notes, every role) renders
`docs/dev-notes.md` — the plain-language change log CLAUDE.md requires with every
change. `lib/mini-markdown.mjs` escapes first, then renders headings, bullets,
bold, code and http(s)/relative links only (tested, incl. script/img injection).
On Amplify the file ships via `amplify.yml` (copied into `site-src/docs/`) and
`outputFileTracingIncludes['/dev-notes']`; locally it is read from the repo. A
missing file renders a notice, logged as `[admin] dev-notes unreadable: <code>`.

## What changed (Publish & Status, 2026-10-06)

Above the save log, **What will change on the live site** lists one expandable
row per section (Team & Bios, Petition, Menus, Documents › <title>, …): a count
summary, who saved and when; open it for field-level lines — Added / Removed /
Edited (each field `before → after`) / Order changed — and a link to the editor.

```
lib/change-detail.js        describeChanges(client, changes, liveAt) — read-only. Per saved
                            thing: BEFORE = the revision snapshot from just before its first
                            unpublished save (revisions.created_at > liveAt, oldest); AFTER =
                            the database now. Net effect, so edit-then-undo shows no change.
lib/change-detail-core.mjs  pure diff: diffFields, diffList (items matched by slug / YouTube
                            id / url / name…), diffNavigation (flattened menu paths),
                            diffDocument (details, word-count delta, CSS, overrides)
lib/publish.js              publishState() also returns `detail`
app/page.js                 WhatChanges component; the raw save list moved into a
                            collapsed "Save log"
test/change-detail-core.test.mjs  6 tests
```

Splits: the homepage row is reported as **Homepage**, **Petition** or **Donation
appeals** by group; site settings as **Site Settings**, **Donation appeals**
(download pop-up) or **Menus**. A save with no before/after model (media,
redirects, styles) still appears, with its saves listed. Errors describing one
thing are logged (`[admin] what-changed: …`) and never break the dashboard.

Limits: revisions keep 20 per thing — beyond 20 unpublished saves the BEFORE is
the oldest kept. Values over 90 characters are shortened.

## Menus (2026-10-06)

`/navigation` edits the header menu and footer links (`site_settings.navigation`).
See docs/systems/navigation.md.

## Env vars (lib/config.js)

`UCC_ENV, UCC_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN,
DSQL_ENDPOINT, PUBLISH_FUNCTION_NAME, MEDIA_BUCKET, SITE_BUCKET, PUBLIC_ORIGIN,
APP_ORIGIN` (+ `SITE_SRC_ROOT` on Amplify). Missing →
loud throw at first use. Optional: `PUBLISH_NOTIFY_TO` (comma list) overrides
the publish-request email recipients — unset on prod (fixed list), set to the
SES mailbox simulator to test on staging. `UCC_ACCOUNT_ID` (local only, from the stack ARN):
when set, `lib/aws-account.js` calls STS once per process and refuses every
DB use — and logs at boot via `instrumentation.js` — if the resolved
credentials belong to another account (the "forgot AWS_PROFILE" failure,
docs/error-handling/client-side-error/2026-09-13-admin-dev-wrong-aws-profile.md).
Leave it unset on Amplify. AWS credentials: local = `AWS_PROFILE=uccsite`;
Amplify Hosting = the app's SSR compute role (wire-up pending; it needs
`dsql:DbConnectAdmin`, `lambda:InvokeFunction` on PublishFn,
`s3:PutObject/GetObject/DeleteObject` on the media bucket, and `ses:SendEmail`
on the domain identity + `ucc-prod` configuration set, From pinned to
hello@utahciviccompact.org — role `UccProdAdminCompute`, inline policy
`admin-runtime`, hand-managed per docs/for-conner.md §8.3).

## Verified (2026-09-13, staging)

Headless smoke with real Cognito password-flow tokens: cookieless → 307
/login; editor token renders dashboard (email, publish history), settings
pre-filled from DSQL, and all six collection editors show live content
(team names, statement slug, blog articles, coverage strips, homepage
groups + press). Form-submit round trip needs a browser session — first
manual pass pending.

Two-person publishing (2026-09-13, dev server against staging, server
actions invoked headlessly with `Next-Action`): requester approve → "You
requested this publish — a different admin has to approve it"; requester
decline → "withdraw it instead"; owner decline without note → refused;
owner approve → `publish_requests.status = approved`, audit
`publish.approve`, publish run `approve:test-owner@…` (noop — content
unchanged); second approve → "no longer pending".

## Amplify Hosting (deploy checklist — blocked on repo access, see for-conner.md)

1. Amplify console → new app → GitHub `CatAuditor/uccsite`, "monorepo",
   app root `apps/admin`, platform WEB_COMPUTE. Branch `refactor` (staging)
   now; `main` → prod with custom domain `admin.utahciviccompact.org` at
   cutover. `amplify.yml` at the repo root is the build spec (it copies the
   runtime env vars into `.env.production` — console env vars are
   build-time only on Amplify).
2. Env vars per branch: everything `scripts/admin-env.mjs` writes (`UCC_ENV,
   UCC_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN,
   DSQL_ENDPOINT, PUBLISH_FUNCTION_NAME, MEDIA_BUCKET, SITE_BUCKET,
   PUBLIC_ORIGIN`) + `APP_ORIGIN` = the
   branch URL (`https://<branch>.<appid>.amplifyapp.com`).
3. SSR compute role (App settings → IAM roles, trust `amplify.amazonaws.com`):
   `dsql:DbConnectAdmin` on the cluster, `lambda:InvokeFunction` on
   PublishFn, `s3:PutObject/GetObject/DeleteObject` on `<MediaBucketName>/*`,
   `s3:GetObject` on `<SiteBucketName>/css/styles.css` (Style Kit),
   `ses:SendEmail` on `identity/utahciviccompact.org` + `configuration-set/ucc-prod`
   with `ses:FromAddress = hello@utahciviccompact.org` (publish-request email), and on
   the user pool: `cognito-idp:ListUsers, AdminGetUser, AdminListGroupsForUser,
   AdminCreateUser, AdminAddUserToGroup, AdminRemoveUserFromGroup,
   AdminDisableUser, AdminEnableUser, AdminResetUserPassword,
   AdminSetUserMFAPreference, AdminUserGlobalSignOut, AdminDeleteUser` (Users page).
4. Put the branch URL in `infra/cdk/cdk.json` as `stagingAdminOrigin` and
   `cdk deploy UccStaging` — that registers the Cognito callback/logout
   URLs and the S3 CORS origin. Without it: `redirect_mismatch` on sign-in
   and CORS failures on upload.
5. `next.config.js` allows Server Actions from `APP_ORIGIN`'s host; if
   saves still fail with "Invalid Server Actions request", compare the
   `x-forwarded-host` Amplify sends and add it there.
6. Optional: Amplify branch password on staging as a second gate.

## Not yet (rest of Phase 7)

Amplify Hosting deployment, THEN Decap + workers/auth retirement (only once
the export is actually committing — needs the GitHub App secrets from
docs/for-conner.md §4). Done 2026-09-13: media library, revisions restore
(draft; publish through a request), two-person publishing, project files,
content export Lambda + restore script + staging restore drill
(docs/systems/content-export.md).
