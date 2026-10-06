# Proposal: Payment options — define a donation ask once, use it anywhere

**Status:** requested by Conner Radcliffe, 2026-10-06. Not built. Handed to the
technical team (Jarom Gillins, Kaden Payne). This document records what Conner
asked for, what exists today, and a design the conversation converged on — it
is a starting point, not a decision.

## What Conner asked for (his words, paraphrased)

- **Editing donation asks is clunky.** Amounts are typed as comma-separated
  text (`5, 10, 25`), and the Petition page has nine separate boxes for one
  payment window. He wants fewer boxes: amount **chips** you add and remove,
  **toggles** for one-time / monthly, compact copy fields.
- **A central place for asks.** "Site Main → **Payment webhooks** → **+**", fill
  in copy, amounts and options, save — then **link to it** or **insert it**
  wherever the site asks for money. Like the Menus page's **Links to** box: the
  thank-you page's "I can help" button would just point at a saved payment
  option instead of carrying its own settings.
- New asks should be creatable **on the fly**, without a developer.

**Naming.** Conner calls this "payment webhooks". In Stripe, a *webhook* is the
server-to-server message that records a completed payment (`POST /api/webhook`,
`STRIPE_WEBHOOK_SECRET`) — this feature must not touch that, and a mistake there
silently stops donations being recorded. Suggest the page be called
**Payment options** (or "Donation asks"); confirm with Conner.

## Where the site asks for money today

| Surface | Behaviour | Code |
|---|---|---|
| Homepage donate section | **Embedded** — monthly/one-time toggle, tiers $5/10/25/50 + Other, name/email/ZIP, newsletter + public-donor checkboxes | `templates/index.html` `#donate`; `js/main.js` donate flow |
| Homepage timed pop-up | Button **links** to `/#donate` | `templates/index.html` `#donate-modal`; `js/main.js` |
| Petition thank-you "I can help" | Button opens a **pop-up** payment window | `templates/petition-thanks.html` `#petition-modal`; `js/petition.js` |
| Download pop-up (after a file download) | Button **links** to `/#donate` | `templates/partials/footer.html` `#download-modal` |
| Header "Donate" | **Link** to `/#donate` | `packages/render/navigation.js` (Menus) |

All of them end at one API route: `POST /api/create-checkout-session`
(`aws/api/routes.js`) with `{ type: 'onetime'|'subscription', amountCents,
email?, firstName?, lastName?, zip?, newsletterOptIn, publicDonor, source? }`.
It already accepts any amount from $1 to $100,000 and both frequencies — **no
Stripe-side change is needed for any of this**. Checkout uses inline
`price_data`, so no Stripe Products/Prices have to be created per option.

The petition window is already data-driven (2026-10-06): `petitionDonate()` in
`packages/render/site.js` reads `donate_*` fields from the petition group
(`apps/admin/lib/collections.js`). That is the closest thing to a payment
option today and the natural thing to migrate first.

## Proposed design

### 1. A payment option (the data)

One record per ask, e.g. *Petition ask*, *Homepage monthly*:

| Field | Notes |
|---|---|
| name | admin-only label; slug derived (`petition-ask`) |
| title, text | heading and paragraph shown with the amounts |
| amounts | list of whole dollars, max ~6; one marked default |
| frequency | one-time, monthly, or both; which side starts selected |
| other amount | on/off ($1–$100,000) |
| collect | which donor fields to ask for (name, email, ZIP) — the homepage form asks, the petition window pre-fills from the signature |
| checkboxes | newsletter opt-in, public-donor list — wording + default |
| button | checkout button wording |
| source label | sent as `source`; shown in admin → Donations so you can see which ask raised what |

Storage: a `payment_options` table (or a JSON column alongside the homepage
groups). Saves need the usual pattern: lost-update check, revision snapshot,
audit row named so publishing counts it (`CONTENT_ACTION_RE` in
`packages/db/publish-requests.js` — e.g. `payment.save`), a "What will change"
describer in `apps/admin/lib/change-detail.js`, the nightly content export, and
the restore script.

### 2. Three ways to use one

1. **Slots** — fixed places that hold a picker: homepage donate section
   (embedded), homepage timed pop-up and download pop-up (button → pop-up or
   link), petition thank-you (button → pop-up). Each slot stores the chosen
   option's slug.
2. **Link** — every option gets a page, `/give/<slug>`, which renders it
   embedded. It appears in every **Links to** picker (Menus, petition secondary
   link, …) and can be pasted into newsletters and social posts.
3. **Insert into a Document** — a token in a document body (the token system
   in `packages/html-ingest` / `documents.js` `replaceTokens` already handles
   coverage strips) renders the option inline in a report.

One renderer for all three: a partial (`templates/partials/payment.html`) fed
by a derive function like `petitionDonate`, and one client script replacing the
duplicated logic in `js/main.js` and `js/petition.js`.

Each option's editor should show **"Used in:"** (slots, menus, documents) so a
live one is not deleted.

### 3. The admin page

Site Main → **Payment options**: list of options, **+ New**. The editor uses
chips for amounts (add, remove, click to set default), switches for one-time /
monthly / Other, and a live preview of the window. Fields left blank show the
default text as a greyed placeholder.

### 4. Day one looks identical

Seed two options matching what is live (the homepage form; the petition ask
from the current `donate_*` fields), point every slot at its match, then delete
the petition group's `donate_*` fields and `petitionDonate`. Nothing on the
public site should change until someone edits an option — compare a fresh
render against the live pages before shipping.

## Things to decide

- Page name (Payment options vs Conner's "payment webhooks").
- Whether a slot can also hold a plain link instead of an option.
- Thank-you after payment: one shared `/success` page, or per-option copy?
- Server-side checks: should `create-checkout-session` accept only amounts an
  option offers (plus Other bounds), or stay open as now?
- Staging: Stripe **test** key (`ucc/staging/STRIPE_SECRET_KEY` is still a
  placeholder) so options can be tried without real charges.

## Access the builders will need

- **Stripe dashboard** — Conner invites Jarom and Kaden (Settings → Team).
  The **Developer** role is enough to see payments, logs and webhooks; the
  live restricted key the site uses (`ucc/prod/STRIPE_SECRET_KEY`) only allows
  Checkout Sessions (write), Customer portal (write) and Customers (read), and
  needs no change for this feature.
- **AWS** — both already have it (Jarom: root; Kaden: IAM user, 2026-10-06).

## Related

- `docs/systems/petition.md` "Donation ask on the thank-you page" — today's petition-only version.
- `docs/systems/navigation.md` — the **Links to** picker pattern to reuse.
- `docs/systems/admin.md` "What changed" — the describer a new save type needs.
