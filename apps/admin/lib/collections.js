// Collection editor specs — the admin's replacement for Decap's config.yml,
// except the DATABASE is the schema (a field added here + in
// packages/db/content-schema.js is a migration, not a silent-deletion
// hazard). Field lists mirror static/admin/config.yml so the editing surface
// carries over 1:1.
//
// widget: 'text' | 'textarea' | 'media' (text + media-library picker; targetWidth
// selects the variant). markdown flags fields that accept the
// **bold**/*italic*/[link](url) subset (hint shown to editors).

import { FIELD_MAPS, HOMEPAGE_GROUP_COLS, PROJECT_CHILDREN } from '@uccsite/db/content';

const MD_HINT = 'Supports **bold**, *italic*, [link text](https://url). Blank line = new paragraph.';


export const COLLECTIONS = {
  team: {
    title: 'Team & Bios',
    table: 'team_members',
    itemLabel: (item) => item.name || 'member',
    fields: [
      { name: 'name', label: 'Full Name' },
      { name: 'title', label: 'Title / Role' },
      { name: 'photo', label: 'Headshot', widget: 'media', targetWidth: 400, crop: 1,
        hint: 'Pick from the Media Library (only assets with alt text are offered) or type a path such as /assets/team/name.jpg' },
      { name: 'bio', label: 'Bio', widget: 'textarea', hint: MD_HINT },
      { name: 'slug', label: 'Author page URL slug', hint: 'optional; blank = made from the name (e.g. jarom-gillins → utahciviccompact.org/team/jarom-gillins)' },
      { name: 'links', label: 'Public profile links', widget: 'textarea',
        hint: 'One URL per line (LinkedIn, X, personal site…). Shown on the author page and told to search engines as the same person — this is what ties their name to their work here.' },
      { name: 'email', label: 'Admin email', hint: 'Links this bio to an admin account so they can edit their own bio and headshot from My profile. Not published.' },
    ],
  },
  statements: {
    title: 'Statements',
    table: 'statements',
    note: 'Newest first — the top statement is featured on the homepage.',
    itemLabel: (item) => item.title || item.slug || 'statement',
    fields: [
      { name: 'slug', label: 'Slug (URL anchor)', hint: 'lowercase-with-dashes' },
      { name: 'date', label: 'Date', hint: 'e.g. July 24, 2026' },
      { name: 'topic', label: 'Topic' },
      { name: 'author', label: 'Author' },
      { name: 'title', label: 'Title' },
      { name: 'snippet', label: 'Snippet (homepage card)', widget: 'textarea' },
      { name: 'body', label: 'Body', widget: 'textarea', hint: MD_HINT },
      { name: 'signoff', label: 'Sign-off', hint: 'optional, e.g. — Utah Civic Compact' },
      { name: 'url', label: 'Homepage card link', hint: 'optional; blank = the statement’s spot on /statements' },
      { name: 'more', label: 'Homepage read-more text', hint: 'optional; blank = "Read the full statement →"' },
    ],
  },
  issues: {
    title: 'Policy Positions',
    table: 'issues',
    itemLabel: (item) => item.title || 'position',
    fields: [
      { name: 'slug', label: 'Slug' },
      { name: 'num', label: 'Number' },
      { name: 'title', label: 'Title' },
      { name: 'author', label: 'Author' },
      { name: 'epigraph', label: 'Epigraph', widget: 'textarea' },
      { name: 'body', label: 'Body', widget: 'textarea', hint: MD_HINT },
    ],
  },
  // THE press list (docs/systems/press.md): one row per story. Where it shows
  // is derived at render: the project's hub (project_slug), the
  // {{coverage:<project>}} strip inside that project's reports, News & Media
  // (unless hidden), the homepage cards (featured, first three in this order).
  press: {
    title: 'Press & coverage',
    table: 'press',
    sortable: true,
    note: 'Every story about the Compact, once. Order here is the order on News & Media and on each project page; "Sort newest first" reorders by date. A story with a project appears on that project\u2019s page and in the coverage strip inside its reports; tick Homepage to make it one of the three homepage cards (the first three ticked, in this order).',
    itemLabel: (item) => item.headline || 'story',
    fields: [
      { name: 'type', label: 'Kind', widget: 'select', options: [['', 'Article'], ['video', 'Video (YouTube)']] },
      { name: 'outlet', label: 'Outlet' },
      { name: 'badge_color', label: 'Badge color', hint: 'hex, e.g. #0057a8 — Add from link reuses the colour of a known outlet' },
      { name: 'date', label: 'Date', hint: 'e.g. August 20, 2026' },
      { name: 'region', label: 'Region' },
      { name: 'headline', label: 'Headline' },
      { name: 'excerpt', label: 'Excerpt', widget: 'textarea', hint: 'shown on News & Media and project pages (not in the compact strips)' },
      { name: 'url', label: 'Article URL', hint: 'for a video, the YouTube page is fine; the embed uses the video id below' },
      { name: 'read_more', label: 'Read-more text', hint: 'e.g. Read on KSL →' },
      { name: 'lang_attr', label: 'lang attribute', hint: 'optional, e.g. lang="es" for Spanish coverage' },
      { name: 'youtube_id', label: 'YouTube video id', hint: 'videos only' },
      { name: 'embed_params', label: 'Embed params', hint: 'videos only, optional, e.g. ?start=90' },
      { name: 'youtube_title', label: 'Player title (accessibility)', hint: 'videos only' },
      { name: 'project_slug', label: 'Project', widget: 'select', optionsFrom: 'projects', hint: 'blank = general coverage (News & Media only)' },
      { name: 'featured', label: 'Homepage card', widget: 'checkbox', hint: 'the first three ticked stories, in list order, are the homepage\u2019s "Recent Coverage"' },
      { name: 'hide_from_news', label: 'Hide from News & Media', widget: 'checkbox', hint: 'keep it on the project page only' },
    ],
  },
  // Projects (docs/systems/projects.md). Press articles/videos used to be
  // nested child lists here; since 2026-10-09 they live in the press list.
  projects: {
    title: 'Projects',
    table: 'projects',
    nested: true,
    childTables: PROJECT_CHILDREN, // the db layer's mapping — asserted below
    note: 'Order here is the order on /projects and the homepage cards. Use the filter box to find a project; drag order with the arrows. Each project has its own workspace (notes, files, documents) — open it from the list above. Press coverage is on the Press & coverage page.',
    itemLabel: (item) => item.name || 'project',
    fields: [
      { name: 'name', label: 'Project name' },
      { name: 'slug', label: 'Slug', hint: 'lowercase-with-dashes; the project page is /projects/<slug>. Renaming keeps every document, file and note attached.' },
      { name: 'parent_slug', label: 'Part of (parent project slug)', hint: 'blank = a top-level project; a parent’s slug makes this a sub-project at /projects/<parent>/<slug> (two levels at most)' },
      { name: 'date', label: 'Date', hint: 'e.g. August 2026 or June 4, 2026 (used for "newest first" sorting on the site)' },
      { name: 'author', label: 'Author' },
      { name: 'status', label: 'Status', hint: 'e.g. Active, Closed' },
      { name: 'status_color', label: 'Status colour', hint: 'hex, e.g. #c0392b' },
      { name: 'region', label: 'Region' },
      { name: 'tagline', label: 'Tagline', widget: 'textarea' },
      { name: 'summary', label: 'Project page intro', widget: 'textarea', hint: `Shown on the project’s own page under the button. ${MD_HINT}` },
      { name: 'cta_url', label: 'Button link', hint: 'e.g. /projects/alpr/report — the main report’s address' },
      { name: 'cta_text', label: 'Button text' },
    ],
  },
};

