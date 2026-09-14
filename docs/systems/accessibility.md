# Accessibility & Layout Stability

Conventions for keeping the accessibility tree well-formed and CLS low. Apply these in `templates/*.html` (the build copies them to `dist/`).

## Accessibility tree

- **One `<main id="main">` per page.** Opened by `templates/partials/header.html` (after a `.skip-link`) and closed by `footer.html`, so every page that uses the partials gets it automatically. `success.html` is the only page without it.
- **No heading skips.** Document order must be `h1 → h2 → h3 …` with no gaps. Bio names (`team.html`), news/video headlines (`blog.html`) are `h2`; nested press cards on `projects.html` are `h3`; footer column headings are `h2`.
- **Decorative SVGs get `aria-hidden="true"`.** All inline icon SVGs (issue icons, checkmarks, social icons) are decorative — text follows them. Hiding them keeps unnamed graphic nodes out of the tree.
- **Toggle buttons expose state.** `.nav-toggle` carries `aria-label`, `aria-expanded`, `aria-controls`; `js/main.js` flips `aria-expanded` on open/close. Dropdown toggles get `aria-controls` at runtime and stay truthful on hover.
- **Dialogs are inert when hidden.** Both modals (the timed donate modal on the homepage and the download modal in the footer partial) share `createModal()` in `js/main.js`: `visibility:hidden` + the `inert` attribute + `aria-hidden` until shown; `aria-modal` is only present while open; focus moves to the close button and is trapped, then restored on close. The download modal opens after a `download` link click, so the page (and focus origin) stays put.
- **Form inputs need a `<label for>`** (already true site-wide).
- **Mark non-English text with `lang`.** Every page declares `<html lang="en">`, so foreign-language copy inside it (a Spanish press headline, for example) is read aloud with English pronunciation rules unless the element carries its own `lang`. Press and coverage entries take an optional `lang_attr` field for this — leave it blank for English, set it to `lang="es"` for Spanish. The templates render it as `<div class="..." {{{lang_attr}}}>`.

### Known remaining gaps
- `--gray-400` is still used for some caption/meta text on the long-form pages (`alpr.html` etc.). Bylines and date labels on index/statements/issues/projects were moved to `--gray-600` (2026-08-23).

## Cumulative Layout Shift (CLS)

- **Every `<img>` needs intrinsic `width`/`height`** so the browser reserves space before decode, even when CSS overrides the rendered size. `UCC.png` is `713×490`.
- Reveal animations (`[data-animate]`) use only `opacity`/`transform` — composited, no layout shift. Keep it that way; never animate layout properties (height, margin, top).
- Low-impact watch items: Google Fonts `display=swap` (font-swap reflow) and the `.scrolled` header resize on scroll.

## Measuring

Runtime CLS / a11y traces need the `chrome-devtools` MCP server:
```json
"chrome-devtools": { "type": "local", "command": ["npx", "-y", "chrome-devtools-mcp@latest"] }
```
Then audit via the `web-perf` skill against a served `dist/`.
