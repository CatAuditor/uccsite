// Authoring kit (docs/systems/documents.md "Authoring kit"): ONE markdown
// file an author gives to Claude, or any writing tool, before drafting a
// long-form piece. It carries the voice rules, the page fields the admin
// needs, the HTML the ingest accepts, the template rules that style a
// document on arrival, the site's design tokens and the live Style Kit
// catalog WITH each class's CSS, so the writing tool can hand back HTML
// that already looks like the site (the body lands bare between the site
// header and footer; nothing wraps it for the author). The static sections
// live here; the dynamic ones are read from the live stylesheet and the
// database at download time (app/documents/authoring-kit/route.js) so the
// file never drifts from what the editor actually does. Pure: no I/O.
//
// Two builders: buildAuthoringKit → markdown (the source text, also what the
// tests read), buildAuthoringKitHtml → ONE self-contained .html for download
// (the markdown rendered with marked, the live site stylesheet embedded in
// <style> so the reference fragment renders as on the site and a machine can
// read the CSS beside the markup, plus the escaped source). The site itself
// never accepts <style> or style= in a document body; the page says so.
import { ALLOWED_TAGS } from '@uccsite/html-ingest';
import { marked } from 'marked';

const SITE = 'https://utahciviccompact.org';
// Where the HTML builder splices the live-rendered fragment into the
// converted markdown (an HTML comment passes through marked untouched).
const LIVE_MARKER = '<!--KIT:LIVE-->';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Classes the ingest accepts but an author never writes: site chrome, forms,
// the donation page and the homepage hero (the report hero is subpage-hero).
// Every other annotated group is offered, with its CSS, so the author can
// reuse the site's section patterns (stats bands, cards, callouts) in a body.
// 'Document block parts' are the inner pieces the builder writes itself
// (stat-num, release-badge, …); the block classes are offered, the parts not.
const CHROME_GROUPS = new Set(['Navigation', 'Footer', 'Forms', 'Modal', 'Donations', 'Hero', 'Document block parts']);

const dash = (s) => String(s || '').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();

// Annotation tooling appends "Sets: <css> (auto)" to generated descriptions;
// the CSS is printed on its own line now, so drop the duplicate.
const describe = (e) => (dash(String(e.description || '').replace(/\s*Sets:.*\(auto\)\s*$/, '')) || dash(e.label) || e.className)
  .replace(/<([a-z][a-z0-9]*)>/g, '`<$1>`');          // "Used on <div>" must not render as a tag
const cssOf = (e) => dash(Array.isArray(e.declarations) ? e.declarations.join(' ') : e.declarations);

