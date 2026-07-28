# Utah Civic Compact — Style Guide

Reference for building external tools/pages that visually match the UCC site. All values are pulled directly from `css/styles.css`, `index.html`, and `js/main.js`. If you only take one thing away: the site is a **navy + red + cream** editorial system, Inter for everything structural, Playfair Display for quotes/emotional moments.

---

## TL;DR — the "close enough, doesn't clash" minimum

You don't need to replicate the whole system. Get these ~6 things right and an external tool will read as part of the site. Everything below this section is for fine-tuning only.

```css
/* 1. Load Inter (skip Playfair unless you have quotes) */
/* <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"> */

:root {
  --navy-dark: #0F1E33;  --navy: #1B2F4E;
  --red: #C0392B;        --red-light: #E74C3C;
  --cream: #F5F1EA;
  --gray-200: #E5E7EB;   --gray-600: #4B5563;   --gray-900: #111827;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
}

body { font-family: 'Inter', system-ui, sans-serif; color: var(--gray-900); line-height: 1.6; }
```

1. **Font:** Inter for everything. Big text = heavy (700–900) + tight (`letter-spacing:-0.02em`). Small labels = uppercase + wide (`letter-spacing:0.1em`).
2. **Color:** dark navy surfaces, cream to break up white, **red only for buttons/links/accents** — never big red fills. Body text is `--gray-600` on light, white-at-`0.6–0.85`-opacity on dark.
3. **Buttons:** solid red (`--red`), `border-radius:4px`, `padding:14px 28px`, weight 600. Hover = `translateY(-1px)` + soft shadow.
4. **Cards/panels:** white, `border-radius:12px`, `1px solid var(--gray-200)` border, `padding:32px`.
5. **Corners:** `4px` on buttons/inputs, `12px` on cards.
6. **Motion (optional but cheap):** put `transition:... var(--ease)` on hovers so easing matches.

That's it. The rest is polish.

---

## 1. Design Tokens

Defined as CSS custom properties on `:root`. Copy this block verbatim into any external tool to inherit the palette.

```css
:root {
  /* Brand */
  --navy:      #1B2F4E;   /* primary brand blue */
  --navy-dark: #0F1E33;   /* darkest — hero bg, footer, dark sections */
  --red:       #C0392B;   /* accent / CTA / labels */
  --red-light: #E74C3C;   /* hover state for red */
  --cream:     #F5F1EA;   /* warm section background */
  --white:     #FFFFFF;

  /* Neutral grays */
  --gray-50:   #F9FAFB;
  --gray-100:  #F3F4F6;
  --gray-200:  #E5E7EB;   /* default borders */
  --gray-400:  #9CA3AF;   /* muted text, placeholders */
  --gray-600:  #4B5563;   /* body copy on light bg */
  --gray-900:  #111827;   /* near-black default text */

  /* Type */
  --font-sans:  'Inter', system-ui, sans-serif;
  --font-serif: 'Playfair Display', Georgia, serif;

  /* Layout */
  --max-w: 1200px;        /* content max width */
  --section-pad: 100px;   /* vertical section padding (64px < 600px) */
  --nav-h: 72px;          /* fixed header height */

  /* Motion & shape */
  --ease: cubic-bezier(0.16, 1, 0.3, 1);  /* signature easeOutExpo-ish curve */
  --radius: 4px;          /* buttons, inputs, small elements */
  --radius-lg: 12px;      /* cards, panels, modals */
}
```

### Color usage rules
- **Red is for emphasis only** — CTAs, section labels (uppercase eyebrows), the accent word in headlines (`.hero-headline em`), links-that-are-actions. Never large fills.
- **Navy / navy-dark are the "serious" surfaces** — hero, footer, impact stats, dark cards, quote cards. White text sits on them at reduced opacity (see §3).
- **Cream** softens full-white monotony — mission strips, news sections, donate section, coming-soon blocks.
- On dark backgrounds text uses **white at fractional opacity**, not gray tokens: `rgba(255,255,255,0.85)` body, `0.6–0.65` secondary, `0.5` labels, `0.3–0.35` legal/footer-fine.

---

## 2. Typography

### Fonts
Loaded from Google Fonts in `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
```
- **Inter** (400/500/600/700/800/900) — all UI, headlines, body, buttons, labels.
- **Playfair Display** (700/800) — *only* for emotional/editorial moments: mission quote, blockquotes, modal titles. Signals "this is a human voice / a promise."

### Type scale & patterns
Body `line-height` is `1.6` globally; prose blocks bump to `1.65–1.75`.