// ── Boot-time drift guard ───────────────────────────────────────────────────
// Every editor field must exist in FIELD_MAPS and vice versa. Without this,
// a column added to the DB but not here is silently WIPED on the next save
// (sanitizeItems drops unknown keys, then wipe-and-load) — Decap's exact
// delete-on-save hazard. Drift is a loud startup error instead.
function assertFieldsMatch(label, table, fields) {
  if (!FIELD_MAPS[table]) throw new Error(`${label}: "${table}" is not a content table (FIELD_MAPS)`);
  const mapped = new Set(Object.values(FIELD_MAPS[table]));
  const declared = new Set(fields.filter(f => f.widget !== 'list').map(f => f.name));
  for (const f of declared) {
    if (!mapped.has(f)) throw new Error(`${label}: field "${f}" not in FIELD_MAPS.${table}`);
  }
  for (const m of mapped) {
    if (!declared.has(m)) throw new Error(`${label}: FIELD_MAPS.${table} key "${m}" missing from editor fields — saves would wipe it`);
  }
}
for (const [key, spec] of Object.entries(COLLECTIONS)) {
  assertFieldsMatch(`collections.${key}`, spec.table, spec.fields);
  const listFields = spec.fields.filter(f => f.widget === 'list').map(f => f.name);
  if (spec.nested) {
    // The editor's child lists must be exactly what replaceProjects/loadProjects read.
    const expected = Object.keys(PROJECT_CHILDREN).sort().join(',');
    if (listFields.slice().sort().join(',') !== expected) {
      throw new Error(`collections.${key}: list fields [${listFields}] must equal PROJECT_CHILDREN [${expected}] — a mismatch would wipe child rows on save`);
    }
  }
  for (const f of spec.fields.filter(f => f.widget === 'list')) {
    const child = spec.childTables?.[f.name];
    if (!child) throw new Error(`collections.${key}: list field "${f.name}" has no childTables entry`);
    assertFieldsMatch(`collections.${key}.${f.name}`, child, f.fields);
  }
}

