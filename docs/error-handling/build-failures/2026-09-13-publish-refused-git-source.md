# 2026-09-13 — `scripts/publish.mjs` refused: "Refusing to delete 8 live objects (css/pages/*.css…)"

**Error** (also recorded as a `failed` row in `publish_runs`, trigger `manual`):

```
Error: Refusing to delete 8 live objects (css/pages/alpr.7ce0e45d.css, css/pages/dignity-index-statement.4e5a6f49.css, …).
If this is intentional, re-run with allowBulkDelete/--allow-bulk-delete. A missing input directory produces exactly this signature.
```

**Where:** `aws/publish/core.js` `publish()` bulk-delete guard, via
`scripts/publish.mjs --env staging` (no `--source`).

**Cause:** the script's default content source is `git` (content/*.json),
which renders the 17 fixed pages only. The live staging site was last
published by the Lambda from the **database**, which also renders 8
Documents and their fingerprinted `css/pages/<slug>.<hash>.css` files. A
git-source publish would have deleted those, so the guard refused. Nothing
was wrong with the data (documents: 8 published; bundle loaded 8).

**Fix:** run `node scripts/publish.mjs --env staging --source db` — the same
code path as the Lambda (`aws/publish/render-db.js`). Never pass
`--allow-bulk-delete` to get past this signature.

**Would catch it earlier:** the script could default to `db` once an
environment has ever published Documents, or refuse `git` when the
`documents` table is non-empty. Left as is (the guard did its job); the
three failed rows on the staging dashboard are from this.