function catalogSection(kit) {
  const groups = new Map();
  for (const e of kit.entries) {
    if (!e.description) continue;                 // unannotated classes are not for authors
    const g = e.group || 'Site stylesheet';
    if (CHROME_GROUPS.has(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  const out = [];
  for (const [g, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`### ${g}`, '');
    for (const e of entries.sort((a, b) => a.className.localeCompare(b.className))) {
      const on = e.applies?.length ? e.applies.map(t => `\`<${t}>\``).join(', ') : 'any element';
      out.push(`- \`${e.className}\` on ${on}: ${describe(e)}`);
      const css = cssOf(e);
      if (css) out.push(`  CSS: \`${css}\``);
    }
    out.push('');
  }
  if (!out.length) out.push('_No annotated classes were found in the live stylesheet. Write plain semantic HTML; the editor styles it._', '');
  return out.join('\n');
}

// One body fragment that uses almost every offered class in the nesting the
// site itself uses (templates/index.html, blog.html, alpr.html), with an
// HTML comment per block saying what the pattern is for. Sample content,
// in the site's voice. Kept by hand; buildAuthoringKit checks every class in
// it against the live stylesheet and says which offered classes it omits.
const EXAMPLE_HTML = `<!-- 1. Hero: the only place the <h1> goes. Eyebrow, headline, one or two lead paragraphs, optional actions. -->
<div class="subpage-hero">
  <div class="section-label">Surveillance investigation</div>
  <h1>Ten cameras in one Utah county were searched 5.1 million times</h1>
  <p>Weber County operates ten license-plate reader cameras. Records the county released under GRAMA show 3,343 agencies ran <strong>5,171,087 searches</strong> against the networks it administers between February 2022 and July 2026.</p>
  <p><a href="https://archive.org/details/example-records" target="_blank" class="btn btn-ghost">Download the records</a></p>
</div>

<!-- 2. One-sentence framing band: mission-strip + mission-text. Use once, right after the hero, or not at all. -->
<section class="mission-strip">
  <div class="container">
    <p class="mission-text">Every figure on this page comes from records Weber County released, or from documents the county published itself.</p>
  </div>
</section>

<!-- 3. Ordinary report section: section > container > prose. Plain headings and text inside prose; this is most of a piece. A callout for a note on sources. -->
<section class="section bg-cream">
  <div class="container">
    <div class="prose">
      <h2>Where the records came from</h2>
      <p>UCC requested the search logs on 3 February 2026 under the Government Records Access and Management Act. The county released 5,171,087 rows on 14 March 2026 and withheld the names of the officers who ran each search.</p>
      <div class="callout">
        <strong class="callout-label">A note on this investigation</strong>
        <p>Nothing on this page is a criticism of the sheriff's office. Weber County is the only county that has let anyone look.</p>
      </div>
      <blockquote>
        <p>The sheriff's office does not audit searches run by outside agencies.</p>
      </blockquote>
      <p>Weber County records officer, email to UCC, 14 March 2026.</p>

      <h3>What one row contains</h3>
      <table>
        <caption>Fields in each search record, as released by Weber County</caption>
        <thead><tr><th>Field</th><th>Example</th></tr></thead>
        <tbody>
          <tr><td>Agency</td><td>Ogden Police Department</td></tr>
          <tr><td>Reason given</td><td>Investigation</td></tr>
        </tbody>
      </table>
      <ul>
        <li>Agencies in 45 states appear in the logs.</li>
        <li>Utah agencies account for 11 percent of searches.</li>
      </ul>
      <div class="callout-dark">
        <strong class="callout-label">What the county did not answer</strong>
        <p>Which agencies ran the 1,208,331 searches logged without a case number.</p>
      </div>
    </div>
  </div>
</section>

<!-- 4. Key figures: impact band. Three to four stats, a divider between each. impact-number is display-sized; keep the label short. -->
<section class="impact section">
  <div class="container">
    <div class="impact-grid">
      <div class="impact-stat">
        <div class="impact-number">5,171,087</div>
        <div class="impact-label">Searches, February 2022 to July 2026</div>
      </div>
      <div class="impact-divider"></div>
      <div class="impact-stat">
        <div class="impact-number">3,343</div>
        <div class="impact-label">Agencies that ran at least one search</div>
      </div>
      <div class="impact-divider"></div>
      <div class="impact-stat">
        <div class="impact-number">13,100</div>
        <div class="impact-label">Searches by Weber County's own deputies</div>
      </div>
    </div>
  </div>
</section>

<!-- 5. Cream band with a site-style section heading (eyebrow + section-title + section-sub) and a numbered card grid: pillars. Use for two to four parallel findings. -->
<section class="pillars section bg-cream">
  <div class="container">
    <div class="section-label">What the records show</div>
    <h2 class="section-title">Three findings</h2>
    <p class="section-sub">Each finding below is drawn from the released logs and the county's published vendor contract.</p>
    <div class="pillars-grid">
      <div class="pillar-card">
        <div class="pillar-number">01</div>
        <h3>Out-of-state agencies ran most searches</h3>
        <p>Agencies in 45 states appear in the logs. Utah agencies account for 11 percent of searches.</p>
        <a href="#out-of-state" class="pillar-link">Read the detail</a>
      </div>
      <div class="pillar-card">
        <div class="pillar-number">02</div>
        <h3>No search was audited</h3>
        <p>The county confirmed it has never reviewed a search run by an outside agency.</p>
        <a href="#audits" class="pillar-link">Read the detail</a>
      </div>
      <div class="pillar-card">
        <div class="pillar-number">03</div>
        <h3>The sharing default was never changed</h3>
        <p>The vendor contract enables nationwide sharing unless the county opts out. It did not.</p>
        <a href="#defaults" class="pillar-link">Read the detail</a>
      </div>
    </div>
  </div>
</section>

<!-- 6. Linked card grid: issues. Each card is one <a>. issue-icon holds a short mark (the site uses an inline SVG; a number or abbreviation works). -->
<section class="issues section">
  <div class="container">
    <div class="issues-header">
      <div>
        <div class="section-label">Agencies</div>
        <h2 class="section-title">Who searched Weber County's cameras</h2>
        <p class="issues-intro">The ten agencies below ran the most searches. Each card links to that agency's rows in the released data.</p>
      </div>
      <a href="https://archive.org/details/example-records" target="_blank" class="btn btn-outline btn-sm nowrap">Full dataset</a>
    </div>
    <div class="issues-grid">
      <a class="issue-card" href="#agency-ogden">
        <div class="issue-icon">UT</div>
        <h3>Ogden Police Department</h3>
        <p>412,906 searches. The only Utah agency in the top ten.</p>
      </a>
      <a class="issue-card" href="#agency-tx">
        <div class="issue-icon">TX</div>
        <h3>Texas Department of Public Safety</h3>
        <p>1,208,331 searches, none with a stated case number.</p>
      </a>
    </div>
  </div>
</section>

<!-- 7. Two-column section: about. Prose on the left with a primary button; on the right a dark quote card and a small fact grid. -->
<section class="about section">
  <div class="container">
    <div class="about-grid">
      <div class="about-text">
        <div class="section-label">What UCC recommends</div>
        <h2 class="section-title">Turn sharing off by default</h2>
        <p>The county can restrict sharing to Utah agencies in the vendor's settings today, at no cost, without a vote.</p>
        <p>UCC has asked the county commission to do so and to publish quarterly search counts by agency.</p>
        <a href="/petition.html" class="btn btn-primary">Sign the petition</a>
      </div>
      <div>
        <div class="about-card">
          <blockquote>
            <p>We did not know other states could see our data.</p>
          </blockquote>
          <div class="about-card-footer">Weber County commissioner, public meeting, 7 April 2026</div>
        </div>
        <div class="about-detail-grid mt-40">
          <div class="about-detail">
            <strong>Cameras</strong>
            <span>10</span>
          </div>
          <div class="about-detail">
            <strong>Vendor</strong>
            <span>Flock Safety</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- 8. Press coverage: news-section. One news-card per article; video-card for a broadcast segment, where the {{video:...}} placeholder renders the responsive video-embed wrapper for you. -->
<div class="news-section">
  <div class="news-inner">
    <div class="news-section-label">In the press</div>
    <a class="news-card" href="https://example-news.test/story" target="_blank">
      <div class="news-outlet">
        <span class="outlet-badge">Standard-Examiner</span>
      </div>
      <div class="news-content">
        <div class="news-meta">16 March 2026, Ogden</div>
        <h3 class="news-headline">County's plate cameras searched from 45 states, records show</h3>
        <div class="news-excerpt">A nonprofit's records request found more than five million searches against Weber County's ten cameras.</div>
        <div class="news-read-more">Read the article</div>
      </div>
    </a>
    <div class="news-section-label mt-56">On television</div>
    <div class="video-card">
      <div class="video-card-header">
        <span class="outlet-badge">KSL</span>
        <div>
          <div class="video-meta">18 March 2026, Salt Lake City</div>
          <h3 class="video-headline">Who is watching Weber County's cameras?</h3>
        </div>
      </div>
      <p>{{video:YOUTUBE_ID}}</p>
    </div>
    <div class="news-more-cta">
      <p class="mb-16">Read UCC's statement on the county's response.</p>
      <a href="/statements.html" class="btn btn-primary btn-full">Read the statement</a>
    </div>
  </div>
</div>`;

function exampleSection(kit) {
  const inStylesheet = new Set((kit.entries || []).map(e => e.className));
  const offered = new Set((kit.entries || []).filter(e => e.description && !CHROME_GROUPS.has(e.group || 'Site stylesheet')).map(e => e.className));
  const used = new Set();
  for (const m of EXAMPLE_HTML.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) used.add(c);
  const gone = [...used].filter(c => inStylesheet.size && !inStylesheet.has(c)).sort();
  const unused = [...offered].filter(c => !used.has(c)).sort();
  const out = [
    'One fragment that uses the site\'s classes the way the site itself does, with a comment on each block saying what the',
    'pattern is for. Copy the blocks you need, in any order after the hero; a report rarely needs more than three or four.',
    'The content is a sample, not a source.',
    '',
    LIVE_MARKER,
    '',
    '```html',
    EXAMPLE_HTML,
    '```',
    '',
  ];
  if (gone.length) out.push(`**Not in the current stylesheet** (the example is older than the stylesheet; do not use these): ${gone.map(c => `\`${c}\``).join(', ')}.`, '');
  if (unused.length) out.push(`**Offered in 6.5 but not shown above:** ${unused.map(c => `\`${c}\``).join(', ')}. Use them as their CSS describes, or ask the editor.`, '');
  return out.join('\n');
}

function rulesSection(rules) {
  const tpl = (rules || []).filter(r => r.scope === 'template').sort((a, b) => a.priority - b.priority || a.selector.localeCompare(b.selector));
  if (!tpl.length) {
    return [
      '_No template rules are defined yet. Nothing is added on save, so the classes you write (sections 6.4 and 6.5) are the',
      'only styling the page gets until the editor adds more on the Styling tab._',
    ].join('\n');
  }
  return [
    'Every document on the report template gets these classes added automatically when it is saved. You may',
    'write them yourself or leave them off; the editor merges the two (one difference: a class written into the',
    'HTML cannot be switched off from the editor without re-pasting, one added by a rule can).',
    '',
    '| write this | the editor adds | note |',
    '|---|---|---|',
    ...tpl.map(r => `| \`${r.selector}\` | ${(r.classes || []).map(c => `\`${c}\``).join(' ') || '(none)'} | ${dash(r.note) || ''} |`),
  ].join('\n');
}

// Design tokens (the :root block of the live stylesheet) so the CSS in the
// catalog reads: var(--navy-dark) means something to the author.
function designTokensSection(designTokens) {
  const t = dash(designTokens).replace(/;\s*/g, ';\n').trim();
  if (!t) return '_The design tokens could not be read from the live stylesheet; the variable names in the CSS below are the site palette (navy, red, cream, grays)._';
  return ['These are the values behind the `var(--...)` names in the CSS below. For reading only: you cannot write CSS or inline styles.', '', '```css', t, '```'].join('\n');
}

function tokensSection(coverageKeys) {
  const keys = (coverageKeys || []).filter(Boolean);
  return [
    'Two placeholders are expanded when the page is built. They go in a paragraph of their own, as text, exactly as written:',
    '',
    `- \`{{video:YOUTUBE_ID}}\` embeds a YouTube video (the 11-character id from the video URL).`,
    keys.length
      ? `- \`{{coverage:KEY}}\` renders the press-coverage strip for a report. Keys that exist today: ${keys.map(k => `\`${k}\``).join(', ')}. A key that does not exist blocks publishing.`
      : '- `{{coverage:KEY}}` renders the press-coverage strip for a report. No coverage keys exist yet; leave this out.',
    '',
    'Nothing else is a placeholder. Never invent `{{...}}` tokens; an unknown one blocks publishing.',
  ].join('\n');
}

// buildAuthoringKit({ kit, rules, coverageKeys, generatedAt }) → markdown string
export function buildAuthoringKit({ kit, rules = [], coverageKeys = [], designTokens = '', generatedAt = new Date() } = {}) {
  const when = generatedAt.toISOString().slice(0, 10);
  // Accepted by the ingest but not for authors: SVG geometry, site-chrome
  // wrappers, and presentational inline tags the voice rules exclude anyway.
  const tags = ALLOWED_TAGS.filter(t => !['svg', 'g', 'path', 'polyline', 'polygon', 'line', 'circle', 'rect', 'picture', 'source', 'wbr', 'var', 'kbd', 'dfn', 'ins', 'del', 's', 'u', 'b', 'i', 'header', 'footer', 'address'].includes(t));
  return `# Utah Civic Compact: authoring and style kit for long-form pages

