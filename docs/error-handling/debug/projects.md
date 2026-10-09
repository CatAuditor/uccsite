# Debug logging — projects, workspace, notes, nested addresses

Prefixes: `[projects]` (admin), `[publish] redirects:` (publish). Feature doc: docs/systems/projects.md.

| Where | Event | Log | Normal | Broken |
|---|---|---|---|---|
| apps/admin/app/projects/[slug]/actions.js `createNote` | note stored | `[projects] note created <id> in <slug> [from "<file>"]` | one per note | absent → the action threw first (role, no title, project missing, .docx conversion) — the form shows the error |
| apps/admin (server) | record / move / note mutations | `[admin] <actor> projects.save projects/collection`, `… document.move document/<id>`, `… note.create|note.save|note.delete note/<id>`, `… document.create document/<id>` (with `fromNote` in the diff) | audit trail | a `projects.save` without the expected rename: the editor's payload lost the row `id` (sanitizeItems keepIds) and the project was deleted + re-created — refused if anything pointed at it |
| aws/publish (render-db.js `publishRedirects`) | KeyValueStore sync | `[publish] redirects: N document redirect(s) → 301: /alpr → /projects/alpr/report, …` and `redirects: N archived path(s) → 410 Gone: …` then `KeyValueStore updated (x put, y deleted)` | after every publish from the database | `table is empty — store left untouched` = migrate-redirects never ran on that env (document redirects are NOT written either); a redirect missing here = the document's `short_path`/`live_path` equals its address, or the path is a live page this render wrote (shadow guard) |
| aws/publish (`renderSiteFromDb`) | address clash | `RENDER ERROR: document <path>: its address /… is already used by project "…"` / `document "…"` | never | two documents share `(project_slug, slug)` (the unique index should prevent it) or a document slug equals a sub-project slug — fix in the editor |
| aws/publish core | bulk delete guard | `Refusing to delete N live objects (alpr.html, …)` | only on the first publish after the tree migration (9 objects) | re-run `scripts/publish.mjs --env <env> --source db --allow-bulk-delete`; an admin-triggered publish cannot opt in |

State first:

```sql
SELECT slug, parent_slug, sort_order, cta_url FROM projects ORDER BY sort_order;
SELECT slug, project_slug, status, short_path, live_path, canonical_url FROM documents ORDER BY project_slug, slug;
SELECT project_slug, folder, title, pinned, author, updated_at FROM project_notes ORDER BY project_slug, folder;
```

Edge check (staging needs `-u preview:…`):
`curl -sI https://<origin>/alpr` → `301` + `location: /projects/alpr/report`;
`/projects/alpr` → 200; `/projects/alpr/report` → 200 with
`<link rel="canonical" href="https://utahciviccompact.org/projects/alpr/report">`.
A canonical still showing the OLD path means the row's `canonical_url` names
an address that is not one of its own aliases — clear it in the SEO panel.
