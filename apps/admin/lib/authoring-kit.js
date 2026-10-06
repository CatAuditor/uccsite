// Authoring kit (docs/systems/documents.md "Authoring kit"): ONE markdown
// file an author gives to Claude, or any writing tool, before drafting a
// long-form piece. It carries the voice rules, the page fields the admin
// needs, the HTML the ingest accepts, the template rules that style a
// document on arrival and the live Style Kit catalog. The static sections
// live here; the dynamic ones are read from the live stylesheet and the
// database at download time (app/documents/authoring-kit/route.js) so the
// file never drifts from what the editor actually does. Pure: no I/O.
import { ALLOWED_TAGS } from '@uccsite/html-ingest';

const SITE = 'https://utahciviccompact.org';

// Classes the ingest accepts but an author never writes (site chrome, forms,
// nav). The catalog hides these groups so the author sees only what can go
// inside a document body.
const CHROME_GROUPS = new Set(['Navigation', 'Footer', 'Forms', 'Modal', 'Donations', 'Hero', 'Mission & pillars', 'About', 'Impact stats', 'Policy positions', 'News & coverage']);

const dash = (s) => String(s || '').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();

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
    out.push('| class | use on | what it does |', '|---|---|---|');
    for (const e of entries.sort((a, b) => a.className.localeCompare(b.className))) {
      out.push(`| \`${e.className}\` | ${e.applies?.length ? e.applies.map(t => `\`<${t}>\``).join(', ') : 'any'} | ${dash(e.description)} |`);
    }
    out.push('');
  }
  if (!out.length) out.push('_No annotated classes were found in the live stylesheet. Write plain semantic HTML; the editor styles it._', '');
  return out.join('\n');
}

function rulesSection(rules) {
  const tpl = (rules || []).filter(r => r.scope === 'template').sort((a, b) => a.priority - b.priority || a.selector.localeCompare(b.selector));
  if (!tpl.length) {
    return [
      '_No template rules are defined yet, so a new document arrives unstyled and the editor applies classes',
      'by hand on the Styling tab. Write plain semantic HTML anyway: rules are added against exactly that shape._',
    ].join('\n');
  }
  return [
    'Every document on the report template gets these classes added automatically when it is saved.',
    'Write the plain tag on the left; **do not add the class on the right yourself** (it is applied for you,',
    'and a class written into the HTML cannot be turned off from the editor).',
    '',
    '| write this | the editor adds | note |',
    '|---|---|---|',
    ...tpl.map(r => `| \`${r.selector}\` | ${(r.classes || []).map(c => `\`${c}\``).join(' ') || '(none)'} | ${dash(r.note) || ''} |`),
  ].join('\n');
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
export function buildAuthoringKit({ kit, rules = [], coverageKeys = [], generatedAt = new Date() } = {}) {
  const when = generatedAt.toISOString().slice(0, 10);
  // Accepted by the ingest but not for authors: SVG geometry, site-chrome
  // wrappers, and presentational inline tags the voice rules exclude anyway.
  const tags = ALLOWED_TAGS.filter(t => !['svg', 'g', 'path', 'polyline', 'polygon', 'line', 'circle', 'rect', 'picture', 'source', 'wbr', 'var', 'kbd', 'dfn', 'ins', 'del', 's', 'u', 'b', 'i', 'header', 'footer', 'address'].includes(t));
  return `# Utah Civic Compact: authoring kit for long-form pages

Generated ${when} from the live site stylesheet and the admin's current styling rules. Download a fresh copy from the admin (All documents, top of the page) whenever you start a new piece; an old copy may list classes that no longer exist.

## 1. What this file is, and how to use it

This is everything a writing tool needs to produce a long-form page (a report, an investigation, a statement, a policy explainer) that drops straight into the Utah Civic Compact admin. It is written to be handed to Claude, but the rules hold for a person writing in Word or Google Docs too.

**Give the whole file to Claude** before you start: attach it to a conversation, or add it to a Claude Project as project knowledge so it applies to every chat there. Then tell Claude which of three things you want:

| you say | you get | then you |
|---|---|---|
| **"Help me write / edit this piece. Prose only."** | The text, in plain prose with headings. No HTML. | Draft in Claude Docs, Word or Google Docs and export a **.docx**, or save Claude's answer as a **.md** file. In the admin, open the document and use **Upload a file** in the HTML box. The admin converts it to clean HTML for you. |
| **"Give me the HTML fragment."** | An HTML body fragment that follows section 5. | Copy it into the **Body HTML** box, or save it as a **.html** file and upload it. |
| **"Convert my draft to the HTML fragment."** (paste or attach your finished draft) | The same fragment, built from text you already wrote. | Same as above. |