Generated ${when} from the live site stylesheet and the admin's current styling rules. Download a fresh copy from the admin (All documents, top of the page) whenever you start a new piece; an old copy may list classes that no longer exist.

## 1. What this file is, and how to use it

This is everything a writing tool needs to produce a long-form page (a report, an investigation, a statement, a policy explainer) that drops straight into the Utah Civic Compact admin. It is written to be handed to Claude, but the rules hold for a person writing in Word or Google Docs too.

**Give the whole file to Claude** before you start: attach it to a conversation, or add it to a Claude Project as project knowledge so it applies to every chat there. Then tell Claude which of three things you want:

| you say | you get | then you |
|---|---|---|
| **"Help me write / edit this piece. Prose only."** | The text, in plain prose with headings. No HTML. | Draft in Claude Docs, Word or Google Docs and export a **.docx**, or save Claude's answer as a **.md** file. In the admin, open the document and use **Upload a file** in the HTML box. The admin converts it to clean HTML for you. |
| **"Give me the HTML fragment."** | An HTML body fragment that follows sections 5 and 6: the site's document frame and the site's own classes, so the page arrives already styled. | Copy it into the **Body HTML** box, or save it as a **.html** file and upload it. |
| **"Convert my draft to the HTML fragment."** (paste or attach your finished draft) | The same fragment, built from text you already wrote. | Same as above. |

