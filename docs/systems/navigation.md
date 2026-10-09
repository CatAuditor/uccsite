# Navigation — header menu and footer (admin "Menus")

Built 2026-10-06. Editors change the header menu, the footer link columns and
the footer's bottom line (Privacy Policy) on the admin's **Menus (header &
footer)** page, instead of in `templates/partials/`.

## Code Map

```
packages/render/navigation.js     DEFAULT_NAVIGATION (the menus as hand-written until
                                  2026-10-06), normalizeNavigation (validate + cap; used by
                                  admin save AND renderer read), pageKey, navFields
packages/render/site.js           buildSite: ...navFields(settings, page) per page
packages/render/documents.js      composeDocument: ...navFields(settings, doc.slug)
packages/render/newsletters.js    archive pages: ...navFields(settings, 'newsletters')
templates/partials/header.html    {{{nav_header_html}}} inside <ul class="nav-links">
templates/partials/footer.html    {{{nav_footer_html}}} in .footer-grid, {{{nav_bottom_html}}} in .footer-links
packages/db/content-schema.js     site_settings.navigation TEXT (JSON)
packages/db/content.js            FIELD_MAPS.site_settings.navigation; JSON_FIELDS: parsed on
                                  read (unreadable → absent), serialized on write
apps/admin/app/navigation/page.js     load, page-picker options, save (server action)
apps/admin/app/navigation/nav-editor.js  client editor (reorder, into/out of dropdown, add/remove)
apps/admin/lib/collections.js     NAVIGATION_SETTINGS_FIELDS — owner of the column for the
                                  site_settings drift guard
packages/render/test/navigation.test.mjs  6 tests (normalize, aria-current, escaping, XSS)
```

## Data (`settings.navigation`)

```json
{
  "header": [
    { "label": "Mission", "href": "/#mission" },
    { "label": "About Us", "children": [{ "label": "Team & Bios", "href": "/team.html" }] },
    { "label": "Donate", "href": "/donate", "style": "donate" }
  ],
  "footer": {
    "columns": [{ "heading": "Contact", "links": [{ "label": "{email}", "href": "mailto:{email}" }] }],
    "bottom":  [{ "label": "Privacy Policy", "href": "/privacy.html" }]
  }
}
```

- **NULL / unreadable → `DEFAULT_NAVIGATION`.** The site can never lose its menus to a bad value.
- **`auto: 'projects'`** (2026-10-09) on a plain header link: at render it becomes a dropdown — the link
  itself first ("All projects") then one entry per top-level project (name → `/projects/<slug>`),
  capped at the children limit. `navFields(settings, page, { projects })`; render paths without projects
  (the newsletter archive) show the plain link. The default Projects item carries it. The Menus editor
  offers it as "List the live projects underneath" on a plain link.
- One dropdown level. `style`: `donate` → `class="nav-donate"`, `cta` → `class="nav-cta"`, top-level items only. On a
  dropdown (since 2026-10-08) the class goes on the toggle `<button>` and the `<li>` gets `nav-dropdown-styled`
  (css/styles.css: white text kept over the toggle's dark-text rules, menu right-aligned, chevron inline on mobile).
  The admin editor offers "Looks like" on dropdowns too.
- `{email}` in a label or href becomes Site Settings → email at render.
- Limits: 12 header items, 12 per dropdown, 5 columns, 12 links each, 6 bottom links, 80-char labels, 500-char hrefs. Empty rows dropped.
- hrefs pass `safeUrl` (http(s), mailto, `/`, `#`; anything else → `#`). `//host` becomes `https://host`. Off-site http(s) links open in a new tab with `rel="noopener"`.

## Rendering

The three blocks are **generated as HTML in `navigation.js`**, not with template
sections, so the default menus could reproduce the old hand-written partials
exactly. Verified 2026-10-06 against the live site: header, footer columns and
bottom line identical on all 19 rendered pages (ignoring the CRLF line endings
the live header carried from a Windows checkout).

**The golden test does not guard this.** `parity.test.mjs` exempts every site
page listed in `expected-diffs.json` — 16 of the 18 baseline pages — so it
only checks that pages exist. Menu changes are covered by
`navigation.test.mjs`; a byte-level check needs a fresh render compared with
the live site.

2026-10-07: the defaults gained a **Writing** dropdown and a footer link
(docs/systems/writing.md).

2026-10-08: **Find Your Officials** → `https://lookup.utahciviccompact.org`
(separate app, repo CatAuditor/UCC-lookup; off-site, so it opens in a new tab)
added in two places: the footer's Get Involved column, and the header, where
the **Get Involved** button became a dropdown (Join the Compact → `/#join`,
Find Your Officials) that still looks like the red CTA button. Conner: it is a
tool, not a project, so not under Projects. Not a 10th top-level header item:
that pushed Donate / Get Involved off-screen between 861 px (hamburger
breakpoint) and ~1100 px in a headless-Chrome check; the dropdown adds only a
chevron and still fits at 900 px. Prod `site_settings.navigation` was NULL (checked 2026-10-09), so the
defaults are what the site renders.

2026-10-10: the default **Donate** links (header button, footer Get Involved column) point at the
new `/donate` page instead of the homepage anchor `/#donate`. The anchor still works (the homepage
section stays) and remains in the admin link picker as "Homepage → Donate section". Re-check
`site_settings.navigation` is still NULL on prod before relying on the default.

`aria-current="page"` goes on a link whose href resolves to the page being
rendered (`pageKey`: `/team.html` → `team`), never on `#` anchors, styled
buttons or footer columns — the same rules the hand-written partials followed.

## Admin

**Save**: one transaction — `singletonStamp` lost-update check, `loadSettings`,
`saveSettings({ ...before, navigation })`, `recordChange` with action
**`settings.navigation`**, entityType `settings`, snapshot = previous settings.
- The `settings.` prefix matches publishing's `CONTENT_ACTION_RE`, so a menu save
  counts as unpublished.
- Revisions restores it through the existing `settings` path.
- Site Settings and Donation appeals both save `{ ...before, … }`, so they carry
  the menus through untouched.

**Link picker**: a `<datalist>` of built-in pages (`PAGES`), every Document
(drafts marked "not live"), homepage anchors, `/newsletters` and `mailto:{email}`.
Any address can also be typed. **Adding a page** = create it in All documents,
then pick it here.

## Deploy

The partials ship inside PublishFn's bundled `site-src`: after changing
`templates/partials/*`, `cdk deploy UccProd` before an admin publish.
Schema: `node scripts/migrate-schema.mjs --env prod` (idempotent ALTER).

## Debug

`[admin] <email> settings.navigation settings/singleton` on save (recordChange).
A broken saved value never errors — it renders the defaults. To check what is
stored: `SELECT navigation FROM site_settings`.

## Not built

- Drag and drop (arrows instead).
- Dropdowns in the footer, or deeper than one level in the header.
- `tel:` links (not in `SAFE_URL_SCHEMES`).
- The footer's brand, tagline, legal lines and Instagram icon are still in
  `footer.html` / Site Settings, not on the Menus page.
