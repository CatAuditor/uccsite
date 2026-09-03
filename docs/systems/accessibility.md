# Accessibility & Layout Stability

Conventions for keeping the accessibility tree well-formed and CLS low. Apply these in `templates/*.html` (the build copies them to `dist/`).

## Accessibility tree

- **One `<main id="main">` per page.** Wrap the primary content (after `<header>`, before `<footer>`). Without it, screen readers have no main landmark.
- **No heading skips.** Document order must be `h1 → h2 → h3 …` with no gaps. The homepage was `h2 → h4` on the Issues section; issue-card titles are now `h3`.
- **Decorative SVGs get `aria-hidden="true"`.** All inline icon SVGs (issue icons, checkmarks, social icons) are decorative — text follows them. Hiding them keeps unnamed graphic nodes out of the tree.
- **Toggle buttons expose state.** `.nav-toggle` carries `aria-label`, `aria-expanded`, `aria-controls`; `js/main.js` flips `aria-expanded` on open/close.
- **Form inputs need a `<label for>`** (already true site-wide).

### Known remaining gaps
- Footer column headings are `<h5>` after `<h3>` (level skip). Fixing requires changing both the tag and the `.footer-col h5` CSS selector.
- `--gray-400` (#9CA3AF) on white/cream is ~2.5:1 — fails WCAG AA for small `.press-date` / `.fight-region` labels. Darken toward `--gray-600` to fix.

## Cumulative Layout Shift (CLS)

- **Every `<img>` needs intrinsic `width`/`height`** so the browser reserves space before decode, even when CSS overrides the rendered size. `UCC.png` is `1407×768`.
- Reveal animations (`[data-animate]`) use only `opacity`/`transform` — composited, no layout shift. Keep it that way; never animate layout properties (height, margin, top).
- Low-impact watch items: Google Fonts `display=swap` (font-swap reflow) and the `.scrolled` header resize on scroll.

## Measuring

Runtime CLS / a11y traces need the `chrome-devtools` MCP server:
```json
"chrome-devtools": { "type": "local", "command": ["npx", "-y", "chrome-devtools-mcp@latest"] }
```
Then audit via the `web-perf` skill against a served `dist/`.
