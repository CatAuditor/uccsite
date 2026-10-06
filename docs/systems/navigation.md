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
    { "label": "Donate", "href": "/#donate", "style": "donate" }
  ],
  "footer": {
    "columns": [{ "heading": "Contact", "links": [{ "label": "{email}", "href": "mailto:{email}" }] }],
    "bottom":  [{ "label": "Privacy Policy", "href": "/privacy.html" }]
  }
}
```

- **NULL / unreadable → `DEFAULT_NAVIGATION`.** The site can never lose its menus to a bad value.
- One dropdown level. `style`: `donate` → `class="nav-donate"`, `cta` → `class="nav-cta"`, top-level plain links only.
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
