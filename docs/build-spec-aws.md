# Build Spec — utahciviccompact.org Rebuild on AWS

> Provenance: delivered by the org 2026-09-12. Transcribed from the working session;
> the original message was TRUNCATED mid-§20 ("Do not ship the …") — the tail of the
> Do-Not list and anything after it is missing and will be appended when supplied.
> Planning addenda (decisions made after spec delivery) are at the bottom of this file.

You are implementing this project. This document is the complete specification. Read all of it before writing any code.

---

## 0. Context

**Organization:** Utah Civic Compact, a 501(c)(4). The site carries advocacy work, policy positions, long-form investigative reports, a donation flow, a newsletter, and a confidential tipline.

**Current stack** (verified against the working tree, branch `refactor`, 2026-09-12):

- Cloudflare Pages, output `dist/`, `main` auto-deploys to production with no preview step
- Hand-rolled zero-dependency static site generator (`build.js`, ~264 lines) rendering 16 `templates/*.html` against `content/*.json`
- Cloudflare Pages Functions in `functions/api/`, one D1 database (`ucc-members`), one standalone Worker (`workers/auth/`) doing GitHub OAuth for Decap
- Decap CMS 3.3.3 at `/admin`, committing JSON to GitHub `CatAuditor/uccsite`
- Stripe (checkout, subscriptions, billing portal, webhook) hand-rolled with no SDK, API version pinned `2024-06-20`
- Resend for transactional email; Mailgun for the bulk periodical via a manually-run Node script
- Airtable for the tipline, proxied through a Pages Function
- One devDependency total (`wrangler`). No lockfile, no bundler, no framework, no TypeScript.

**The actual problem.** A CMS already exists. Decap edits declared JSON fields and commits to git, which works for structured content. What it cannot do is create a page. Every long-form report — `alpr.html` (47 KB), `stratos.html` (59 KB), `weber-county.html`, `privacy-report.html`, `how-did-this-happen.html`, `dignity-index-statement.html` — is a hand-written template a developer had to author and push. Six of sixteen templates are one-off documents, and given the organization's work, more are coming. **That is the gap this rebuild closes.**

Decap has two further structural problems: every key in `content/*.json` must be declared in `static/admin/config.yml` or Decap silently deletes it on save (this has already produced a live defect, §1.5), and authoring requires a GitHub account plus an OAuth Worker to broker it.

**What stays, what moves, what goes.**

| Keep | Port | Retire |
|---|---|---|
| The 16 templates and partials | `build.js` engine → `packages/render` | Cloudflare Pages |
| `content/*.json` field shapes | `functions/api/` → Lambda | Decap CMS |
| Stripe flow and webhook logic | D1 → AWS SQL (§1.2) | `workers/auth` OAuth Worker |
| Resend, Mailgun, Airtable | Mailgun script's DB read | `static/admin/` |
| `robots.txt`, `llms.txt`, JSON-LD | `_headers` → CloudFront policy | `_redirects` |

**Authoring workflow for new documents:** the author writes HTML outside this system — by hand, or with whatever external tool they prefer — and pastes it into the admin. It arrives semantic and unstyled. The admin receives it, helps apply stylesheet classes, and publishes. **No AI service, model API, or new third-party integration is part of this product.** The styling system is deterministic selector matching and a picker UI.

**How to work:**
- §1 lists open items. Resolve them before Phase 1. Some you can settle by reading the repo; those say so. Do not guess on the rest.
- Work in the phase order in §19. Stop at each Definition of Done and wait for an explicit go.
- Do not add a service, table, dependency, or abstraction not named here without asking.
- **Delete the "AWS (Amplify migration)" section of `CLAUDE.md` in Phase 0.** It describes Vite, `src/config.ts`, `amplify/` functions, `customHttp.yml`, and Cognito — none of which exist in this repo. Any session following it will hunt for files that aren't there. Replace it with a pointer to this document.

---

## 1. Open items

**1.1 — Commit the refactor branch first.** `refactor` sits at the same commit as `main` (`923568c`) with the entire refactor **staged but uncommitted**: 51 files, +1,525/−2,365, plus 13 untracked paths. Nothing is deployed; production still runs pre-refactor code. Commit before any migration work — the golden-file tests in Phase 1 need a stable baseline, and a 51-file uncommitted diff is not one.

**1.2 — Datastore. Settle this by reading `schema.sql` in Phase 0.**

The existing D1 database holds donor and payment records with relational access patterns (member ↔ subscription ↔ donation, a SUM over donations, a filtered recent-donor list). Remodeling working parameterized SQL that handles money into a document store is risk without payoff. **Stay on SQL.**

The constraint that decides which SQL: the API Lambda must reach both the database and third-party HTTPS APIs (Stripe, Resend, Airtable). If the database requires VPC placement, the Lambda goes in a VPC and then needs a NAT gateway to reach the internet — roughly $32/month plus data transfer, several times the rest of the budget combined. Avoid that.

