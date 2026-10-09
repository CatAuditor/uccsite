# Unsubscribe happens on POST only; GET shows a button

Date: 2026-10-08. Status: accepted.

## Decision

`GET /api/unsubscribe?token=…` validates the token and shows the address with
an **Unsubscribe** button. Only `POST` to the same URL unsubscribes — either
the mail client's RFC 8058 one-click request or that button.

## Why

Link scanners (Outlook Safe Links, Mimecast, Proofpoint, some antivirus) and
inbox prefetchers fetch every URL in a message with GET. When GET
unsubscribed, any recipient behind such a scanner was silently removed on
delivery. RFC 8058 exists for this reason: the one-click action is a POST so
it cannot be triggered by a fetch.

## Alternatives

- **Keep GET unsubscribing** — zero clicks for humans, but scanners
  unsubscribe real readers, and the unsubscribe stat becomes meaningless.
- **GET page with JavaScript auto-POST** — scanners that run JS still
  trigger it; the site CSP also blocks inline script.
- **Separate one-click endpoint** — two URLs to keep in sync for no gain;
  the token already identifies the person.

## What breaks if reversed

Recipients at organisations with link scanning get unsubscribed without
acting. The body link costs humans one extra click, which CAN-SPAM allows
(no login, no extra information asked).