| Role | Font | Size | Weight | Tracking | Notes |
|---|---|---|---|---|---|
| Hero headline | Inter | `clamp(40px,7vw,80px)` | 900 | `-0.03em` | `line-height:1.0`; accent word wrapped in `<em>` → red, non-italic |
| Subpage `h1` | Inter | `clamp(36px,6vw,64px)` | 900 | `-0.03em` | white on navy gradient |
| Section title | Inter | `clamp(28px,4vw,44px)` | 800 | `-0.02em` | `.section-title`, navy-dark |
| Card heading (h3) | Inter | 22px | 800 | `-0.02em` | |
| Sub-card heading (h4) | Inter | 17px | 700 | `-0.01em` | |
| Section sub / lede | Inter | 18px | 400 | — | `--gray-600`, `max-width:600px` |
| Body | Inter | 15–16px | 400 | — | `--gray-600` on light |
| **Section label (eyebrow)** | Inter | 12px | 700 | `0.12em` | **UPPERCASE, red** — the signature accent |
| Small meta / legal | Inter | 11–13px | 600–700 | `0.06–0.1em` | uppercase, `--gray-400` |
| Mission quote | Playfair | `clamp(20px,3vw,30px)` | 700 | — | centered, `line-height:1.45` |
| Modal title | Playfair | `clamp(24px,4vw,32px)` | 800 | `-0.02em` | |

**The eyebrow label** is the most reused signature element. Small red uppercase text above a big dark title:
```html
<p class="section-label">Our Mission</p>
<h2 class="section-title">Bigger, bolder statement here</h2>
```
Add `.light` modifier on dark backgrounds (turns label to `rgba(255,255,255,0.6)`, title to white).

Big headlines are **tightly tracked** (negative letter-spacing) and **heavy** (800–900). Labels/meta are **loosely tracked** (positive) and uppercase. This contrast is core to the look.

---

## 3. Layout & Spacing

- **Container:** `max-width:1200px; margin:0 auto; padding:0 48px;` → `24px` on `≤768px`. Class `.container`.
- **Section rhythm:** `.section { padding:100px 0; }`, dropping to `64px` below `600px` (via `--section-pad`). Alternate background surfaces between white / gray-50 / cream / navy to segment the page.
- **Fixed header offset:** header is `position:fixed`, height `72px`. Heroes pad top by `120–160px` to clear it.
- **Grids:** feature grids are `repeat(3,1fr)` collapsing to 2-col (`≤1000px`) then 1-col (`≤600px`). Gaps `2px` (seamed/bordered grids like pillars) or `24px` (spaced cards).
- **Common breakpoints:** `1000px`, `900px`, `860px` (mobile nav switch), `768px`, `640px`, `600px`, `480px`.

---

## 4. Buttons

Base `.btn` is an inline-flex pill-ish button: `padding:14px 28px; border-radius:4px; font-size:15px; font-weight:600; gap:8px;` with `transition:all 0.2s var(--ease)`. Always pair with a variant.

| Class | Fill | Text | Use |
|---|---|---|---|
| `.btn-primary` | red, 2px red border | white | main CTA; hover → `red-light` + lift + red glow shadow |
| `.btn-ghost` | transparent, translucent white border | white | secondary CTA on dark bg |
| `.btn-accent` | white | navy-dark | CTA on dark bg (inverts primary) |
| `.btn-outline` | transparent, navy border | navy | secondary on light bg; hover fills navy |
| `.btn-donate` | navy, navy border | white | donate actions |
| `.btn-full` | — | — | modifier: `width:100%; center` |

**Signature hover:** `transform:translateY(-1px)` + a colored drop shadow, e.g. `box-shadow:0 8px 24px rgba(192,57,43,0.35)`. Lift + glow in the button's own color. Reuse this for any new buttons.

Nav CTAs (`.nav-cta`, `.nav-donate`) are red pills that override link styling with `!important`.

---

## 5. Cards

Two dominant card idioms:

**Bordered/hover-lift card** (`.issue-card`, `.news-card`):
```css
background: var(--white);
border: 1px solid var(--gray-200);
border-radius: 12px;      /* --radius-lg */
padding: 32px;
transition: border-color .2s, box-shadow .2s, transform .2s var(--ease);
/* hover: */ border-color: var(--red); box-shadow: 0 8px 32px rgba(0,0,0,.08); transform: translateY(-3px);
```

**Seamed grid card** (`.pillar-card` inside `.pillars-grid`): cards sit in a grid with `2px` gap over a `--gray-200` background so the gaps read as hairline dividers; the whole grid gets `border-radius:12px; overflow:hidden`. Hover just tints to `--gray-50`.

**Dark card** (`.about-card`): navy-dark fill, `radius-lg`, white Playfair blockquote, red uppercase footer attribution.

Card icon treatment (`.issue-icon`): 52px cream rounded square holding a navy SVG; on card hover it flips to red bg / white icon.

---

## 6. Dark Sections (Hero, Footer, Impact)

The hero and other dark blocks share a recipe worth replicating:

```css
/* Diagonal navy gradient base */
background: linear-gradient(135deg, var(--navy-dark) 0%, #1B3A5C 50%, #243B55 100%);
```
Layered on top (`::after`): a soft red radial glow + a faint white SVG dot/plus texture at `fill-opacity:0.03`. Subpage heroes use a simpler 2-stop version: `linear-gradient(135deg, var(--navy-dark) 0%, #1B3A5C 100%)`.

