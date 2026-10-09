# 2026-10-10 — staging publish run from the repo content removed the database pages

**What happened**

`node scripts/publish.mjs --env staging --allow-bulk-delete` was run to put the
new petition pages on staging. Without `--source db` the script defaults to
`--source git` on staging, so it rendered from `content/*.json` with **no
documents** and deleted the 16 objects the git render does not produce:
every document page (`projects/alpr/report.html`, `projects/stratos/report.html`,
…), their hashed `css/pages/*.css`, and the old petition pages.

The first (refused) run printed the signature:

```
Error: Refusing to delete 16 live objects (css/pages/dignity-index-statement.4e5a6f49.css, …).
If this is intentional, re-run with allowBulkDelete/--allow-bulk-delete.
A missing input directory produces exactly this signature.
```

The hashed document CSS in that list was the tell: a git-source render never
has documents, so it wants to delete every document artefact.

**Fix**

`node scripts/publish.mjs --env staging --source db` — re-rendered the
documents, the petition pages and the redirects (30 changed, 5 removed: the
fixed templates the documents claim, plus a team page the DB no longer has).
Staging is back to what an admin publish produces.

**What would catch it earlier**

- Read the refusal: hashed `css/pages/<document>.css` files in the delete
  list = the render had no documents = wrong source. Never answer that with
  `--allow-bulk-delete`.
- Staging could refuse `--source git` the way prod does (publish.mjs makes
  prod state its source explicitly). Not changed here — a surgical fix was
  not asked for; noted for a later session.