// Site settings singleton fields (the settings editor). Guarded against
// FIELD_MAPS.site_settings below like the list editors: a column not
// declared here (or in APPEAL_SETTINGS_FIELDS) would be NULLed on the next
// save. Each editor saves { ...current, ...itsOwnFields } so the other's
// fields survive.
export const SETTINGS_FIELDS = [
  ['orgName', 'Organization Name'],
  ['orgNameShort', 'Short Name'],
  ['email', 'Contact Email'],
  ['instagram', 'Instagram URL'],
  ['footerTagline', 'Footer Tagline'],
  ['copyright', 'Copyright Line'],
  ['turnstileSiteKey', 'Turnstile Site Key (blank = no CAPTCHA widget)'],
];
// Download modal copy (templates/partials/footer.html) — edited on the
// Donation appeals page, not Site Settings. [key, label, widget?, hint?]
export const APPEAL_SETTINGS_FIELDS = [
  ['downloadModalTitle', 'Title', 'text', 'e.g. "Your download has started." Blank = no modal on the site.'],
  ['downloadModalBody', 'Body', 'textarea'],
  ['downloadModalCta', 'Button label', 'text', 'Links to the homepage donate section'],
  ['downloadModalDismiss', 'Dismiss label', 'text', 'e.g. "Not now"'],
];
// Header + footer menus (JSON) — edited on the Menus page (app/navigation),
// not Site Settings. Both other settings editors merge `before`, so it rides
// through their saves untouched (docs/systems/navigation.md).
export const NAVIGATION_SETTINGS_FIELDS = [['navigation', 'Menus']];
{
  const mapped = new Set(Object.values(FIELD_MAPS.site_settings));
  const declared = new Set([...SETTINGS_FIELDS, ...APPEAL_SETTINGS_FIELDS, ...NAVIGATION_SETTINGS_FIELDS].map(([k]) => k));
  for (const k of declared) if (!mapped.has(k)) throw new Error(`SETTINGS_FIELDS: "${k}" not in FIELD_MAPS.site_settings`);
  for (const k of mapped) if (!declared.has(k)) throw new Error(`SETTINGS_FIELDS: FIELD_MAPS.site_settings key "${k}" missing — saves would wipe it`);
  for (const [k] of SETTINGS_FIELDS) if (APPEAL_SETTINGS_FIELDS.some(([a]) => a === k)) throw new Error(`"${k}" is in both SETTINGS_FIELDS and APPEAL_SETTINGS_FIELDS`);
}

