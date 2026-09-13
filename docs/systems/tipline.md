# Tipline

> **AWS port (Phase 5):** the route also exists as `aws/api/routes.js` `tip()`
> (serves staging now, prod at cutover) with one addition — Cloudflare
> Turnstile verification when `TURNSTILE_SECRET_KEY` is set: a missing/invalid
> `turnstileToken` returns **403** `Verification failed. Please try again.`
> The widget renders on `/tip` only when `settings.turnstileSiteKey` is set
> (site key FIRST, then secret — see docs/for-conner.md). Everything below
> (fields, logging policy, other responses) applies to both stacks.

Confidential tip submission form at `/tip` backed by Airtable.

## Architecture

```
templates/tip.html     ← form UI (built to /tip.html; noindex, not in sitemap)
js/tip.js              ← form controller (external file — site CSP blocks inline scripts)
  POST /api/tip
    functions/api/tip.js   ← validates (via _lib.js), calls Airtable REST API
      Airtable base: appgd3KnYil6zQgHp / table: tblRLdlEgvV1KqqiL (Tips)
```

The Cloudflare Function holds the Airtable token server-side. The browser never sees it.

## Airtable Field Mapping

| Form field | Airtable field | Type |
|---|---|---|
| `name` | `name` | Single line text |
| `anonymous` | `anonymous` | Checkbox |
| `email` | `email` | Single line text |
| `subject_of_tip` | `subject_of_tip` | Single line text |
| `tip_summary` | `tip_summary` | Long text |
| (hardcoded) | `status` | Single select → "New" |

Read-only Airtable fields (`tip_id`, `date_received`, `created_by_user`, etc.) are not submitted.

## Secrets

`AIRTABLE_TOKEN` — Cloudflare Pages secret. Set via:
```
wrangler pages secret put AIRTABLE_TOKEN --project-name uccsite
```

Token scope: `data.records:write`, scoped to the Tip Intake base only.

## Rate Limiting

Uses the shared `rateLimitOr429()` from `functions/api/_lib.js` — 5 requests / IP / hour, endpoint key `tip`. Fails open if D1 is unavailable (logged).

## Logging policy

This is a confidential tipline. `tip.js` never logs request bodies or Airtable response bodies (Airtable 422s echo field values). Only HTTP status codes are logged. Keep it that way.

## Responses

| Status | When |
|---|---|
| 200 `{ok:true}` | Saved |
| 400 | Bad JSON, invalid email, or empty tip |
| 429 | Rate limited |
| 502 | Airtable unreachable or non-2xx |
| 503 | `AIRTABLE_TOKEN` not set |

## "Anonymous"

The checkbox only blanks the `name` field. Email is still required and stored in Airtable so we can follow up — the form copy should not promise more than that.

## Attachments

Not yet wired. The Airtable `attachments` field (type: Attachment) requires public URLs — raw file uploads need an intermediate step (e.g. upload to R2, pass URL). The form UI accepts files; the function currently ignores them.

## Pages

- `/tip` — public tipline (noindex)
- Airtable base — reviewed internally; not published