- **Default: Aurora DSQL.** Postgres-compatible, IAM auth, no VPC placement required, scales to zero with no hourly floor, ongoing free tier of 100,000 DPUs and 1 GB storage per month with no expiry — comfortably above this workload. GA since May 2025.
- **Check before committing:** DSQL does not support foreign keys, triggers, sequences, stored procedures, or materialized views. Read `schema.sql`. If it uses only `IF NOT EXISTS` tables, UNIQUE constraints, and indexes — which is what the current tree describes — DSQL is clean, and SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT` becomes a UUID primary key. That is the only expected schema change.
- **Fallback if `schema.sql` uses foreign keys or triggers:** Aurora Serverless v2 Postgres via the **RDS Data API**, which is HTTPS and also avoids VPC placement. Note that Serverless v2 scale-to-zero carries a ~15 second resume, unacceptable on the Stripe webhook path; either set a 0.5 ACU floor (~$44/month) or keep a scheduled warm ping. Raise this before choosing it.

Report which applies at the end of Phase 0.

**1.3 — Public donation total.** `/api/donations/stats` currently SUMs **all** donation rows regardless of the `public` flag; only the recent-donor *list* respects it. The headline figure therefore includes private donors. This may be intended — an aggregate is arguably not disclosure — or it may be exposure the organization would not choose. **This is a policy question for the org, not a bug to fix unilaterally.** Ask, then implement the answer.

**1.4 — Which pages become admin-editable.** The spec assumes the six long-form reports become editable Documents (§3.2) and the ten collection-driven pages keep developer-owned templates (§3.3). Confirm. In particular confirm `tip.html` and `success.html`, which have unusual requirements — noindex and out-of-sitemap, and no header or footer at all, respectively.

**1.5 — Defects to fix during the port, not carry forward.**
- **Homepage featured statement renders a dead link.** `templates/index.html` renders `href="{{url}}"` and `{{more}}`, but `build.js`'s derived-statement mapping passes only `{slug, date, title, snippet}` — so the card ships as `href="#"` with an empty read-more line. Two decision docs contradict each other on this (`homepage-statement-card-links.md` versus `homepage-statement-derived.md`). Fix the mapping, then reconcile the ADRs.
- **Three un-migrated templates.** `how-did-this-happen.html` and `dignity-index-statement.html` hardcode header and footer and load `js/main.js` by relative path; `success.html` has no header or footer. Migrate the first two to partials during the port. Decide `success.html` per §1.4.
- **Team photo stripping** — `config.yml`'s team collection omits the `photo` field, so the first CMS save deletes all three headshots. This disappears structurally when Decap does. No action beyond not reintroducing a schema-declaration layer.

---

## 2. Architecture

```
                    ┌──────────────────────────────────────┐
   Public ─────────►│      CloudFront distribution          │
  utahciviccompact  │                                       │
       .org         │  default   → S3 site bucket (static)  │
                    │  /assets/* → S3 media bucket (immut.) │
                    │  /api/*    → Lambda Function URL      │
                    │  CF Function: URL rewrite, redirects  │
                    └──────┬───────────────────┬────────────┘
                           │                   │
                    ┌──────▼──────┐     ┌──────▼───────────────┐
                    │ S3 site     │     │ api Lambda           │
                    │ rendered    │     │ subscribe, unsub,    │
                    │ .html       │     │ tip, checkout,       │
                    └──────▲──────┘     │ portal, webhook,     │
                           │            │ donations/stats      │
                           │ Put +      └──────┬───────────────┘
                           │ Invalidate        │
                    ┌──────┴─────────────┐     │
                    │ publish Lambda     │     │
                    │ render all → diff  │     │
                    │ → put → invalidate │     │
                    │ → verify hash      │     │
                    └──────┬─────────────┘     │
                           ▼                   ▼
                    ┌──────────────────────────────────────┐
                    │  SQL (§1.2) — content + members       │
                    └──────────────────────────────────────┘
                                   ▲
   Admins ─────────► Amplify Hosting: apps/admin (Next.js 15)
  admin.utahciviccompact.org       + Cognito
```

**Infrastructure as code: CDK for everything. Amplify is used for hosting the admin app only.**

Amplify Gen 2's backend (`defineData`, AppSync, DynamoDB) is not used. Its main draw is a generated GraphQL client over DynamoDB, and §1.2 puts the data in SQL, where the admin queries directly from server actions. One IaC tool and no GraphQL layer is closer to how this codebase already works.

### 2.1 Why the public site is not on a framework

The site is already statically generated from JSON by a 264-line dependency-free script, and it works. Adding React to render content currently rendered by string substitution would be churn.

There is also a platform reason to avoid Amplify Hosting for the public site specifically: **Amplify Hosting does not support Next.js on-demand ISR.** `revalidatePath` and `revalidateTag` do not purge its cache. A framework site there would need a full rebuild on every publish — minutes of latency and a fuzzy answer to "did my post go live." S3 plus CloudFront gives publish-to-live in under a minute, with a result verifiable by hashing the object back.

**Amplify Hosting does host the admin app.** It is dynamic, authenticated, and never cached — the workload Amplify handles well, where its cache-purge limitation is irrelevant.

---

## 3. Content model

Three kinds of content with different handling. Getting this boundary right is the most important structural decision in the build.

### 3.1 Collections — structured records

`settings`, `homepage`, `team`, `statements`, `issues`, `projects`, `blog`, `coverage`.

Typed records with typed fields. They already work well under Decap and the field shapes in `content/*.json` are correct. Port them as database tables with the same field names and give the admin a proper typed form per collection.

Markdown handling stays exactly as it is: only `members.bio`, `statements.body`, and `issues.body` are markdown, processed escape-first through the same subset (`**bold**`, `*italic*`, `[link](url)`, paragraphs, `\n` → `<br />`).

**Collections do not get pasted HTML and do not touch the styling layer.** A team bio is a structured field with a headshot that feeds two pages; turning it into a pasted HTML blob would be a regression.

The `config.yml` declaration requirement disappears — the database schema is the schema, and adding a field is a migration rather than a silent data-deletion hazard.

### 3.2 Documents — long-form pages

`alpr`, `stratos`, `weber-county`, `privacy-report`, `how-did-this-happen`, `dignity-index-statement`, and everything like them from here on.

A Document is a **body fragment** pasted into the admin: no `<html>`, `<head>`, `<body>`, no inline `style` attributes. It carries its own SEO fields, its own JSON-LD, an optional per-page stylesheet, and a template key. This is the new capability — creating one requires no developer and no git.

**Per-page CSS:** the current report pages carry large inline `<style>` blocks, which is why the site CSP allows `style-src 'unsafe-inline'`. In the new model a Document's page-specific CSS is a separate managed asset, fingerprinted and served as a file. That lets the CSP tighten to `style-src 'self'` — a real security improvement that falls out of the migration.

### 3.3 Fixed pages — developer-owned templates

`index`, `team`, `blog`, `statements`, `issues`, `projects`, `theory`, `privacy`, `tip`, `success`.

Templates that render collections. Admins edit their **content** through collections; they do not edit the templates. **The admin must not expose template editing for these.** That boundary keeps the site's structure sound while content stays open.

---

## 4. Rendering

### 4.1 Port the existing engine, do not replace it

`build.js`'s template engine moves into `packages/render` substantially as-is. It is ~264 lines of dependency-free JavaScript with fail-fast validation, and it is already correct. Preserve:

- `{{var}}` HTML-escaped, with names matching `/(^|_)url$/` additionally run through `safeUrl()`
- `{{{var}}}` raw
- `{{#sec}}` / `{{^sec}}` loops and conditionals with nesting
- `{{> partial}}` from `templates/partials/`, memoized
- Dot-path resolution
- `escapeHtml()` and `safeUrl()` (allows only `http(s):`, `mailto:`, `/`, `#`; everything else → `#`)
- `MARKDOWN_FIELDS` and the markdown subset
- Fail-fast validation — JSON parse errors, missing templates, missing content, missing partials, unclosed sections all abort before anything is written
- Sitemap generation with `sitemap: false` honored (`tip`, `success`) and per-page `priority`
- Derived content: `homepage.statements` from the newest `statements` entry, **with `url` and `more` added** (§1.5)

The `PAGES` manifest becomes a database-driven page list, but merge semantics stay identical.

**Phase 1 gates on golden-file tests:** render the committed `content/*.json` through the ported engine and diff against current `dist/` output. Byte-identical except for the §1.5 fixes, each asserted explicitly.

### 4.2 Composition

```
<!doctype html>
<html lang="en">
<head>
  {template head}
  {generated SEO block}          ← §12, generated from structured fields
  {generated JSON-LD}
  <link rel="stylesheet" href="{fingerprinted site css}">
  {optional per-page css link}   ← Documents only
</head>
<body>
  {> header partial}
  <main id="main">{content}</main>
  {> footer partial}
</body>
</html>
```

For Documents, `{content}` is the styled body HTML (§6). For fixed pages it is the template output. Header and footer come from `templates/partials/`, which already carry the skip link, sticky header, mobile toggle, About Us dropdown, dark and light logo variants, `aria-current` via `{{#current.<page>}}`, the 501(c)(4) disclaimer, and the registered-lobbyist disclosure. All preserved.

---

## 5. Document ingest

Runs on save, so the editor gets immediate feedback, and again on publish, so nothing bypasses it. Lives in `packages/html-ingest` as pure functions. **Documents only** — collections never pass through it.

1. **Parse** with `parse5`. Reject unparseable input, citing the line number.
2. **Extract body** if a full document was pasted; warn rather than fail silently.
3. **Sanitize — allowlist only.** Use `sanitize-html` with an explicit config, never defaults. This is the one place hand-rolling is genuinely dangerous; the existing `escapeHtml`/`safeUrl` helpers are correct for their jobs but are not an HTML sanitizer.

   *Allowed tags:* `div section article aside header footer figure figcaption h1-h6 p span strong em b i u s blockquote code pre br hr small sub sup time mark ul ol li dl dt dd table thead tbody tfoot tr th td caption img picture source a details summary`

   *Allowed attributes:* `class id href src srcset sizes alt title width height loading decoding datetime colspan rowspan lang dir aria-* role data-*`

   *Stripped unconditionally:* `<script> <style> <iframe> <object> <embed> <form> <input> <link> <meta> <base>`, every `on*` handler, and the `style` attribute.

   *URL schemes:* reuse `safeUrl()`'s allowlist — `http(s):`, `mailto:`, `/`, `#` — plus `tel:`. Reject `javascript:` and `data:`.

   **Pasted HTML is untrusted even though the author is authenticated.** An admin account is one phished password away from stored XSS on every page.

4. **Assign node ids.** Give every element a `data-nid`: an 8-character hash of `(tagName, depth, ordinal-among-siblings, first 64 chars of text content)`. Deterministic.

   On re-paste, tree-match against the previous normalized tree to carry ids forward — exact `(tag, text)` first, then `(tag, position)`, then a new id. Report it: "24 elements matched, 3 new, 1 removed." New elements are flagged unstyled.

   `data-nid` is stripped at compose and never reaches a published page.

5. **Partition classes.** Known (present in the Style Kit, §6.1) are kept at priority 0. Foreign are stripped and recorded in `ingest_report.foreign_classes` with the nid. Surface them — "12 classes removed that aren't in your stylesheet" — and offer a mapping stored in `foreign_class_map`, so the same substitution happens automatically next paste.

6. **Rewrite assets.** Map relative `src`/`href` pointing at uploaded media to fingerprinted CDN URLs. Flag external-domain `src` — a hotlinked image is a future broken page.

7. **Accessibility gate — blocks publish.** `<img>` without `alt`; more than one `<h1>`; skipped heading levels. `docs/systems/accessibility.md` is the reference for what the site already commits to.

8. **Report, never silently drop.** Return a diff of everything removed: "3 elements removed: 1 `<script>`, 2 inline `style` attributes." An editor who does not know their code was stripped will re-paste it forever.

9. **Store** `body_html_raw` (untouched), `body_html_normalized`, and `ingest_report`.

**YouTube embeds:** `blog.json` carries video entries and `<iframe>` is stripped by the sanitizer. Embeds come from the template via the existing video-entry field, or from a placeholder token (`{{video:ID}}`) replaced at compose. The CSP already allows YouTube-only frames; keep that.

**Script escape hatch:** a per-Document `allow_scripts` flag, `owner` role only, permitting `<script src="…">` from an allowlisted domain set. Never inline script. Default off. Every use audited. The current CSP is `script-src 'self' https://static.cloudflareinsights.com` with no `unsafe-inline` — preserve that strictness, and drop the Cloudflare Insights source once off Cloudflare.

---

## 6. Styling layer (Documents only)

Pasted HTML arrives naked. Making editors memorize the class vocabulary of a 1,584-line stylesheet is the friction this removes.

**Styling is stored separately from content and applied at compose time. Never write classes into `body_html_raw`.** Authors revise pages in their external tool and paste the new version in; if classes are baked into stored HTML, every re-paste destroys them.

```
  body_html_raw          exactly what was pasted. never mutated.
       │  ingest (§5)
  body_html_normalized   sanitized, data-nid assigned
       │  applyStyles(normalized, styleMap, styleKit)   ← pure
  body_html_styled       classes applied, regenerated every compose
       │  compose (§4.2)
  published document
```

### 6.1 Style Kit

`.lead { font-size: 1.25rem }` does not tell an editor it belongs on the intro paragraph. Annotate `css/styles.css` — which already has ~24 commented sections, so the convention is half-established — with structured comments that `packages/style-kit` parses into a catalog.

```css
/* @class lead
   @label Lead paragraph
   @applies p
   @group Typography
   @desc Larger intro paragraph. Use on the first paragraph after the page title. */