- **Hero:** `min-height:100vh`, flex-centered, content `max-width:720px`, left-aligned. Includes a pill `.hero-tag` (uppercase, red dot `::before`, translucent border) and an animated bottom `.hero-scroll-hint`.
- **Impact stats:** navy-dark band, centered flex row of big 900-weight white numbers with `1px` translucent dividers; numbers count up on scroll (see §8).
- **Footer:** navy-dark, `2fr 1fr 1fr 1fr` grid, white uppercase column headers, links at `rgba(255,255,255,0.55)` → white on hover. Social icons are 36px translucent rounded squares.

---

## 7. Forms

- **Inputs:** `padding:12px 16px; border:1.5px solid var(--gray-200); border-radius:4px; font-size:15px;`
- **Focus:** `border-color:var(--navy); box-shadow:0 0 0 3px rgba(27,47,78,0.08);` (navy focus ring — reuse this exact ring).
- **Labels:** 13px, weight 600, `--gray-600`, `margin-bottom:6px`.
- Placeholders use `--gray-400`.
- Forms live in a white `.join-form-wrap` panel (`radius-lg`, `padding:44px 40px`) often set against a navy section.
- Success state swaps the form for a centered green check disc (`#22C55E`) + heading + message.
- Segmented toggles (`.donate-type-toggle`) and tier chips (`.tier-btn`): active state = navy fill, white text.

---

## 8. Motion & Interaction

The signature easing curve `--ease: cubic-bezier(0.16, 1, 0.3, 1)` is used on essentially every transition — use it for anything new.

- **Sticky header:** transparent over hero; on `scrollY > 40` JS adds `.scrolled` → white 97%-opacity bg, `blur(12px)` backdrop, hairline shadow, and link colors flip from white to navy-dark. (`js/main.js` `onScroll`).
- **Hero parallax:** `.hero-bg` translates at `scrollY * 0.22` while hero in view.
- **Scroll-in reveals:** elements with `[data-animate]` start `opacity:0; translateY(28px)` and get `.visible` via IntersectionObserver (`threshold:0.1`, `rootMargin:'0px 0px -40px 0px'`). Cards additionally scale from `0.96`. Section labels slide in from the left instead of up.
- **Stagger:** `[data-animate-delay="1..4"]` add `0.08s` increments; JS auto-applies these to grid children.
- **Hero entrance:** `heroFadeUp` keyframe cascades tag → headline → sub → actions with increasing delays.
- **Count-up stats:** any `[data-count]` element animates from 0 with a cubic ease-out over 1400ms when 60% visible.
- **Dropdown nav:** hover-open on desktop (`min-width:861px`), click/tap-open (`.open` class) on mobile/keyboard; chevron rotates 180°; `dropdownIn` fade+slide animation.
- **Donation modal:** overlay `rgba(15,30,51,0.75)` + `blur(4px)`; card slides up `translateY(28px)→0`; auto-shows after 7.5s, dismissed per session via `sessionStorage`.

If the external tool wants to feel native, honor `prefers-reduced-motion` yourself — the base site does not gate these, so keep new motion subtle.

---

## 9. Elevation (shadows) & Radii

- **Radii:** `4px` small (buttons, inputs, chips), `8–10px` mid (icons, small panels), `12px` cards/modals, `100px`/`99px` full pills.
- **Shadow ladder** (all low-alpha, cool/neutral):
  - resting card: `0 1px 3px rgba(0,0,0,.07)`
  - hover card: `0 6px 24px rgba(0,0,0,.10)` / `0 8px 32px rgba(0,0,0,.08)`
  - button hover glow: `0 8px 24px rgba(<btn-color>,.3–.35)`
  - dropdown: `0 8px 32px rgba(0,0,0,.13), 0 0 0 1px rgba(0,0,0,.05)`
  - modal: `0 24px 80px rgba(0,0,0,.28)`

---

## 10. Quick-start snippet for an external page

```html
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
  <!-- paste the :root token block from §1, plus reset below -->
</head>
```
Baseline reset the site relies on:
```css
*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
body { font-family:var(--font-sans); color:var(--gray-900); background:var(--white); line-height:1.6; -webkit-font-smoothing:antialiased; }
a { color:inherit; text-decoration:none; }
ul { list-style:none; }
button { cursor:pointer; border:none; background:none; font:inherit; }
```

### Cheat-sheet: "make it look like UCC"
1. Inter everywhere; heavy + tight for big text, light + wide-uppercase for small labels.
2. Red uppercase eyebrow above every dark bold title.
3. Navy-dark for serious/dark surfaces; cream to break up white; red only for actions/accents.
4. White text on dark = fractional opacity, not gray.
5. `12px` radius cards, `4px` radius buttons/inputs; hover = `translateY(-1..-3px)` + soft/colored shadow.
6. Navy focus ring on inputs: `0 0 0 3px rgba(27,47,78,0.08)`.
7. Every transition uses `cubic-bezier(0.16,1,0.3,1)`.
8. Reveal content on scroll with a 28px rise + fade.
