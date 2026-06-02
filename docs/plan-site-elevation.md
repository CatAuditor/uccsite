# Site Elevation Plan

Three workstreams in priority order. Each is independent — start the next when the previous ships.

---

## 1. Staging Environment ✓

**Goal:** A live preview URL for design experiments that never touches production.

**Steps:**
1. Create a `staging` branch from `main`
2. Cloudflare Pages auto-deploys it at a preview URL (e.g. `staging.uccsite.pages.dev`) — no config needed
3. For local dev: `npx wrangler pages dev .` in the project root gives live reload with full Functions support

**Done when:** You can push to `staging`, get a live URL, and confirm production is unchanged.

---

## 2. Donation Tracker ✓

**Goal:** A progress bar (e.g. "$256 of $1,000 raised") and a short recent-donors list (first name + amount) displayed on the site.

### Backend

Add `GET /api/donations/stats` Cloudflare Function:
- Queries D1 for total `amount_cents` across all donations
- Returns the 5 most recent public donations with `first_name` and `amount_cents`
- Reads a `goal_cents` from an env var so the goal is configurable without a deploy

Add `public` column to `donations` table:
```sql
ALTER TABLE donations ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
```

Add opt-out checkbox to checkout metadata so donors can suppress their name.

### Frontend

A reusable `<donation-tracker>` section (works on `index.html` and `stratos.html`):
- Progress bar: filled width = `total / goal * 100%`
- Label: `$X of $Y raised`
- List of up to 5 recent donors: "Alex · $50", etc.
- Fetches `/api/donations/stats` on page load; fails silently if endpoint is down

**Done when:** Bar and list render correctly on both pages with live D1 data.

---

## 3. CMS (Edit Copy Without Claude) ✓

**Goal:** Edit site copy — headlines, body text, CTAs — through a browser UI that commits to git and triggers a Cloudflare redeploy.

### Approach: Decap CMS + minimal build step

**Build step:** Introduce a lightweight Node script (`build.js`) that reads content from `content/*.json` and interpolates it into HTML templates, outputting to a `dist/` folder. Cloudflare Pages build command: `node build.js`, output dir: `dist`.

**Content files:** One JSON per page (e.g. `content/homepage.json`, `content/stratos.json`) holding editable strings — headlines, body copy, CTA labels.

**Decap CMS:** A single-page admin at `/admin` backed by the GitHub API. No server required. Login via GitHub OAuth (Cloudflare Access or Decap's own Netlify Identity can handle auth). On save, Decap commits the JSON file to git → Cloudflare rebuilds → live in ~30 seconds.

### Sequence
1. Extract editable strings from HTML into `content/*.json`
2. Write `build.js` to produce identical HTML output from templates + content
3. Update Cloudflare Pages build settings
4. Add `/admin` Decap config pointing at the content files
5. Configure GitHub OAuth for Decap login

**Done when:** You can log into `/admin`, change a headline, save, and see it live without touching code.

---

## Open Questions (decide before starting CMS)

- Which strings need to be editable first? (Prioritizes what goes in content JSON)
- Acceptable to introduce a build step, or prefer GitHub web editor for raw JSON? (Simpler but less polished)
- Donation goal amount — where should it live? Env var (requires redeploy to change) or a row in D1 (editable via a future admin UI)?
