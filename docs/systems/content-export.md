# Content Export to Git + Restore (spec §14.2 / §14.4 — Phase 7)

Nightly Lambda exports the content tables to the GitHub repo as
`content/*.json` (+ `manifest.json`) — the same shapes `content/*.json` has
today — committing ONLY when a content file changed. Restore reads such an
export (a checkout or a local directory) back into a database. Operational
tables (donors, subscribers…) never touch this path (§14.3 has its own
restricted bucket export).

## Code Map

```
packages/db/export.js         buildContentExport(content) → Map<path,text>
                              (2-space JSON, LF, FIELD_MAPS key order),
                              rowCounts, gitBlobSha, changedPaths (manifest
                              excluded from the change decision)
packages/db/content.js        saveContent(client, repo) — inverse of
                              loadContent; THE write path for migration AND
                              restore (projects + children in one txn)
aws/export-content/index.mjs  nightly Lambda: loadContent → build → GitHub App
                              installation token → compare remote blob shas →
                              one commit on EXPORT_BRANCH; 'skipped' while the
                              secrets hold the placeholder; SNS alert + rethrow
                              on failure
aws/export-content/github.mjs App JWT (RS256, node:crypto), installation
                              token, Git Data API (refs/blobs/trees/commits),
                              recursive tree read for remote shas, branch
                              auto-create from the default branch
aws/export-content/secret-names.cjs  ONE list of the three secrets, read by
                              CDK (creates placeholders + grants) and the Lambda
infra/cdk/lib/ucc-stack.js    ExportContentFn (256 MB, 5 min), secrets
                              ucc/<env>/GITHUB_APP_{ID,INSTALLATION_ID,PRIVATE_KEY},
                              EXPORT_BRANCH content-export (prod) /
                              content-export-staging, cron 09:30 UTC, errors
                              alarm → OpsAlerts; output ExportContentFunctionName
scripts/export-content.mjs    --env X --out DIR: same builder, to disk
scripts/restore-from-export.mjs --env X --from DIR: saveContent + deep-equal
                              round-trip; prod needs --i-mean-prod
scripts/migrate-content.mjs   initial migration (now a thin saveContent caller)
docs/migration/parity-exceptions.json  known diffs the parity gate may ignore
```

## Export layout (§14.2)

```
content/settings.json … content/coverage.json   eight collections
documents/<slug>.html    body_html_raw, byte-exact (what the author would re-paste)
documents/<slug>.json    title, category, template, status, page CSS, SEO fields,
                         JSON-LD, allow_scripts, sitemap priority, published_at, overrides
documents/<slug>.normalized.html  derived but LOAD-BEARING: override nids are
                         carried forward from the previous normalized tree on
                         re-paste, so a restore into an empty database needs it
styles/rules.json        { rules: [scope, templateKey, documentSlug, selector,
                           classes, priority, note], foreignClassMap: [...] }
manifest.json            { schema_version: 2, exported_at, counts }
```
Derived document state (normalized body, ingest report, hashes, live_at) is
excluded — it regenerates. Every document is exported, drafts included (the
export is the source of truth, not the published site). `redirects.json`
arrives with the redirects table (Phase 9).

## Data flow (nightly)

1. Load the three secrets; any placeholder → log `skipped`, return (no
   alarm: unconfigured is a state, not a failure).
2. `loadContent` (same call the publish Lambda uses) → `buildContentExport`.
3. App JWT → installation token (1 h). Read the export branch's tree
   recursively; compare git blob sha1s computed locally — nothing downloaded.
4. No changed content file → `noop`, no commit (manifest alone never
   triggers one).
5. Else create blobs for changed paths + manifest, DELETE export-owned paths
   the export no longer produces (a removed document — otherwise a restore
   would resurrect it), a tree on the head tree, a commit (author "uccsite
   content export"), fast-forward the ref. Branch missing → created from the
   repo's default branch first.
6. Any error → SNS alert (`OpsAlerts`) + rethrow (CloudWatch alarm).

## Why a branch, not main

See docs/decisions/content-export-branch.md: until cutover, a commit to
`main` deploys Cloudflare Pages production. After cutover it can move to
`main` by changing `EXPORT_BRANCH` in the stack.

## Restore

`node scripts/restore-from-export.mjs --env staging --from <dir>` —
wipe-and-load through `saveContent`, then `loadContent` must deep-equal the
files. Documents (order matters): foreign class map first, then each
document upserted by slug (ids are not portable) with its body re-ingested
against the EXPORTED normalized tree so override nids match, published_at
restored, overrides replaced; then rules (page rules need the new ids); then
documents absent from the export deleted. Any override whose nid no longer
matches an element FAILS the restore (`--allow-orphaned-overrides` to
proceed with a warning). Every raw body and metadata field must read back
identically. Accepts schema 1 exports (collections only). Then `node scripts/publish.mjs --env staging --source db` and
`node scripts/seo-parity-check.mjs --target … --exceptions
docs/migration/parity-exceptions.json`.

## Restore drill 2 (2026-09-13, staging, with Documents) — PASSED

export (26 files: 8 collections, 8×2 documents, styles, manifest) → restore →
round-trip OK → `publish --source db` reported **no changes**.

## Restore drill (2026-09-13, staging) — PASSED

export-content → 9 files (counts team 3, statements 1, issues 7, blog 13,
projects 3, coverage 10) → restore-from-export round-trip OK → publish from DB
reported **no changes** (restored bytes identical to what was live) → parity
gate "Parity OK" with the recorded exceptions. Export content was
leaf-for-leaf identical to the repo's `content/*.json` (key order differs).

## Env / secrets

- Lambda env: `DSQL_ENDPOINT`, `GITHUB_REPO` (`CatAuditor/uccsite`),
  `EXPORT_BRANCH`, `ALERT_TOPIC_ARN`, `SECRET_ARN_*`.
- Secrets (operator fills, docs/for-conner.md): `GITHUB_APP_ID` (numeric),
  `GITHUB_APP_INSTALLATION_ID` (numeric, from the installation URL),
  `GITHUB_APP_PRIVATE_KEY` (full PEM). App permission: Contents: write on
  the repo.

## Error handling / logs

Prefix `[export-content]`: `skipped`, `no content change … nothing
committed`, `committed <sha> on <branch>: <paths>`, `failed: <message>`,
`remote tree listing truncated` (huge repo; harmless re-commit). GitHub
errors carry status + message, never the token.

## Status

Built, deployed to staging, invoked: `{"status":"skipped","reason":"secrets
unset"}`. First real commit happens when the GitHub App secrets are filled.
Decap + `workers/auth/` retire only after that (spec §20 Phase 7).
