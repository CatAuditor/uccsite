# 2026-10-06 — Document published as bare text: foreign per-page classes stripped

## Symptom

`/license-plate-has-a-price` (document `fd028a95…`, published 01:36 MDT)
renders as a correct hero followed by unstyled text: no byline strip, no
table-of-contents box, no spacing, buttons as plain links.

## Where

- `html-ingest` (`partitionClasses`) on save and again on publish
  (`composeDocument`): classes not in `knownClasses` (site stylesheet +
  the document's own page CSS) are moved to `report.foreignClasses` and
  dropped from the markup.
- Stored row: `page_css` empty; raw body uses `hero-ctas`, `hero-secondary`,
  `paper-body`, `paper-inner`, `release-meta`, `release-badge`,
  `release-date`, `release-author`, `paper-toc`, `paper-toc-label`,
  `ask-box`, `ask-box-label`, `sources-list`, `related-cta`, `btn-file`;
  `ingest_report.foreignClasses` lists all 17; `removed`, `a11y`, `warnings`
  empty. Only `subpage-hero` and `section-label` survived.

## Root cause

The writing tool (Claude, given the authoring kit) imitated the markup of
the live `how-did-this-happen` page instead of the kit's frame. That page's
classes live in its private per-page CSS (`page_css` of that document /
its template's `<style>`), not in `css/styles.css`, so they are unknown to
every other document. No `section > container > prose` frame was used
either, so even the surviving text had no prose styling.

## Fix

- Kit (`apps/admin/lib/authoring-kit.js`): section 5 "Never" gains a bullet
  naming the per-page classes and the rule "do not fetch a live page and
  imitate its markup"; the Claude instructions and 6.5 repeat it.
- Body rebuilt on the frame (user asked, 2026-10-06 19:30 MDT) with a
  one-off script mirroring `saveDocument` (ingest with the live CSS, upsert,
  revision snapshot, audit row `via: scripts/_save-lp.mjs`, script not kept):
  hero `<p>` byline + `btn btn-ghost` links; `section.section.bg-cream >
  div.container > div.prose`; `callout` + `callout-label` for the table of
  contents and the "For lawmakers" ask (the `<h2 id="ask">` moved above the
  box because `.prose h2` is navy on navy inside `callout-dark`); plain
  `<ol>` for sources; `callout` with `btn btn-outline btn-sm` links for the
  related paper. Ingest: 0 removed / 0 foreign / 0 a11y. Publish Lambda
  invoked: 2 changed. Previous body is revision `2026-10-06 19:29 MDT`.

## What would catch it earlier

The ingest report already listed the 17 foreign classes on the Documents
editor; a save with foreign classes could show a louder banner ("17 classes
removed; the page will render unstyled") and the Request-publish button
could ask for confirmation when `foreignClasses.length > 0`.
