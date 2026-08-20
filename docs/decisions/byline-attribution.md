# Byline Attribution by Content Type

Projects are bylined to Conner Radcliffe; statements and issue positions are bylined to Clark Dice. `privacy-report.html` and `theory.html` get no byline.

**Why:** Authorship on this site splits cleanly along a division of labor — Conner does the investigative/project work, Clark writes the org's public statements and policy positions. Encoding that as a per-entry `author` field rather than a hardcoded per-template constant means a future piece written by someone else needs a data change, not a template change.

**Why the two essays stay unbylined:** "The Denigration of Modern Private Space" and "Theory of Change" are institutional documents rather than authored pieces. Attaching a personal name would frame org doctrine as one person's argument.

**Why detail pages hardcode the name:** `alpr.html`, `stratos.html`, and `weber-county.html` are standalone templates that receive only `settings` in `build.js` — they have no access to `projects.json`. Wiring per-project content into them for one string wasn't worth it. The tradeoff: a project's author now lives in two places, and both must change together.

**Not done:** No `schema.org` `author` markup was added. The site has no structured article metadata today, so adding it for authorship alone would be an isolated half-measure.