Whichever route, Claude must also return the **page fields** block in section 3. Those are typed into the admin by hand; they are not part of the body.

The HTML route is the one that lands styled: the body of a document is placed directly between the site's header and footer with nothing around it, so the fragment itself supplies the page frame and the classes (section 6 has all of them, with the CSS each one applies). The prose route arrives as plain tags and is styled by the editor afterwards. In both cases the admin runs the HTML through a cleaner that removes anything unsafe, shows a live preview on the real page design, and a second person approves the publish. The text must be **correct, well structured and in the site's voice**; the styling should match what section 6 describes.

### Instructions for Claude

You are helping write a long-form page for Utah Civic Compact (UCC), a Utah nonprofit. The site publishes investigations built on public records, statements, and policy positions on surveillance, privacy and how Utah governments treat the people they serve. The reader is a Utah resident, a reporter or a county official: intelligent, busy, not a specialist. Everything below is binding. If the author's draft breaks a rule in section 2, fix it and say what you changed. If a request would break a rule in section 5, say so instead of producing invalid output. When you return HTML, use the document frame and the site classes in section 6; they are the site's real stylesheet, and HTML without them renders as unstyled text on the live page. Never reuse class names seen on an existing page of the site: those pages carry private CSS and their classes are stripped on save (section 5 lists the usual offenders). Never add facts, figures, names or quotes the author did not supply or that are not in the records they gave you; mark anything uncertain with \`[CHECK: ...]\` so a person resolves it before publishing.

## 2. Voice: how UCC writes, and what it never does

UCC writes like a careful reporter with the documents on the desk. Plain declarative sentences. Specific nouns. The finding first, the method second, the opinion last and labelled as opinion. The page should read as if one person wrote it in one sitting.

### Do

- **Lead with the finding.** The first sentence of the piece, and of every section, states what the records show. Background comes after, not before.
- **Name the record.** "Records Weber County released under GRAMA on 14 March 2026 show..." beats "data shows". Say who produced the document, what it is, and when. Link it where a link exists.
- **Use exact figures** from the records (5,171,087, not "more than five million") the first time; a rounded figure may follow once the exact one has been given.
- **Quote people exactly**, with their name and title, and say where the quote comes from (a hearing, an email obtained by records request, an interview with UCC on a date).
- **Say what is not known.** A sentence that admits a gap ("The county did not say which agencies ran the searches") builds more trust than one that papers over it.
- **Headings state findings, not topics.** "Deputies ran 13,100 searches" rather than "Findings" or "Key Takeaways". Sentence case, no colon-headline constructions.
- **Vary paragraph length** the way a human does: some three sentences, some one. Let a short paragraph land only when the fact deserves it.
- **Call a thing by one name** throughout. The camera is the camera every time; do not rotate synonyms to avoid repetition.
- **Dates:** 14 March 2026 or March 14, 2026, consistently within a piece. **Numbers:** digits for 10 and above and for every figure from a record; spell out one to nine in prose.
- **Links:** descriptive link text ("the county's 2025 vendor contract"), never "here" or "this link".

### Don't (these mark text as machine-written, and UCC does not publish them)

- **No em dashes or en dashes** as punctuation. None. Use a comma, a period, a colon, or parentheses. Hyphens stay in hyphenated words (license-plate reader).
- **No triplets for rhythm.** "Fast, fair and free." "Reporters, residents and officials." Three adjectives or three nouns in a row, chosen for cadence rather than because exactly three things exist, are a tell. Use two, or four, or the real number.
- **No "it's not X, it's Y" framings** or any of their cousins: "This isn't about cameras. It's about trust." "Not only X but also Y." "X is more than Y; it is Z." State the point directly.
- **No contrast-for-effect openers:** "While many believe...", "In an era of...", "In today's world...", "In the landscape of...", "As technology evolves...".
- **No signposting or throat-clearing:** "It's worth noting", "It's important to remember", "Let's dive in", "Let's break it down", "Here's the thing", "Here's why that matters", "This section will explore", "As mentioned above", "In this piece we".
- **No rhetorical question answered in the next sentence.** "So what does this mean? It means..." Write the meaning.
- **No dramatic fragments or one-line paragraphs for punch.** "And that matters." "Every single one." "Full stop."
- **No stock closers:** "In conclusion", "Ultimately", "At the end of the day", "The bottom line is", "Moving forward", "Only time will tell", and no hopeful uplift ending ("Together, we can build...").
- **No hollow intensifiers or buzzwords:** crucial, vital, pivotal, robust, comprehensive, seamless, transformative, game-changing, groundbreaking, cutting-edge, landscape, navigate, delve, tapestry, underscore, testament, leverage, foster, empower, unlock, harness, elevate, journey, realm, beacon, paradigm, holistic, nuanced, multifaceted, stark reminder, chilling, sobering, deeply, profoundly, remarkable, striking.
- **No sentence openers of the "Moreover / Furthermore / Additionally / Notably / Importantly / Interestingly" kind.** Start with the subject.
- **No vague attribution:** "experts say", "studies show", "critics argue", "many believe", "some have raised concerns". Name the expert, the study, the critic, or cut the sentence.
- **No hedging stacks:** "arguably", "it could be said", "in some ways", "to some extent", "may potentially".
- **No addressing the reader's feelings:** "You might be surprised to learn", "Imagine if", "Picture this".
- **No bullet lists in place of prose** in the body of a piece. Bullets are for genuinely list-shaped content (a list of agencies, steps in a records request). Never a bolded label at the start of every bullet.
- **No emoji, no exclamation marks, no title-case headings, no ALL CAPS for emphasis.**
- **No summary paragraph that restates the piece**, and no "Key takeaways" box unless the author asked for one.
- **No invented specificity.** Do not add a number, a date, a quote or a name to make a sentence feel grounded. Use \`[CHECK: ...]\`.

A quick self-test before returning a draft: search it for " - ", the em dash character (U+2014), "not only", "it's not", "isn't about", "crucial", "delve", "landscape", "navigate", "ultimately", "in conclusion", "moreover", "furthermore", "experts", "studies show". Every hit is a rewrite.

## 3. Page fields (returned with every draft)

The admin stores these separately from the body. Return them at the top of your answer in exactly this block, then the body.

\`\`\`
Title:            (the page headline; this becomes the <h1> and the browser title; 12 words or fewer)
Slug:             (the URL path: lowercase letters, digits and dashes, e.g. box-elder-alpr-report)
Category:         (Reports, Statements, Policy, or one that already exists in the admin)
Author:           (the team member's name exactly as it appears on the Team page)
Meta description: (one or two sentences, 120 to 155 characters, stating the finding; required to publish)
Keywords:         (optional, five or fewer, comma separated)
Social title:     (optional, if the headline is too long for a share card)
\`\`\`

## 4. Shape of a piece

Whether you return prose or HTML, the structure is the same.

1. **One headline.** One \`<h1>\` (or one top-level heading in prose). Never two.
2. **A lead paragraph** of one to three sentences: what the records show, in plain words. A reader who stops here should know the finding.
3. **Sections under \`<h2>\`**, each heading a finding. **Subsections under \`<h3>\`.** Never skip a level (no \`<h2>\` followed by \`<h4>\`).
4. **Provenance**, early: where the records came from, what was requested, what was released, what was withheld, and the date range.
5. **The evidence**: quotes, tables, figures, each attributed in the text next to it. A table needs a caption or a sentence introducing it.
6. **What is unknown**, and what UCC asked that went unanswered.
7. **What UCC recommends or will do next**, if anything, in a section of its own so fact and position do not mix.
8. **No "About UCC" paragraph, no "Contact" block, no signature** at the end; the site adds the footer. The site does not print a byline or a date on the page itself (the Author field feeds the page's structured data only), so if the piece is bylined, put one line at the end of the hero: \`<p>By [Name], 14 March 2026</p>\`.

Images are not part of the draft. If a chart or a document scan belongs in the piece, write a one-line note where it goes (\`[IMAGE: the vendor contract, page 3, signature block]\`) and the editor uploads it on the admin's Media page and inserts it with alt text. Alt text is required for every image, so suggest it in the note.

## 5. HTML rules (only when returning HTML)

Return a **body fragment**: the content that goes inside the page's \`<main>\`. No \`<!DOCTYPE>\`, \`<html>\`, \`<head>\`, \`<body>\`, no \`<main>\` wrapper, no \`<header>\`/\`<nav>\`/\`<footer>\` (the site adds those). Put it in one code block with nothing before or after it.

**Allowed tags** (anything else is removed on save and reported to the editor):

\`${tags.join('`, `')}\`

**Attributes:** \`href\`, \`target="_blank"\` (external links only), \`src\`, \`alt\`, \`width\`, \`height\`, \`colspan\`, \`rowspan\`, \`datetime\`, \`lang\`, \`class\` (section 6 only), \`id\` (headings only, lowercase-dashed). Nothing else.

**Never:**

- \`style="..."\` on any element, \`<style>\` blocks, \`<script>\`, \`<iframe>\`, \`<form>\`, \`<input>\`, \`<button>\`, \`<video>\`, \`<audio>\`, \`<object>\`, \`<embed>\`, \`<link>\`, \`<meta>\`. All removed on save.
- \`onclick\` or any \`on*\` attribute; \`javascript:\` or \`data:\` URLs. Removed.
- Classes that are not in the site stylesheet (section 6.5 lists every one an author can use). Unknown classes are stripped and reported, so they only make work. No invented class names, no Tailwind or Bootstrap classes.
- **Classes copied from an existing page on the site.** The published reports and papers (alpr, how-did-this-happen, privacy-report, stratos and the rest) carry their own private per-page CSS; their classes (paper-body, paper-inner, release-meta, release-badge, paper-toc, ask-box, sources-list, related-cta, hero-ctas, btn-file, report-section, report-callout and so on) are not in the site stylesheet and are stripped on save, which leaves the page as bare text. Do not fetch a live page and imitate its markup. Build from the frame in 6.1 and the classes in 6.5 only; a table of contents is a \`callout\`, a byline is a \`<p>\` in the hero, an "ask" box is a \`callout-dark\`.
- Markdown inside the HTML (\`**bold**\`, \`# heading\`). It is published literally.
- Font tags, \`<center>\`, \`<font>\`, \`&nbsp;\` runs for spacing, \`<br>\` to make paragraphs. Use \`<p>\`.
- \`<h1>\` more than once, or a heading level that skips. These block publishing.
- \`<img>\` without \`alt\`. Blocks publishing. Use \`alt=""\` only for a purely decorative image.
- External \`<a>\` without \`target="_blank"\`; the site adds \`rel="noopener"\` itself.

**Do:**

- Wrap every paragraph in \`<p>\`. Use \`<strong>\` for emphasis that matters and \`<em>\` for titles of works and the occasional stress. Nothing else is emphasised.
- \`<blockquote>\` for a quoted passage longer than a sentence, with the attribution in a \`<p>\` right after it (or \`<cite>\` inside a \`<figcaption>\` when the quote is in a \`<figure>\`).
- \`<table>\` with \`<thead>\`, \`<tbody>\`, \`<th>\` in the header row and a \`<caption>\`. One table per data set, no tables for layout.
- \`<figure>\` + \`<figcaption>\` for an image or a table that needs a caption.
- \`<ul>\`/\`<ol>\` only for list-shaped content (section 2).
- \`<time datetime="2026-03-14">14 March 2026</time>\` for dates the piece hinges on.
- Links to documents on the Internet Archive or a government site are preferred to links on a vendor's site.
- Keep the HTML readable: one block element per line, two-space indentation, no minification.

**Placeholders the site expands**

${tokensSection(coverageKeys)}

### Skeleton

Everything a report needs, and nothing it does not, inside the site's document frame (section 6.1: hero, then section > container > prose). Replace the bracketed text.

\`\`\`html
<div class="subpage-hero">
  <div class="section-label">[Category eyebrow, e.g. Surveillance investigation]</div>
  <h1>[The finding, as a headline]</h1>
  <p>[Lead: one to three sentences stating what the records show.]</p>
</div>

<section class="section bg-cream">
  <div class="container">
    <div class="prose">

      <h2>[Where the records came from]</h2>
      <p>[Who released what, under which law, on which date; what was withheld.]</p>
      <div class="callout">
        <strong class="callout-label">A note on the records</strong>
        <p>[What was requested, what was withheld, and why that matters.]</p>
      </div>

      <h2>[First finding]</h2>
      <p>[Evidence, attributed.]</p>
      <blockquote>
        <p>[Quoted passage.]</p>
      </blockquote>
      <p>[Who said it, where, when.]</p>

      <h3>[Supporting detail]</h3>
      <table>
        <caption>[What this table shows and its source]</caption>
        <thead><tr><th>[Column]</th><th>[Column]</th></tr></thead>
        <tbody>
          <tr><td>[Value]</td><td>[Value]</td></tr>
        </tbody>
      </table>

      <h2>[Second finding]</h2>
      <p>[...]</p>

      <h2>What the county did not answer</h2>
      <p>[...]</p>

      <h2>What UCC recommends</h2>
      <p>[...]</p>

    </div>
  </div>
</section>
\`\`\`

## 6. Styling: the site's stylesheet, and how a document uses it

A document's body is inserted between the site header and footer with no wrapper of its own, so the fragment carries its own structure. 6.1 gives the frame, 6.4 a full reference fragment showing the classes in use, 6.5 every class with its CSS, read from the live stylesheet when this file is generated. Use them to choose patterns that fit the content: a stats band for the key figures, a cream band to set a section apart, a card grid for parallel items. Keep the writing rules in section 2 regardless of layout; a stats band does not excuse a triplet.

### 6.1 Document frame

1. **Hero:** \`<div class="subpage-hero">\` holding an optional \`<div class="section-label">\` eyebrow, the single \`<h1>\`, and one or two \`<p>\` for the lead. The hero styles its own \`<h1>\` and \`<p>\` (dark navy gradient, white display headline).
2. **Body:** one or more \`<section class="section">\`, each wrapping a \`<div class="container">\` that holds the content. \`section\` gives the vertical padding, \`container\` the centred max width. Alternate \`<section class="section bg-cream">\` for a cream band when a part of the piece should sit apart (the data, the recommendations).
3. **Running text goes inside \`<div class="prose">\`**, directly inside the container. \`prose\` styles every plain tag in it: \`<h2>\`, \`<h3>\`, \`<p>\`, \`<ul>\`, \`<blockquote>\`, \`<table>\`, \`<figure>\`, links, on a centred 760px measure. Without it the site stylesheet's reset leaves plain text with no spacing at all, so every section of running text needs it. Inside \`prose\`, write plain tags; the only classes that belong there are \`callout\`, \`callout-dark\` and \`callout-label\`.
4. Site-pattern sections (stats band, card grids, the two-column block) sit beside the prose sections as their own \`<section>\`, not inside \`prose\`. Add \`section-label\` and \`section-title\` to those sections' eyebrow and heading so they read as site sections.

### 6.2 Design tokens

${designTokensSection(designTokens)}

### 6.3 Template rules (added for you on save)

${rulesSection(rules)}

### 6.4 Reference fragment: the classes in use

${exampleSection(kit)}

### 6.5 Classes you may use, with the CSS each applies

Use these, and only these, in \`class="..."\`. A class seen on a live page of the site but missing from this list does not exist for a document. "On" lists the elements the class was written for; another element works if the CSS makes sense there. Where the CSS line shows \`/* + */\`, a further rule (a media query or a combined selector) also sets what follows. Say in a note to the editor when you want a look that no class gives; do not improvise one.

${catalogSection(kit)}

Classes that exist in the stylesheet but are not listed here are site chrome (navigation, footer, forms, the donation page, the homepage hero) or undocumented. The editor can see every class on the admin's Styles page; an author should not use them.

## 7. Before you hand it over

- [ ] Page fields block (section 3) at the top, every required line filled.
- [ ] Exactly one headline. Headings in order, none skipped, each one a finding in sentence case.
- [ ] Lead paragraph states the finding. Provenance section names the records and the dates.
- [ ] Every figure, quote and name traces to a record the author supplied. Anything else is marked \`[CHECK: ...]\`.
- [ ] Voice self-test (end of section 2) returns zero hits.
- [ ] No image tags; \`[IMAGE: ...]\` notes with suggested alt text instead.
- [ ] HTML route only: fragment only, inside the document frame (6.1), allowed tags only, no inline styles, classes from 6.5 only (6.4 shows them in use), one code block.
- [ ] Prose route only: saved as .docx (from Claude Docs, Word or Google Docs) or .md, ready for **Upload a file** in the admin.

The admin page is ${SITE.replace('https://', 'https://admin.')} > All documents. The live site is ${SITE}.
`;
}

