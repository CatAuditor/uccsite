# SEO plan — people and topics (started 2026-10-05)

Working document. Goal: a search for a team member's name, or for the topics
Utah Civic Compact works on (Flock / license plate readers in Utah, MIDA
Stratos, Weber County election complaint, data centers and consent), lands on
this site near the top. The trigger was a search for "Jarom Gillins": campaign
coverage filled the first pages and nothing from this site appeared until the
May MIDA/Stratos item and a Utah Privacy Commission hearing notice on page 5.

## Where things stood (2026-10-05)

- The site named Jarom on two URLs (Team page, the ALPR policy paper). No
  per-person page, no `Person` structured data, no profile links, so search
  engines had nothing to attach the name to.
- Bylines were plain text. The homepage `Organization` listed no members, no
  logo, no profiles, no share image.
- Documents (the long-form pages) carried no author field; JSON-LD on them had
  no author unless hand-written.

## Done on the site (2026-10-05) — docs/systems/author-pages.md

- Author pages at `/team/<slug>` with ProfilePage + Person JSON-LD, `sameAs`
  from profile links, and a list of all work by that person.
- Every byline links to the author page. Every Article's author carries the
  same Person `@id`. Homepage Organization lists members, logo, Instagram,
  share image.
- Admin: Team & Bios → *Public profile links*, *Author page URL slug*;
  Documents → *Author*.

## Needs a person (highest payoff first)

1. **Google Search Console + Bing Webmaster** — verify the domain, submit the
   sitemap, request indexing on `/team` and the four author pages. Steps in
   docs/for-conner.md §1. Without this we cannot see what Google indexes or how
   the name queries move.
2. **Profile links both ways.** Each member: admin → Team & Bios → Public
   profile links (LinkedIn, X, personal/campaign site). Then put the author
   page URL in those profiles' *website* field and the title "Senior Policy
   Director, Utah Civic Compact" (or equivalent) in the headline. Two-way links
   are what merge the entities.
3. **Jarom's bio** — draft below. Lead with the UCC role and the ALPR work;
   the campaign becomes one sentence of history. Paste into Team & Bios when
   ready.
4. **Press attribution.** When quoted, ask the reporter for "Jarom Gillins,
   Senior Policy Director at Utah Civic Compact" with a link to
   utahciviccompact.org (ideally the author page or the report). One linked
   mention in Utah News Dispatch or KSL outweighs any on-page change.
5. **Campaign site.** jaromforcongress.com is parked. Either point it (301) at
   `/team/jarom-gillins`, or put one page back up with a link here. A dead
   domain that Google still associates with the name helps nobody.

## Later (P2)

- One on-site page per press item (NewsArticle schema, quote attribution with
  the Person `@id`) instead of external-only cards on /blog.
- A URL per statement (today `/statements#slug`).
- Topic hub pages: "License plate readers in Utah", "Data centers and
  community consent" — one evergreen URL each that every report, statement
  and press item links to.
- `Person.knowsAbout` on author pages, generated from the topics of their work.

## Jarom Gillins — bio draft (edit here first, then paste into Team & Bios)

Field: **Title / Role** — keep `Senior Policy Director, Board of Directors`.

Field: **Bio** (markdown; blank line = new paragraph):

```
Jarom Gillins is Senior Policy Director at Utah Civic Compact and a member of its Board of Directors. He wrote the Compact's policy paper on Utah's license plate reader law, *If Weber County Followed the Law, How Did This Happen?*, which reads the Automatic License Plate Reader System Act against the Weber County–Flock Safety agreement and shows where the statute stops short of the system actually in use. He has spoken on surveillance and privacy before the Utah Privacy Commission.

Jarom is a troubleshooter by trade and by temperament. A U.S. Army veteran, he has worked as an underwater welder and a wind turbine technician — jobs where you find the fault, understand why it happened, and fix it so it stays fixed. He brings the same method to policy: read the actual document, trace what it permits and what it fails to name, and propose the specific change that closes the gap.

He believes he has a duty to leave the places and people around him better than he found them, and that government only works for the people who show up to it. In 2026 he ran for the U.S. House in Utah's 2nd Congressional District as an independent reformer; the Compact is where that work continues.
```

Field: **Public profile links** (one URL per line — fill in the real ones):

```
https://www.linkedin.com/in/…
https://x.com/…
https://jaromforcongress.com   ← only once it redirects here or has a page again
```

Notes on the draft:
- First sentence = name + role + organisation, because that is the line
  search engines and AI summaries lift.
- The paper's title appears verbatim so the name and the work co-occur.
- Campaign is one sentence, last, framed as past tense and continuity.
- Shorter alternative for the first paragraph if the Privacy Commission
  appearance should not be claimed yet: drop the last sentence of paragraph 1.

### One-line version (for press, social bios, the LinkedIn headline)

> Jarom Gillins — Senior Policy Director, Utah Civic Compact. Army veteran and tradesman; author of the Compact's policy paper on Utah's license plate reader law.
