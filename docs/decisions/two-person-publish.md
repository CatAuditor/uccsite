# ADR: No one publishes alone — request + approval by a different admin

**Date:** 2026-09-13 · **Status:** accepted

## Decision

The admin's Publish button is gone. Going live is a two-step, two-person
act: an editor/owner **requests** a publish (note + the list of unpublished
saves), and a **different** editor/owner **approves** it (the only admin
code path that invokes the PublishFn Lambda) or **declines** it with a
required note. Requester ≠ reviewer is enforced server-side by
`cognito:username` and email; owners are not exempt. One request pends at a
time; the requester can withdraw. Restore-from-revision is now a draft like
any save. `packages/db/publish-requests.js`, `apps/admin/lib/publish.js`,
docs/systems/admin.md "Publishing".

## Alternatives considered

- **Per-item approval** (each statement / document / list save submitted
  and approved separately, live state kept apart from draft state). Rejected
  for now: every collection editor is a wipe-and-load of a whole list, the
  templates render whole lists, and the publish is a whole-database render —
  a per-item draft/live split would mean duplicating every table and every
  save path. The publish request is the unit that already exists.
- **Approval only for some types** (news posts but not settings). Rejected:
  the user's rule is "no post or update", and one gate is easier to trust
  than a list of exceptions.
- **Requiring the reviewer to be an owner.** Rejected: "any other admin";
  editors review each other, owners included in the pool.

## Consequences

- A save is never live by itself; the dashboard's "unpublished saves" list
  is derived from `audit_log` rows after the last successful publish run,
  so anything that writes content without `recordChange` would be invisible
  there (everything in the admin does record).
- Saves made between request and approval go live with the approval (the
  publish renders the whole database). The pending panel lists them
  separately rather than blocking — blocking would let one editor's stray
  save freeze the queue.
- A sole admin cannot publish from the admin. That is the point; the
  operator CLI (`scripts/publish.mjs --source db`) stays available to a
  developer with AWS keys for emergencies and is outside the rule.

## What breaks if reversed

Putting a direct Publish button back (or having restore republish) lets one
account change the public site alone — the exact thing the org asked to
make impossible. If a path is ever added that renders without approval,
record it in docs/systems/admin.md "Publishing" as an explicit exception.