// Styles for the guide text only (class-scoped to .kit-doc so the live
// fragment keeps the site's own rendering). The site stylesheet resets
// margins, bullets and link underlines; these put them back for prose.
const KIT_CSS = `
.kit-doc { max-width: 900px; margin: 0 auto; padding: 48px 24px 24px; }
.kit-doc h1 { font-size: 36px; line-height: 1.15; margin: 0 0 16px; color: var(--navy-dark); }
.kit-doc h2 { font-size: 26px; line-height: 1.2; margin: 48px 0 12px; padding-top: 24px; border-top: 1px solid var(--gray-200); color: var(--navy-dark); }
.kit-doc h3 { font-size: 19px; margin: 28px 0 8px; color: var(--navy); }
.kit-doc p { margin: 0 0 14px; line-height: 1.65; }
.kit-doc ul { list-style: disc; padding-left: 24px; margin: 0 0 14px; }
.kit-doc ol { padding-left: 24px; margin: 0 0 14px; }
.kit-doc li { margin: 4px 0; line-height: 1.6; }
.kit-doc a { color: var(--red); text-decoration: underline; }
.kit-doc code { font-family: ui-monospace, Consolas, Menlo, monospace; font-size: 0.9em; background: var(--gray-100); padding: 1px 5px; border-radius: 4px; }
.kit-doc pre { background: var(--navy-dark); color: #e6edf3; padding: 18px 20px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.5; margin: 0 0 18px; }
.kit-doc pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
.kit-doc table { border-collapse: collapse; width: 100%; margin: 0 0 18px; font-size: 14px; }
.kit-doc th, .kit-doc td { border: 1px solid var(--gray-200); padding: 8px 10px; text-align: left; vertical-align: top; }
.kit-doc th { background: var(--gray-50); }
.kit-doc blockquote { border-left: 3px solid var(--red); padding: 4px 16px; color: var(--gray-600); margin: 0 0 14px; }
.kit-doc input[type="checkbox"] { margin-right: 6px; }
.kit-note { background: var(--cream); border-left: 4px solid var(--red); padding: 16px 20px; border-radius: 6px; margin: 0 0 24px; }
.kit-note p:last-child { margin-bottom: 0; }
.kit-warn { background: #fdecea; border-left-color: var(--red); }
.kit-live { max-width: 1240px; margin: 0 auto 24px; border: 2px dashed var(--red); border-radius: 8px; overflow: hidden; }
.kit-live-label { background: var(--red); color: var(--white); font: 700 12px/1 var(--font-sans); letter-spacing: 0.08em; text-transform: uppercase; padding: 10px 16px; }
.kit-live-label span { font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 10px; }
`;

