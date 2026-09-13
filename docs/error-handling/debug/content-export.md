# Debug logging — content export to git

Prefix: `[export-content]`. Feature doc: docs/systems/content-export.md.
Logs: CloudWatch `/aws/lambda/<env>-ExportContentFn…` (nightly 09:30 UTC;
`aws lambda invoke --function-name <ExportContentFunctionName output> --profile uccsite out.json` runs it now).

| Log | Meaning | Normal | Broken |
|---|---|---|---|
| `GitHub App secrets unset (placeholder) — export skipped` | secrets still `REPLACE_ME` | until the operator fills them | after they are filled → a secret holds an empty string or the wrong name |
| `no content change vs <repo>@<branch> — nothing committed` | every content blob sha matched the branch | most nights | never seen after an admin save → export reading a different DB than the admin writes (DSQL_ENDPOINT) |
| `committed <sha> on <branch>: content/x.json …` | commit pushed | after edits | — |
| `remote tree listing truncated` | GitHub truncated the recursive tree (>100k entries) | never | harmless: unchanged files re-commit |
| `failed: GitHub POST /app/installations/<id>/access_tokens → 401 …` | bad App ID / private key | — | check `GITHUB_APP_ID` and that the PEM is complete incl. header/footer lines |
| `failed: GitHub … → 404 Not Found` | App not installed on the repo / wrong installation id | — | reinstall the App on `CatAuditor/uccsite`, copy the id from the installation URL |
| `failed: GitHub PATCH … → 422 …` | ref update rejected (non-fast-forward) | — | someone pushed to the export branch by hand; the next run rebuilds on the new head |

Every `failed:` also publishes to the OpsAlerts SNS topic and trips
`ExportContentErrorsAlarm`.