.lead { font-size: 1.25rem; line-height: 1.5; }
```

```ts
type StyleKitEntry = {
  className: string
  label: string
  applies: string[]        // tags this is valid on; empty = any
  description: string
  group?: string
  declarations: string     // parsed from the rule, shown on hover
}
```

Unannotated classes are still catalogued, with `label` defaulting to the class name. Show an "N classes undocumented" nudge so the vocabulary improves over time. Developer task, once per stylesheet.

### 6.2 Rules

```ts
type StyleRule = {
  id: string
  scope: 'template' | 'page'
  templateKey?: string
  documentId?: string
  selector: string
  classes: string[]        // must exist in the Style Kit
  priority: number
  note?: string
}
```

Rules match structure, not node identity, so they survive re-pasting completely.

**Template-scoped rules are the point of the system.** Defined once against the long-form report template — `main > h1 → .report-title`, `main > p:first-of-type → .lead` — every Document using that template is styled on arrival. A freshly pasted report should land 70–90% styled with no editor action. **Build rule authoring before polishing the per-element UI.**

Match with `css-select` over `parse5`/`domhandler`. Support only tag, class, descendant, child, `:first-of-type`, `:last-of-type`, `:nth-of-type()`, `:not()`. Reject anything else at save time. Arbitrary selector support is a debugging liability, not a feature.

### 6.3 Overrides

```ts
type StyleOverride = { documentId: string; nid: string; classes: string[]; mode: 'replace' | 'append' }
```

One-off exceptions — the literal line-by-line surface. These can be orphaned by a re-paste; §5.4's match report says which.

### 6.4 Resolution

Per element: matching rules in ascending priority, union their classes, then the override (`append` adds, `replace` wins). Known classes surviving from the pasted HTML count as priority 0. `applyStyles` lives in `packages/style-apply` — pure, snapshot tested.

### 6.5 Editor UI

Split view: element tree left, live preview right.

**Element tree** — one row per element: depth indentation, tag, first ~40 characters of text, classes as chips. Rule-derived chips visually distinct from override chips, source rule on hover. Rows with no classes and no matching rule marked unstyled.

**Class picker** — search, grouped by Style Kit `group`, filtered by `applies` with a show-all toggle. Hover shows description and declarations.

**Bulk actions from a row:** apply to all siblings with the same tag; apply to all elements with this tag in this document; **promote to template rule**, which opens a dialog with a generated editable selector and the match count across every Document using that template.

Promote-to-rule is how the rule set grows without hand-authoring selectors. Style one document manually, promote the patterns, and the next arrives nearly done.

**Live preview** — the composed document in an `iframe srcdoc` with the real stylesheet. Hovering a tree row outlines the element; clicking an element in the preview selects its row. **Without this the tool is a spreadsheet and editors will not use it.**

**Pre-publish check** — count of unstyled elements, shown but not blocking.

---

## 7. Publish pipeline

The site is small — 16 pages today, perhaps 30 after several new Documents. That changes the design usefully: **render the whole site on every publish, hash each output, and PUT plus invalidate only the objects whose hash changed.** No dependency graph, no per-path bookkeeping, and derived content like the homepage featured statement updates correctly by construction. `build.js` renders the entire site in well under a second today.

On publish:

1. Load all content from the database.
2. Render every page through `packages/render`, running ingest and `applyStyles` for Documents.
3. Strip all `data-nid`.
4. Generate `sitemap.xml`, `robots.txt`, `llms.txt`.
5. Hash every output. Compare against the stored `live_hash` per path.
6. For changed paths only: `PutObject` with `Cache-Control: public, max-age=0, s-maxage=31536000, must-revalidate` — browsers revalidate every request, CloudFront holds until invalidated.
7. `CreateInvalidation` for the changed paths, batched into one request. If more than 15 paths changed, issue a single `/*` wildcard instead — it counts as one path.
8. Poll `GetInvalidation` until `Completed` (typically 10–60s), 5-minute timeout.
9. `GetObject` each written key, hash it, confirm it matches. Write `live_hash`, `live_at`, `invalidation_id`.
10. Return status to the admin.

**The admin shows one of four states per page:** `Draft`, `Publishing…`, `Live (hh:mm)`, `Failed — <reason>`. `Live` appears only when the verified hash matches. That is the whole answer to "did my post register."

**Fail-fast is preserved.** As in `build.js` today, any render or validation error aborts the entire publish before a single object is written. A partially-published site is never a valid state.

**Drift reconciler:** hourly EventBridge Lambda walks published paths, fetches each live object, compares hashes, re-publishes and logs mismatches. A dropped invalidation cannot leave a page silently stale.

**Invalidation budget:** the first 1,000 paths per month are free account-wide, then $0.005 per path; a wildcard counts as one. The changed-only diff plus the wildcard threshold keeps this free at any realistic rate. Fingerprint CSS, JS, and media (`styles.a3f9c2.css`) and serve them `max-age=31536000, immutable` so they never need invalidating.

---

## 8. CloudFront and routing

- **Origins:** site bucket, media bucket, API Lambda Function URL. All S3 via Origin Access Control; buckets block public access.
- **Behaviors:** `/assets/*` → media bucket, long cache. `/api/*` → Lambda, caching disabled. Default → site bucket.
- **CloudFront Function**, viewer-request ($0.10/M with 2M free, versus $0.60/M for Lambda@Edge, and this is sub-millisecond string work): normalize trailing slashes, append `index.html`, apply redirects. Redirects come from a JSON map written to a CloudFront KeyValueStore on publish — editable in the admin with no deploy. Replaces `static/_redirects`.
- **404:** custom error response → `/404/index.html` with status **404**, not 200.
- **Response headers policy** replaces `static/_headers`. Carry the current posture forward: HSTS with preload, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `object-src 'none'`, nosniff, `Referrer-Policy`, Permissions-Policy lockdown, YouTube-only frame sources, `script-src 'self'`.
  - **Tighten `style-src` to `'self'`** once per-page CSS is a file (§3.2). Self-host Inter and Playfair Display rather than linking Google Fonts, which removes the last external style and font origin and is faster besides.
  - **The separate looser `/admin/*` CSP retires** with Decap. The new admin is on its own subdomain with its own headers. Keep `docs/decisions/csp-split-admin.md` as history, marked superseded.
- **API responses** keep their current stamping — nosniff, `Referrer-Policy`, `X-Robots-Tag: noindex`, `Cache-Control: no-store` by default. Port `_middleware.js`'s behavior into the Lambda.

---

## 9. Database

Schema follows the existing `schema.sql` closely. Keep table and column names where they are; a recognizable schema makes the SQL port mechanical.

**Ported from D1 (data migrates):**

- `members` — donors keyed to `stripe_customer_id` (UNIQUE), newsletter opt-in flag
- `subscriptions` — stripe subscription and price IDs, amount, status, period end
- `donations` — one-time and recurring payments; `public` flag drives the donor ticker. **Add an index** — there is none today.
- `subscribers` — newsletter list, separate from members
- `rate_limits` — sliding window (ip, endpoint, timestamp)
- `processed_events` — Stripe webhook idempotency

**New (content):**

- `settings`, `homepage`, `team`, `statements`, `issues`, `projects`, `blog`, `coverage` — one table per collection, columns matching current JSON field names. `projects` keeps its nested articles and videos as child tables (`project_articles`, `project_videos`) — that nesting is what "project work" refers to.
- `documents` — slug, title, template_key, `body_html_raw`, `body_html_normalized`, `ingest_report`, `page_css_key`, status, SEO fields, jsonld_type, jsonld_overrides, allow_scripts, published_at, `content_hash`, `live_hash`, `live_at`, `last_publish_error`
- `templates` — key, name, head, header_partial, footer_partial, stylesheet_key
- `style_kit`, `style_rules`, `style_overrides`, `foreign_class_map` — §6
- `media_assets` — s3_key, original_filename, mime, width, height, bytes, alt, variants JSON, uploaded_by
- `redirects` — from, to, status_code, active, note
- `revisions` — entity_type, entity_id, snapshot JSON (**must include `body_html_raw` and the resolved override set**), author, created_at. Keep the last 20 per entity. **One-click restore-and-republish is required** — it is the recovery path when someone pastes the wrong file.
- `audit_log` — actor, action, entity_type, entity_id, diff, at. Written on every mutation. This is new: Decap's audit trail was the git history, and losing that without replacement would be a regression.
- `publish_runs` — trigger, changed_paths, status, invalidation_id, started_at, finished_at, error

**Note on DSQL:** if §1.2 lands on Aurora DSQL, primary keys are UUIDs rather than autoincrement integers and there are no foreign key constraints — enforce referential integrity in the application layer. Everything else ports directly.

---

## 10. API Lambda

One Lambda behind a Function URL, routed at `/api/*`. Node runtime, outside any VPC (§1.2). This is a **port of `functions/api/`**, not a rewrite. The existing logic is careful and has been in production; preserve its behavior and its security properties.

Port `_lib.js` wholesale: the `json()` helper defaulting to `no-store`, `escapeHtml`, `isValidEmail`, `str()` cap and trim, the sliding-window rate limiter, and HMAC-SHA256 purpose-bound `signToken`/`verifyToken`. Keep `STRIPE_API_VERSION = '2024-06-20'` pinned. Keep the hand-rolled Stripe calls — there is no reason to adopt the SDK mid-migration.

| Route | Method | Rate limit | Notes for the port |
|---|---|---|---|
| `/api/subscribe` | POST | 5/hr | Upsert `subscribers`; Resend welcome email deferred past the response; RFC 8058 one-click unsubscribe headers; 1-year signed token |
| `/api/unsubscribe` | GET+POST | none | Verify token; delete from `subscribers`, set `members.newsletter_opt_in = 0`; self-contained HTML response |
| `/api/tip` | POST | 5/hr | Airtable proxy. **Confidentiality is a hard requirement: never log request or upstream response bodies — status codes only.** "Anonymous" replaces the name with the literal string; email still collected. Attachments remain unimplemented. |
| `/api/create-checkout-session` | POST | 10/hr | Inline `price_data`, $1–$100k bounds, subscription or one-time, donor prefs in metadata copied to `subscription_data.metadata` for recurring |
| `/api/create-portal-session` | POST | 5/hr | Magic link. **Always returns 202**, lookup and email deferred past the response — anti-enumeration, timing-safe. 15-minute token. |
| `/api/create-portal-session?token=` | GET | none | Verify token, mint Stripe Billing Portal session, 302 |
| `/api/webhook` | POST | none | **The highest-risk port.** Hand-rolled constant-time signature verify, 300s skew window, multi-`v1` rotation support. Idempotent via `processed_events` `INSERT OR IGNORE`, row deleted and 500 returned on handler error so Stripe retries. Compatibility shims for both old and new Stripe invoice shapes. Handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated`. **Port line by line and test against Stripe CLI replay before anything touches production.** |
| `/api/donations/stats` | GET | none | Total raised plus 3 most recent `public=1` donors; `Cache-Control: public, max-age=60`; goal from `DONATION_GOAL_CENTS`. Resolve §1.3 before porting. |

**Rate limiting fails open on database errors, by design.** Port that behavior deliberately; do not "fix" it into failing closed.

**Add Turnstile** to `/api/subscribe` and `/api/tip`. Today rate limiting is the only abuse control on public forms — there is no CAPTCHA, honeypot, or timestamp check anywhere. This is the one net-new security control in the build. Keep the rate limiter as well.

**Email stays on Resend** for transactional. Do not migrate to SES: the sender domain is verified, the flows work, and SES requires production-access approval to leave sandbox. `scripts/send-periodical.js` stays a manually-run Node script on Mailgun; the only change is repointing its recipient read from `wrangler d1 execute` to the new database. It continues to mirror `_lib.js`'s token signing in Node crypto.

---

## 11. Auth

Cognito user pool via CDK. Email login, email-only account recovery, optional TOTP MFA. **No self-signup** — a `preSignUp` trigger rejects anything without a valid invite record. This replaces GitHub OAuth and retires `workers/auth/` entirely; admins no longer need a GitHub account to edit the site.

| Group | Can |
|---|---|
| `owner` | everything: user management, settings, Stripe config, `allow_scripts`, style rules, templates |
| `editor` | create and edit collections and Documents, publish, apply styles, read form submissions |
| `viewer` | read-only |

Authorization is enforced server-side in the admin's data layer, not in the UI. There is no public read path to the database — the publish Lambda reads with an IAM role.

---

## 12. SEO

SEO metadata is **structured fields, never author-supplied HTML.** The `<head>` is generated; pasted Document HTML cannot inject into it.

Per-entity fields: meta_title, meta_description, canonical_url, og_title, og_description, og_image_media_id, twitter_card, noindex, nofollow, jsonld_type, jsonld_overrides. Fallback chain: entity → template default → `settings`. Never emit an empty title or description.

Preserve what exists: Organization JSON-LD on the homepage, per-report JSON-LD on `alpr` and `stratos`, `sitemap: false` on `tip` and `success`, `tip`'s noindex, `robots.txt`'s explicit allowance of AI crawlers with `/admin/` and `/api/` disallowed, and `llms.txt` with its key-pages list and active-investigation figures.

Admin SEO panel shows a SERP preview and warns on: missing description, title over 60 characters, description over 160, duplicate slug, `noindex` on a published page.

**Migration gate:** `url-inventory.ts` crawls production and records every URL, status, title, description, canonical, and h1. `seo-parity-check.ts` runs against staging and **fails the cutover** if any previously-200 URL 404s or loses metadata. Note that this refactor cycle git-renamed `privacy.html` and `tip.html` from root into `templates/` — confirm their output paths are unchanged, and add `redirects` rows for anything that did move.

---

## 13. Media

Admin upload → presigned S3 PUT to a private prefix → S3 event → `media-process` Lambda → `sharp` generates AVIF and WebP at 400/800/1200/1600/2400px → writes to the media bucket with fingerprinted keys → updates `media_assets.variants`.

Current images live in `assets/` and are copied verbatim with no optimization, hashing, or responsive variants; `assets/uploads/` is empty and untracked. Migrate `assets/` into the media bucket during the port, generating variants for everything. Team headshots (`team.photo`) and report imagery benefit immediately.

Alt text is required before an asset can attach to a published page.

---

## 14. Backup, export, and restore

Retiring Decap removes a property the site currently gets for free: every content edit is a git commit, so history is unbounded, diffable, and greppable, and `content/*.json` doubles as a complete portable content backup. `revisions` (last 20 per entity) and `audit_log` cover in-app undo, but not "what did this page say in March" and not "the database is gone."

Three layers restore it, at a combined cost under $0.10/month.

### 14.1 S3 object versioning — published output

Enable versioning on the site bucket. Every publish that changes a page leaves the previous bytes recoverable, with no job to write and nothing to schedule. This is the cheapest possible answer to "what did this page look like on a given date": fetch the version.

Lifecycle rule: expire noncurrent versions after 365 days. At ~30 pages and a few megabytes for a full site render, a year of daily publishes costs well under a dollar in storage.

### 14.2 Nightly content export to git — source of truth

A scheduled Lambda exports content back to the GitHub repo using a GitHub App installation token. This restores the exact property being lost, in the same place it lived before, for nothing.

Export layout, deliberately matching today's shapes:

```
content/<collection>.json      one file per collection, current field names
documents/<slug>.html          body_html_raw — the author's original paste
documents/<slug>.json          metadata, SEO, style overrides, template key
styles/rules.json              style rules
redirects.json
manifest.json                  schema version, exported_at, row counts per table
```

Rules:

- **Export `body_html_raw`, not the styled or composed output.** Raw is the source of truth and the thing an author would re-paste. Composed output is already recoverable from §14.1.
- Exclude derived state — `body_html_normalized`, `ingest_report`, `content_hash`, `live_hash`, `live_at`. It regenerates.
- **Exclude every operational table.** No members, donations, subscriptions, subscribers, rate_limits, or processed_events. Donor records must never reach a git repository, private or not. §14.3 handles those.
- Stable key ordering and stable formatting, so a diff shows a content change and nothing else.
- Commit only when something changed. A commit in this history should mean an edit happened.

The strongest property this buys is not backup, it is exit. An export is a complete, human-readable, framework-agnostic copy of the site's content in the same shape the current Cloudflare stack already consumes. If AWS turns out to be the wrong answer, the content walks.

### 14.3 Operational data export — restricted

A separate scheduled export of `members`, `subscriptions`, `donations`, and `subscribers` to a private S3 bucket: SSE-S3 encrypted, versioned, block-public-access, bucket policy restricted to the export role and `owner`-assumed roles. Never to git. Never to the media or site buckets.

Lifecycle: retain 90 days of daily exports, then expire. Holding donor PII longer than the organization can justify is a liability, not a safety margin.

`rate_limits` and `processed_events` do not need exporting — the first is ephemeral, the second is reconstructible from Stripe.

### 14.4 Restore

`scripts/restore-from-export.ts` reads an export directory — a git checkout or an S3 prefix — and loads it into an empty database. **Build this in the same phase as the export, not later.** A backup nobody has restored is a hypothesis.

Run a restore drill into staging at the end of Phase 7 and quarterly after: restore from the most recent export, publish, and run `seo-parity-check` against production. If the restored site matches, the backup works.

---

## 15. Repo structure

```
repo/
  infra/cdk/                   # CloudFront, S3, OAC, CF Function, KeyValueStore,
                               # Cognito, database, all Lambdas
  functions/
    publish/                   # §7
    reconcile-drift/           # §7
    api/                       # §10 — ported from functions/api/
    media-process/             # §13
    export-content/            # §14.2 — nightly git export
    export-operational/        # §14.3 — restricted data export
  apps/
    admin/                     # Next.js 15 on Amplify Hosting
  packages/
    render/                    # §4 — ported build.js engine. pure.
    html-ingest/               # §5. pure.
    style-kit/                 # §6.1. pure.
    style-apply/               # §6.4. pure.
    db/                        # schema + query layer
  templates/                   # unchanged — 16 templates + partials/
  css/  js/  assets/           # unchanged sources
  scripts/
    url-inventory.ts
    migrate-content.ts         # content/*.json → database
    migrate-d1.ts              # D1 export → new database
    seo-parity-check.ts
    restore-from-export.ts     # §14.4
    send-periodical.js         # unchanged except its DB read
  docs/                        # keep; mark superseded ADRs
```

`render`, `html-ingest`, `style-kit`, and `style-apply` are pure and free of AWS dependencies — strings and objects in, strings out. That keeps the publish Lambda thin and everything testable.

**On dependencies:** this repo currently has exactly one devDependency and no lockfile, and that discipline is worth respecting. The build genuinely needs `parse5`, `sanitize-html`, `css-select`, and `sharp`, plus CDK and Next.js for the admin. Add a lockfile. Do not add anything else without asking — in particular no CSS framework, no component library beyond what the admin strictly needs, and no Stripe SDK.

---

## 16. Environments

| | Public | Admin | Database |
|---|---|---|---|
| prod | CloudFront + S3, `utahciviccompact.org` | Amplify `main`, `admin.utahciviccompact.org` | prod cluster |
| staging | separate distribution and bucket, `Disallow: /`, basic auth via CF Function | Amplify `develop` | staging cluster |
| local | render to a local dir and serve | `next dev` | local Postgres |

CI on every PR: type check, lint, unit tests (the sanitizer suite must pass), golden-file render tests (§4.1), snapshot tests on `style-apply`, `seo-parity-check` against staging.

This introduces a staging environment, which does not exist today — `main` auto-deploys straight to production.

---

## 17. Secrets

Migrate from `wrangler pages secret` to AWS Secrets Manager: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AIRTABLE_TOKEN`, `RESEND_API_KEY`, `TOKEN_SECRET`, plus new `TURNSTILE_SECRET_KEY`, `MAILGUN_API_KEY`, and `GITHUB_APP_PRIVATE_KEY` (§14.2). `DONATION_GOAL_CENTS` stays plain config.

**`TOKEN_SECRET` must carry over unchanged.** Unsubscribe tokens are 1-year links already in the wild; rotating the secret invalidates every one of them and silently breaks RFC 8058 one-click unsubscribe in mail clients. Preserve the existing degradation behavior too: if `TOKEN_SECRET` is unset, subscribe degrades the unsubscribe link to `/#join` and portal POST returns 503.

---

## 18. Migration and cutover

1. Commit the staged refactor (§1.1). Delete the stale `CLAUDE.md` Amplify section (§0).
2. Run `url-inventory.ts` against production. Commit the JSON.
3. Port the renderer and prove golden-file parity (Phase 1).
4. Stand up staging. Publish from `content/*.json` in the repo. Run `seo-parity-check`.
5. Migrate content into the database (`migrate-content.ts`) and re-verify parity.
6. Export D1 and migrate members, subscriptions, donations, subscribers, processed_events (`migrate-d1.ts`). `rate_limits` need not migrate. Verify row counts and the donation total against the live `/api/donations/stats` figure before and after.
7. Port the API. Test the webhook with Stripe CLI replay against staging, including both old and new invoice shapes. Confirm idempotency under replay.
8. Lighthouse the top pages. Do not regress.
9. **DNS:** the zone is on Cloudflare. Its proxy (orange cloud) conflicts with ACM certificate validation for CloudFront. Either set records to DNS-only and CNAME to the distribution, or move the zone to Route 53. Decide before cutover day.
10. Lower TTL to 300s 24 hours ahead. **Repoint the Stripe webhook endpoint** — a missed webhook is a lost donation record. Cut over.
11. Watch CloudWatch, Stripe webhook delivery, and Search Console for 72 hours. Keep Cloudflare Pages deployable for 30 days as rollback.
12. Retire Decap and `workers/auth/` only after the new admin is live (Phase 7), not at cutover.

---

## 19. Build phases

Stop at each checkpoint. Report against the Definition of Done. Wait for a go.

**Phase 0 — Ground truth.**
Commit the refactor. Delete the stale `CLAUDE.md` section. Read `schema.sql` and settle §1.2. Get answers on §1.3 and §1.4. Run `url-inventory.ts`.
*DoD:* clean git state, datastore decided with reasoning, open items answered, inventory committed.

**Phase 1 — Port the renderer.**
`packages/render` from `build.js`. Golden-file tests against current `dist/`.
*DoD:* byte-identical output for all 16 pages except the §1.5 fixes, each asserted explicitly. `how-did-this-happen` and `dignity-index-statement` migrated to partials. Sitemap matches.

**Phase 2 — Pure content core.**
`html-ingest`, `style-kit`, `style-apply`.
*DoD:* every sanitizer rule has a passing malicious-input test (`<script>`, `on*` handlers, `javascript:` and `data:` URLs, nested and obfuscated payloads, malformed HTML). Node ids tested across paste → edit → re-paste with an asserted match rate. Style resolution tested including priority collisions and `replace` versus `append`. Applying a template rule set to a naked semantic document snapshot-matches.

**Phase 3 — Infrastructure.**
CDK: buckets, OAC, distribution, behaviors, CloudFront Function, KeyValueStore, response-headers policy, database, Cognito.
*DoD:* a hand-placed file serves at the staging domain with the full header set and a passing CSP; the database is reachable from a Lambda with no VPC; versioning and the noncurrent-version lifecycle rule are enabled on the site bucket (§14.1); a test user exists in each Cognito group.

**Phase 4 — Publish pipeline.**
Render-all, hash-diff, put-changed, invalidate, verify. `publish_runs`. Drift reconciler. Staging publishing from repo JSON.
*DoD:* publish → live within 60s → verified hashes match; only changed paths are written and invalidated; a corrupted S3 object is detected and repaired by the reconciler; a render error aborts before any write.

**Phase 5 — API port and data migration.**
All seven routes. `_lib.js` and `_middleware.js` behavior. Turnstile. D1 export and load. Operational data export (§14.3) — stand it up as soon as there is donor data in the new database, not later.
*DoD:* the webhook passes Stripe CLI replay for every handled event type and both invoice shapes and is idempotent under replay; the portal magic link round-trips; unsubscribe works with a token signed by the **existing** `TOKEN_SECRET`; donation totals match pre-migration figures exactly; a nightly operational export lands in the restricted bucket and restores into staging.

**Phase 6 — Cutover.**
§18 steps 8–11.
*DoD:* parity check passes, DNS cut, Stripe webhook repointed and delivering, 72 hours clean.

**Phase 7 — Admin: collections.**
Login, typed forms for all eight collections, media library, revisions with restore-and-republish, audit log, publish states. Content export and restore (§14.2, §14.4). Source of truth moves from `content/*.json` to the database. **Retire Decap and `workers/auth/` only once the export is running** — not before.
*DoD:* an admin edits a team bio with a headshot, a statement, and a policy position, publishes, and sees each live — with no GitHub account, no git, no developer. The team photo defect cannot recur. The nightly content export (§14.2) is committing to the repo, produces no commit when nothing changed, and a full restore drill (§14.4) into staging reproduces the site.

**Phase 8 — Admin: Documents and styling.**
Paste-or-upload HTML with an inline code editor. Ingest report. Per-page CSS. Element tree, class picker, live preview with bidirectional linking. Template rule authoring with match-count preview. Promote-to-rule. Foreign class mapping.
*DoD:* an editor creates a new long-form report from pasted HTML, template rules apply on arrival, they adjust the remainder by hand, and publish — without knowing the class vocabulary and without a developer. Re-pasting a revised version preserves all rule-derived styling. Then tighten `style-src` to `'self'` and self-host the fonts.

**Phase 9 — Projects and cleanup.**
Project records with nested articles and videos, sorting and filtering, generated project index. Remaining ADR reconciliation. Superseded docs marked.
*DoD:* projects sortable and filterable in the admin and on the site; publishing a project updates both the projects page and the homepage cards.

---

## 20. Do not

- Do not rewrite the template engine. Port it and prove parity.
- Do not turn collections into pasted HTML. That boundary (§3) is the core of the design.
- Do not expose fixed-page templates to admins.
- Do not write classes into `body_html_raw`.
- Do not let author-supplied HTML reach the `<head>`.
- Do not skip the sanitizer on the publish path because it already ran on save.
- Do not hand-roll HTML sanitization. Use a maintained library with an explicit allowlist.
- Do not allow inline `<script>` or `style` attributes under any flag.
- Do not rotate `TOKEN_SECRET`.
- Do not log tipline request or response bodies. Status codes only.
- Do not "fix" the rate limiter to fail closed.
- Do not adopt the Stripe SDK mid-migration, or unpin the API version.
- Do not migrate transactional email off Resend.
- Do not support arbitrary CSS selectors in style rules.
- Do not let `data-nid` reach a published page.

<!-- TRUNCATED: the original spec message cut off here, mid-item ("Do not ship the …").
     Append the remainder verbatim when supplied. -->

---

## Planning addenda (2026-09-12, post-spec decisions)

Decisions made with the org during plan review. Where these conflict with the spec
text above, the addenda win. Full plan with deviations and reasoning lives in the
session plan; key items:

1. **Datastore: Aurora DSQL, confirmed.** DSQL gained FK and sequence support on
   2026-08-26, so §1.2's fallback trigger ("schema uses FKs") no longer applies —
   the two `REFERENCES` constraints are kept. UUID primary keys still used.
2. **§1.3 answered: no public donation total.** The public site shows no total
   raised, no goal, no progress bar. The recent-donor ticker (name + amount,
   `public=1` opt-in only) stays. `/api/donations/stats` returns only `recent`;
   `DONATION_GOAL_CENTS` is retired. The admin (Phase 7) shows every donation
   with amount, donor, and contact info where given.
3. **§1.4 answered: every page's content is editable.** The six reports PLUS
   `theory` and `privacy` become Documents (8 total). `tip` and `success` stay
   developer-owned (form/Stripe-flow coupled). The admin groups content by
   section — e.g. "Reports", "Whitepapers", "Site Main" — via a Document
   `category` field, with collections under "Site Main".
4. **No OAC on the API Lambda Function URL** — SigV4 OAC requires clients to send
   `x-amz-content-sha256` on POST, which Stripe and browsers do not. A secret
   `x-origin-verify` header added by CloudFront and checked in the Lambda locks
   the origin instead.
5. **No clean-URL rewrites during migration** — flat `.html` object keys are
   preserved to satisfy the URL-parity gate. The CloudFront Function does only
   redirect-map lookups and staging basic auth.
6. **No Stripe webhook repoint at cutover** — the URL and signing secret are
   unchanged; the DNS flip moves delivery. The cutover plan handles the DNS
   split-brain window with a delta export from D1 instead.
7. **Operational data export (§14.3) moves to Phase 5** (pre-cutover), so backups
   exist before real donor data lands in the new database.
8. **Cognito: self-signup disabled + `AdminCreateUser`** instead of a `preSignUp`
   invite Lambda.
9. **A `404.html` is added** with a CloudFront custom error response (Cloudflare
   Pages provided a 404 implicitly; the spec's §8 404 route assumed clean URLs).
10. **Production URL structure is CLEAN URLS, not flat `.html`** (discovered
    2026-09-12 via `scripts/url-inventory.mjs`; supersedes addendum 5's "no
    clean-URL rewrites"). Cloudflare Pages 308-redirects every `*.html` to the
    extensionless form and serves the page there; live canonicals are the clean
    URLs in practice. The CloudFront viewer-request Function must therefore:
    (a) rewrite extensionless page paths to the `.html` S3 key, (b) 308
    `*.html` requests to the clean form, and (c) still apply the redirect map.
    The §12 parity gate covers both forms — the committed baseline
    (`docs/migration/url-inventory.prod.json`, 41 entries) records the 308s
    and the clean-URL 200s.
11. **Prod serves 200 + homepage bytes for unknown paths** (Pages SPA fallback,
    no 404.html exists). Not preserved — the real 404 (addendum 9) is a
    deliberate improvement.
12. **The live sitemap.xml is stale**: lists `.html` URLs and omits
    `/projects`, `/privacy`, `/weber-county`. The regenerated sitemap uses
    clean URLs and includes all pages; this is an allowed parity exception.