// Homepage singleton groups (flat string fields inside each group). The press
// cards derive from the press list (featured) — docs/systems/press.md.
// page: 'appeals' — the group is edited on that admin page (app/appeals);
// the Homepage editor skips it and preserves it on save.
export const HOMEPAGE_GROUPS = [
  { key: 'hero', title: 'Hero', fields: [
    ['headline', 'Headline', 'textarea', 'HTML allowed (line breaks with <br />)'],
    ['subtitle', 'Subtitle', 'textarea'],
    ['cta_primary', 'Primary button label'],
    ['cta_secondary', 'Secondary button label'],
  ]},
  { key: 'mission', title: 'Mission', fields: [['quote', 'Quote', 'textarea']] },
  { key: 'about', title: 'About', fields: [
    ['title', 'Title'], ['body1', 'Paragraph 1', 'textarea'],
    ['body2', 'Paragraph 2', 'textarea'], ['body3', 'Paragraph 3', 'textarea'],
    ['quote', 'Quote', 'textarea'],
  ]},
  { key: 'join', title: 'Join / Get Involved', fields: [
    ['title', 'Title'], ['body', 'Body', 'textarea'],
    ['item1', 'Item 1'], ['item2', 'Item 2'], ['item3', 'Item 3'], ['item4', 'Item 4'],
  ]},
  { key: 'donate', title: 'Homepage donate section', page: 'appeals', fields: [
    ['label', 'Label'], ['title', 'Title'], ['body', 'Body', 'textarea'],
  ]},
  { key: 'modal', title: 'Homepage timed modal (7.5 s after arrival)', page: 'appeals', fields: [
    ['badge', 'Badge'], ['title', 'Title'], ['body', 'Body', 'textarea'], ['cta', 'CTA label'],
  ]},
  // The petition campaign group left the homepage on 2026-10-10: petitions are
  // a collection now (PETITION_FIELDS below, docs/systems/petition.md).
];


// Group-level drift guard: every JSON group column must have an editor group
// and vice versa (a group missing here would be NULLed on save). Field-level
// keys inside a group are template-defined (templates/index.html) — adding
// one there means adding it to HOMEPAGE_GROUPS in the same commit.
{
  const cols = new Set(HOMEPAGE_GROUP_COLS.map(([, key]) => key));
  const groups = new Set(HOMEPAGE_GROUPS.map(g => g.key));
  for (const k of groups) if (!cols.has(k)) throw new Error(`HOMEPAGE_GROUPS: "${k}" is not a homepage column`);
  for (const k of cols) if (!groups.has(k)) throw new Error(`HOMEPAGE_GROUPS: homepage column "${k}" has no editor group — saves would wipe it`);
}