const FILE_NOTE = `<div class="kit-note">
<p><strong>About this file.</strong> One self-contained page: the writing rules, the page fields, the HTML the editor accepts, the site's design tokens, every class an author may use with its CSS, and a reference fragment rendered live below in section 6.4. Open it in a browser to see the site's patterns; hand the file itself to Claude (attach it, or add it to a Claude Project) so it reads the markup and the CSS together.</p>
<p><strong>The stylesheet in this file is for reading, not copying.</strong> The <code>&lt;style&gt;</code> block in this page's head is the site's live stylesheet, embedded so this page renders the way the site does and so a machine can read each class's CSS beside the markup that uses it. On the site itself a document body never carries a <code>&lt;style&gt;</code> block or a <code>style="..."</code> attribute: the editor strips both on save and the page's security policy blocks inline styles. Styling is done with the classes in sections 6.1 to 6.5, nothing else.</p>
</div>`;

// buildAuthoringKitHtml({ kit, rules, coverageKeys, designTokens, siteCss, notice, generatedAt }) → one .html document
// notice: optional plain-text warning shown first (the live stylesheet lags the repo, so this kit may be missing classes).
export function buildAuthoringKitHtml({ siteCss = '', notice = '', ...rest } = {}) {
  const warning = notice ? `<div class="kit-note kit-warn"><p><strong>Warning: this kit may be incomplete.</strong> ${esc(notice)} Download it again after the deploy and publish.</p></div>\n` : '';
  const md = buildAuthoringKit(rest);
  const title = (md.match(/^# (.+)$/m) || [])[1] || 'Utah Civic Compact: authoring and style kit';
  const body = marked.parse(md, { gfm: true, breaks: false, async: false });
  const [before, after = ''] = body.split(LIVE_MARKER);
  const live = `<div class="kit-live"><div class="kit-live-label">Rendered with the live stylesheet<span>the fragment below, as the site would show it; its source follows</span></div>\n${EXAMPLE_HTML}\n</div>`;
  const safeCss = String(siteCss || '').replace(/<\/style/gi, '<\/style');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<!-- The site's live stylesheet, verbatim, so this page renders like the site. For reading only: a document body on the site never carries <style> or style= (see the note at the top of the page). -->
<style>
${safeCss}
</style>
<!-- Styles for this guide's own text (.kit-doc); the rendered fragment inside .kit-live uses the site stylesheet alone. -->
<style>${KIT_CSS}</style>
</head>
<body>
<div class="kit-doc">
${warning}${FILE_NOTE}
${before}
</div>
${live}
<div class="kit-doc">
${after}
</div>
</body>
</html>
`;
}
