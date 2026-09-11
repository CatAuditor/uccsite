# Bylines — Content Authorship

Every project, statement, and issue position on the site carries a visible "By {name}" byline.

## Attribution split

| Content | Author | Where the name lives |
|---------|--------|---------------------|
| Projects | Conner Radcliffe | `author` field in `content/projects.json` |
| Project detail pages | Conner Radcliffe | Hardcoded in `.release-meta` block of `templates/alpr.html`, `stratos.html`, `weber-county.html` |
| Statements | Clark Dice | `author` field in `content/statements.json` |
| Issue positions | Clark Dice | `author` field in `content/issues.json` |
| `privacy-report.html`, `theory.html` | *(none)* | Deliberately unbylined |

The split is by **content type**, not topic. Do not infer an author from the subject matter — see [../decisions/byline-attribution.md](../decisions/byline-attribution.md).

## Rendering

Each list template renders `By {{author}}` in its own element directly below the title or tagline:

- `templates/projects.html` → `.project-byline` (below tagline, above CTA)
- `templates/statements.html` → `.statement-byline` (below title, above body)
- `templates/issues.html` → `.issue-byline` (below epigraph, above body)

Detail pages use `.release-author` inside the existing `.release-meta` row, styled heavier than the adjacent `.release-date`.

Because the byline is a separate element, the preceding element's bottom margin was reduced and the byline absorbs the original spacing — total vertical rhythm is unchanged.

## Adding new content

Set `author` on the new entry. A missing `author` renders as a bare "By " — the field is required, not optional. Projects are editable via Decap CMS (Author field in the Projects collection, `static/admin/config.yml`); statements and issues have no CMS collection and are edited in the JSON directly.

The homepage project cards (`.fight-card` in `templates/index.html`) intentionally omit bylines — they are compact teasers.