// Petitions (docs/systems/petition.md, packages/db/petitions.js): one row per
// petition, edited on its own page (app/petitions/[id]). [name, label, widget,
// hint] like the homepage groups; `group` headings split the long form.
// slug / project_slug / status / featured are rendered by the page itself.
export const PETITION_FIELDS = [
  ['label', 'Eyebrow label', 'text', 'e.g. Unofficial Petition'],
  ['headline', 'Headline', 'textarea', 'HTML allowed: <em>word</em> turns red. Shown on the petition page, the project page and (when featured) the homepage hero.'],
  ['body', 'Body', 'textarea', 'The provision and the ask. Shown on the petition page, the project card and the hero.'],
  ['cta', 'Sign button label', 'text', 'e.g. Sign the petition now'],
  ['cta_secondary', 'Secondary link label', 'text', 'blank = no secondary link'],
  ['cta_secondary_url', 'Secondary link URL', 'text', 'e.g. /projects/alpr/report'],
  ['count_label', 'Signature counter', 'text', 'Shown once at least one Utahn has signed. {count} becomes the number of UTAH signatures (ZIP 84xxx); out-of-state signatures are kept but not counted. Blank = no counter.'],
  ['form_title', 'Form title', 'text', 'Heading of the sign-up panel. Also the page title and the headline of the link preview when the page is shared. Blank = Sign the petition'],
  ['form_intro', 'Form intro', 'textarea'],
  ['consent', 'Consent line under the sign button', 'textarea', 'What signers agree to — keep it true to how the list is used.'],
  ['closed_body', 'Closed message', 'textarea', 'Shown in place of the form once the petition is closed. Blank = "Thank you to everyone who signed. It is no longer taking signatures."'],
  ['thanks_title', 'Thank-you page title', 'textarea'],
  ['thanks_body', 'Thank-you page body (the donation ask)', 'textarea'],
  ['thanks_cta', 'Thank-you page: help button label', 'text', 'e.g. I can help — opens the payment window'],
  ['thanks_dismiss', 'Thank-you page: decline label', 'text', 'e.g. Not this time'],
  ['donate_title', 'Payment window: title', 'text', 'Blank = "Carry this fight through the legislature"'],
  ['donate_body', 'Payment window: text', 'textarea', "Blank = \"Choose an amount. You'll finish on our secure Stripe checkout page.\""],
  ['donate_amounts', 'Payment window: amounts', 'text', 'Dollars, separated by commas, e.g. 5, 10, 25, 50. Up to six. An "Other" button for any amount is always added. Blank = 10, 25, 50, 100.'],
  ['donate_default', 'Payment window: pre-selected amount', 'text', 'One of the amounts above, e.g. 25'],
  ['donate_frequency', 'Payment window: one-time or monthly', 'text', 'both (shows a One-time / Monthly switch), one-time, or monthly. Blank = both.'],
  ['donate_default_frequency', 'Payment window: starts on', 'text', 'one-time or monthly — which side of the switch is selected first. Blank = one-time.'],
  ['donate_custom_label', 'Payment window: custom amount button', 'text', 'Blank = Other'],
  ['donate_button', 'Payment window: checkout button', 'text', 'Blank = Continue to checkout'],
  ['donate_public_label', 'Payment window: public donor checkbox', 'text', 'Blank = Show my first name and amount on the public donor list'],
  ['share_title', 'Share: heading', 'text', 'Above the share buttons on the petition page and the thank-you page. Blank = Share the petition'],
  ['share_text', 'Share: message', 'textarea', 'Pre-filled in X, Bluesky, texts and emails (Facebook uses the page preview). Blank = the headline. The link is added automatically.'],
  ['share_image', 'Share: preview image', 'text', 'The picture shown when the link is posted. A Media Library path, e.g. /media/…/1200.jpg — 1200×630 works best. Blank = the logo on navy.'],
];
// Where each field group starts on the editor page (field name → heading).
export const PETITION_FIELD_GROUPS = { label: 'The petition', form_title: 'Sign-up form', thanks_title: 'Thank-you page', donate_title: 'Payment window', share_title: 'Sharing' };
export const PETITION_RECORD_FIELDS = ['slug', 'project_slug', 'status', 'featured']; // rendered by the page itself
{
  const mapped = new Set(Object.values(FIELD_MAPS.petitions));
  const declared = new Set([...PETITION_RECORD_FIELDS, ...PETITION_FIELDS.map(([k]) => k)]);
  for (const k of declared) if (!mapped.has(k)) throw new Error(`PETITION_FIELDS: "${k}" not in FIELD_MAPS.petitions`);
  for (const k of mapped) if (!declared.has(k)) throw new Error(`PETITION_FIELDS: FIELD_MAPS.petitions key "${k}" missing from the editor — saves would wipe it`);
}
