# Tipline

Confidential tip submission form at `/tip` backed by Airtable.

## Architecture

```
tip.html          ← form UI (branded, no secrets)
  POST /api/tip
    functions/api/tip.js   ← validates, calls Airtable REST API
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

Reuses the D1-backed `rate_limits` pattern from `api-security.md` — 5 requests / IP / hour on the `tip` action. Failure is non-fatal (submission proceeds if D1 is unavailable).

## Attachments

Not yet wired. The Airtable `attachments` field (type: Attachment) requires public URLs — raw file uploads need an intermediate step (e.g. upload to R2, pass URL). The form UI accepts files; the function currently ignores them.

## Pages

- `/tip` — public tipline (noindex)
- Airtable base — reviewed internally; not published
