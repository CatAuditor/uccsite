# Report Media Coverage Lives in Its Own Content File

"Read About This in the Media" sections on `alpr.html` and `stratos.html` are driven by `content/coverage.json`, keyed per report (`alpr_coverage`, `stratos_coverage`) — not by reusing `blog.json` and not by hardcoding links into the templates.

**Why not reuse `blog.json`:** The blog feed is chronological across every topic. A report needs only the stories about *that* report, in the order the report wants them. The template engine has no filtering — `{{#articles}}` renders the whole array — so pulling from `blog.json` would put every unrelated story on every report page.

**Why not hardcode:** `stratos.html` already had two coverage links written inline, and they had gone stale as new outlets picked the story up. A content file keeps coverage editable at `/admin` alongside the rest of the site, by the same person who updates the blog.

**The tradeoff:** A story that belongs on both the news page and a report is now entered twice — once in `blog.json`, once in `coverage.json`. That is deliberate: the two lists answer different questions ("what's new" vs. "who covered this investigation") and will legitimately diverge. Adding a story to a report is not automatic; it has to be a decision.

**Why the section appears on only two reports:** `weber-county.html` (election law complaint) and `privacy-report.html` have no press coverage. An empty section is worse than no section, and the template engine has no conditional to hide one.

**Style note:** `alpr.html` renders the section as an open `<h2>` block matching its page of open sections. `stratos.html` is a stack of `<details>` accordions, so its coverage section stays a `<details>` — replacing the old inline "Media Coverage" block rather than adding a second one.