Whichever route, Claude must also return the **page fields** block in section 3. Those are typed into the admin by hand; they are not part of the body.

What happens next is the editor's job, not yours: the admin runs the HTML through a cleaner that removes anything unsafe, applies the site's styling rules, shows a live preview on the real page design, and a second person approves the publish. You do not need to make it look right; you need to make it **correct, well structured and in the site's voice**.

### Instructions for Claude

You are helping write a long-form page for Utah Civic Compact (UCC), a Utah nonprofit. The site publishes investigations built on public records, statements, and policy positions on surveillance, privacy and how Utah governments treat the people they serve. The reader is a Utah resident, a reporter or a county official: intelligent, busy, not a specialist. Everything below is binding. If the author's draft breaks a rule in section 2, fix it and say what you changed. If a request would break a rule in section 5, say so instead of producing invalid output. Never add facts, figures, names or quotes the author did not supply or that are not in the records they gave you; mark anything uncertain with \`[CHECK: ...]\` so a person resolves it before publishing.

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
8. **No signature, no date line, no "About UCC" paragraph, no "Contact" block** at the end. The site adds the byline, the date and the footer.

Images are not part of the draft. If a chart or a document scan belongs in the piece, write a one-line note where it goes (\`[IMAGE: the vendor contract, page 3, signature block]\`) and the editor uploads it on the admin's Media page and inserts it with alt text. Alt text is required for every image, so suggest it in the note.

## 5. HTML rules (only when returning HTML)

Return a **body fragment**: the content that goes inside the page's \`<main>\`. No \`<!DOCTYPE>\`, \`<html>\`, \`<head>\`, \`<body>\`, no \`<main>\` wrapper, no \`<header>\`/\`<nav>\`/\`<footer>\` (the site adds those). Put it in one code block with nothing before or after it.

**Allowed tags** (anything else is removed on save and reported to the editor):

\`${tags.join('`, `')}\`

**Attributes:** \`href\`, \`target="_blank"\` (external links only), \`src\`, \`alt\`, \`width\`, \`height\`, \`colspan\`, \`rowspan\`, \`datetime\`, \`lang\`, \`class\` (section 6 only), \`id\` (headings only, lowercase-dashed). Nothing else.

**Never:**

- \`style="..."\` on any element, \`<style>\` blocks, \`<script>\`, \`<iframe>\`, \`<form>\`, \`<input>\`, \`<button>\`, \`<video>\`, \`<audio>\`, \`<object>\`, \`<embed>\`, \`<link>\`, \`<meta>\`. All removed on save.
- \`onclick\` or any \`on*\` attribute; \`javascript:\` or \`data:\` URLs. Removed.
- Classes that are not in section 6. They are stripped and reported, so they only make work.
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

Everything a report needs, and nothing it does not. Replace the bracketed text.

\`\`\`html
<h1>[The finding, as a headline]</h1>
<p>[Lead: one to three sentences stating what the records show.]</p>

<h2>[Where the records came from]</h2>
<p>[Who released what, under which law, on which date; what was withheld.]</p>

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
\`\`\`

## 6. Styling: what is applied for you, and the classes you may use

The editor styles a document; the HTML stays plain. Two mechanisms, in this order:

**Template rules** match plain tags by position and add classes on save. This is why section 5 asks for plain semantic HTML: the rules are written against that shape.

${rulesSection(rules)}

**Style Kit classes** are the only classes an author may write into the HTML, and only where a specific look is wanted that the rules do not give (a callout, a utility spacing class, a cream band). When in doubt, leave the class off and say in a note to the editor what you wanted; they can add it in two clicks and it survives re-pasting. A class written into the HTML cannot be removed from the editor without re-pasting.

${catalogSection(kit)}

Classes that exist in the stylesheet but are not listed here are either site chrome (navigation, forms, the donation page) or undocumented. The editor can see every class on the admin's Styles page; an author should not use them.

## 7. Before you hand it over

- [ ] Page fields block (section 3) at the top, every required line filled.
- [ ] Exactly one headline. Headings in order, none skipped, each one a finding in sentence case.
- [ ] Lead paragraph states the finding. Provenance section names the records and the dates.
- [ ] Every figure, quote and name traces to a record the author supplied. Anything else is marked \`[CHECK: ...]\`.
- [ ] Voice self-test (end of section 2) returns zero hits.
- [ ] No image tags; \`[IMAGE: ...]\` notes with suggested alt text instead.
- [ ] HTML route only: fragment only, allowed tags only, no inline styles, no unlisted classes, one code block.
- [ ] Prose route only: saved as .docx (from Claude Docs, Word or Google Docs) or .md, ready for **Upload a file** in the admin.

The admin page is ${SITE.replace('https://', 'https://admin.')} > All documents. The live site is ${SITE}.
`;
}
