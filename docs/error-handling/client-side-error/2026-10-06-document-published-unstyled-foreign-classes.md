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
- The document body still has to be rebuilt on the frame (not done here;
  content edit, user's call): hero `<p>` for the byline, `callout` with
  `callout-label` for "In this statement", `callout-dark` for the ask box,
  plain `<ol>` for sources, `btn btn-ghost` in the hero, `btn btn-outline
  btn-sm` for the source links.

## What would catch it earlier

The ingest report already listed the 17 foreign classes on the Documents
editor; a save with foreign classes could show a louder banner ("17 classes
removed; the page will render unstyled") and the Request-publish button
could ask for confirmation when `foreignClasses.length > 0`.
