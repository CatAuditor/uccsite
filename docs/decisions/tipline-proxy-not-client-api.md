# Tipline: Cloudflare Function proxy instead of direct client-side Airtable API

## Decision

The tip form POSTs to `/api/tip` (a Cloudflare Pages Function) rather than calling the Airtable REST API directly from the browser.

## Why

Airtable personal access tokens grant full read/write/delete access to the base. Embedding the token in client-side JS would expose it to anyone who views page source — giving them access to all tip records including submitter emails and PII, and the ability to delete or modify records.

## Tradeoffs

The proxy adds a network hop and a Cloudflare Worker invocation, but both are negligible. The function also centralizes validation and rate limiting, which wouldn't be possible client-side.

## Alternatives rejected

- **Airtable webhook automation** — no token exposure, but webhooks don't return a response, so the form can't confirm success or surface errors.
- **Airtable scoped read-only token** — read-only tokens don't help; submission requires write access.
