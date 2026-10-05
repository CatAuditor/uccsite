# ADR: petition campaigns are a content group + a slug, not a `petitions` table

**Date:** 2026-10-05 · **Status:** accepted

## Decision

The petition's copy (hero, form, thank-you page) lives in ONE JSON group on
the homepage singleton (`homepage.petition`), edited on the admin's Petition
page. Signatures go to `petition_signatures` keyed by the free-form campaign
`slug` the content carries; the API validates the slug's *shape* only.

## Alternatives considered

1. A `petitions` content table (slug, copy, status) with the API checking
   the slug exists. Rejected: the API Lambda holds no grant on content
   tables (docs/decisions/api-dsql-least-privilege.md) and would need one;
   a new collection means export, restore, FIELD_MAPS, editor, drift guards
   and a migration — all for a "one campaign at a time" need.
2. Hard-coding the UDOT copy in the templates. Rejected: the user asked for
   something that adapts to the next campaign without a developer.

## Consequences

- A new campaign = new slug + copy in the admin + a publish. Old signatures
  remain under the old slug and export separately.
- The hero flips on/off with the headline field — no feature flag.
- An attacker can post signatures under any well-formed slug; they are
  rate-limited, Turnstile-gated when keyed, and simply appear as another
  slug in the admin (ignore or export around them). Acceptable for an
  unofficial petition.
- If someone later needs several concurrent campaigns, promote the group
  to a table then; the API contract (`petition` slug in the body) stays.
