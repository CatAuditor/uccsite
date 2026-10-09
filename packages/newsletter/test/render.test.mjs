import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderEmail, previewHtml, normalizeBlocks, normalizeTheme, fromHeader, safeUrl, UNSUBSCRIBE_TOKEN, DEFAULT_THEME, MAX_BLOCKS, LOGO_URL,
} from '../render.mjs';

const doc = {
  subject: 'Latest from the Compact',
  preheader: 'Three investigations in three weeks',
  headline: "We've been busy.",
  blocks: [
    { type: 'heading', text: 'What happened' },
    { type: 'text', markdown: 'We **accused** MIDA of *breaking* the law. Read [the report](https://utahciviccompact.org/mida).\n\n- one\n- two\n\n## Next\nMore coming.' },
    { type: 'button', label: 'Read more', url: 'https://utahciviccompact.org' },
    { type: 'image', url: 'https://utahciviccompact.org/media/x/a-800.webp', alt: 'Capitol', caption: 'The Capitol' },
    { type: 'quote', text: 'Sunlight is the best disinfectant.', cite: 'Brandeis' },
    { type: 'divider' },
  ],
};

test('renders every block type with escaped text and the unsubscribe token', () => {
  const { html, text } = renderEmail(doc);
  assert.match(html, /<h2 class="em-h"[^>]*>What happened<\/h2>/);
  assert.match(html, /<strong>accused<\/strong> MIDA of <em>breaking<\/em>/);
  assert.match(html, /<a href="https:\/\/utahciviccompact.org\/mida" class="em-link"/);
  assert.match(html, /<li class="em-text"[^>]*>one<\/li>/);
  assert.match(html, /<p class="em-h"[^>]*>Next<\/p>/);
  assert.match(html, /<a href="https:\/\/utahciviccompact.org" class="em-btn" style="[^"]*">Read more<\/a>/);
  assert.match(html, /<img src="https:\/\/utahciviccompact.org\/media\/x\/a-800.webp" alt="Capitol"/);
  assert.match(html, /<blockquote[^>]*>Sunlight is the best disinfectant\.<p[^>]*>— Brandeis<\/p><\/blockquote>/);
  assert.match(html, /<hr class="em-rule"/);
  assert.match(html, /<h1[^>]*>We&#39;ve been busy\.<\/h1>/);
  assert.ok(html.includes(`href="${UNSUBSCRIBE_TOKEN}"`));
  assert.ok(html.includes('Three investigations in three weeks'));
  assert.ok(text.includes("WE'VE BEEN BUSY."));
  assert.ok(text.includes('Read more: https://utahciviccompact.org'));
  assert.ok(text.includes('the report (https://utahciviccompact.org/mida)'));
  assert.ok(text.includes(`Unsubscribe: ${UNSUBSCRIBE_TOKEN}`));
});

test('author text never survives as markup', () => {
  const { html } = renderEmail({ subject: '<s>', headline: '<script>alert(1)</script>', blocks: [
    { type: 'text', markdown: '<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://a.b)' },
    { type: 'button', label: '<b>', url: 'javascript:alert(1)' },
    { type: 'image', url: 'data:image/png;base64,AAAA', alt: 'x' },
  ], theme: { eyebrow: '<i>', footer: '<u>' } });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('data:image'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;i&gt;'));
  assert.match(html, /<a href="https:\/\/a.b" class="em-link"/);
  assert.ok(!/<a href="javascript/.test(html));
});

test('dark mode: auto carries the media query, dark applies it unconditionally, light omits it', () => {
  const auto = renderEmail(doc, { mode: 'auto' }).html;
  const dark = renderEmail(doc, { mode: 'dark' }).html;
  const light = renderEmail(doc, { mode: 'light' }).html;
  assert.ok(auto.includes('@media (prefers-color-scheme: dark)'));
  assert.ok(auto.includes('[data-ogsc] .em-bg'));
  assert.ok(!dark.includes('@media (prefers-color-scheme: dark)'));
  assert.ok(dark.includes('.em-bg{background:#0f1e33!important;}'));
  assert.ok(!light.includes('.em-bg{background:#0f1e33'));
  assert.ok(auto.includes('<meta name="color-scheme" content="light dark">'));
});

test('letterhead copies the site: logo mark + org name linking home, navy bands, sans type', () => {
  const { html } = renderEmail(doc);
  assert.ok(html.includes(`<img src="${LOGO_URL}" alt="" width="38" height="44"`));
  assert.match(html, /<a href="https:\/\/utahciviccompact.org" style="color:#ffffff;[^"]*">Utah Civic Compact<\/a>/);
  assert.equal((html.match(/class="em-band" bgcolor="#1b2f4e"/g) || []).length, 2, 'header and footer bands carry the accent');
  assert.ok(html.includes("font-family:'Inter', -apple-system"));
  assert.ok(html.includes('background:#f5f1ea'));
  assert.ok(html.includes('501(c)(4)'));
  assert.equal(DEFAULT_THEME.eyebrow, '');
  // No eyebrow by default; one that only repeats the org name (older drafts) is not drawn.
  assert.ok(!/text-transform:uppercase/.test(html));
  assert.ok(!/text-transform:uppercase/.test(renderEmail({ ...doc, theme: { eyebrow: 'Utah Civic Compact' } }).html));
  assert.match(renderEmail({ ...doc, theme: { eyebrow: 'October update' } }).html, /text-transform:uppercase;[^"]*">October update<\/p>/);
  // The logo link is a site link, so a campaign tags it like any other.
  assert.ok(renderEmail(doc, { siteUrl: 'https://utahciviccompact.org', campaign: 'c1' }).html.includes('<a href="https://utahciviccompact.org?utm_source=newsletter&utm_medium=email&utm_campaign=c1" style="text-decoration:none;"><img'));
});

test('previewHtml neutralises the unsubscribe token', () => {
  const html = previewHtml(doc, 'light');
  assert.ok(!html.includes(UNSUBSCRIBE_TOKEN));
  assert.ok(html.includes('href="#"'));
});

test('normalizeBlocks drops junk, clips, filters urls and caps the count', () => {
  const blocks = normalizeBlocks([
    { type: 'heading', text: '  ' },
    { type: 'nope', text: 'x' },
    'string',
    { type: 'button', label: 'Go', url: 'ftp://x' },
    { type: 'button', label: 'Go', url: 'https://x.y', align: 'left' },
    { type: 'image', url: 'https://x.y/a.png', alt: 'a', link: 'mailto:x@y' },
    { type: 'text', markdown: 'a\r\nb' },
    { type: 'divider' },
  ]);
  assert.deepEqual(blocks, [
    { type: 'button', label: 'Go', url: 'https://x.y', align: 'left' },
    { type: 'image', url: 'https://x.y/a.png', alt: 'a' },
    { type: 'text', markdown: 'a\nb' },
    { type: 'divider' },
  ]);
  assert.throws(() => normalizeBlocks(Array.from({ length: MAX_BLOCKS + 1 }, () => ({ type: 'divider' }))), /At most/);
  assert.deepEqual(normalizeBlocks(null), []);
});

test('normalizeTheme validates colours and fonts', () => {
  assert.deepEqual(normalizeTheme(), DEFAULT_THEME);
  const t = normalizeTheme({ accent: '#ABCDEF', highlight: 'red', font: 'sans', eyebrow: 'X', footer: 'F' });
  assert.equal(t.accent, '#abcdef');
  assert.equal(t.highlight, DEFAULT_THEME.highlight);
  assert.equal(t.font, 'sans');
  assert.equal(t.eyebrow, 'X');
  const { html } = renderEmail({ blocks: [], theme: t });
  assert.ok(html.includes('Helvetica'));
  assert.ok(html.includes('#abcdef'));
});

test('fromHeader keeps the address and carries the author in the display name', () => {
  assert.equal(fromHeader('Jarom Gillins'), '"Jarom Gillins from Utah Civic Compact" <hello@utahciviccompact.org>');
  assert.equal(fromHeader(''), '"Utah Civic Compact" <hello@utahciviccompact.org>');
  assert.equal(fromHeader('Utah Civic Compact'), '"Utah Civic Compact" <hello@utahciviccompact.org>');
  assert.equal(fromHeader('Evil" <x@y.z>, "Name'), '"Evil xy.z Name from Utah Civic Compact" <hello@utahciviccompact.org>');
});

test('safeUrl', () => {
  assert.equal(safeUrl('https://a.b/c?d=1'), 'https://a.b/c?d=1');
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeUrl('mailto:a@b.c', { mailto: false }), '');
  assert.equal(safeUrl('javascript:x'), '');
  assert.equal(safeUrl('https://a.b/c d'), '');
});

test('tagLinks adds UTM to site links only, once, keeping hashes', async () => {
  const { tagLinks } = await import('../render.mjs');
  const html = '<a href="https://utahciviccompact.org/petition#top">p</a> <a href="https://utahciviccompact.org/x?y=1">x</a> <a href="https://utahciviccompact.org/api/unsubscribe?token=t">u</a> <a href="{{unsubscribe_url}}">u2</a> <a href="https://other.org/">o</a> <a href="https://utahciviccompact.org/z?utm_source=a">z</a> <a href="https://utahciviccompact.org">home</a>';
  const out = tagLinks(html, 'https://utahciviccompact.org', 'oct-6');
  assert.ok(out.includes('href="https://utahciviccompact.org/petition?utm_source=newsletter&utm_medium=email&utm_campaign=oct-6#top"'));
  assert.ok(out.includes('href="https://utahciviccompact.org/x?y=1&amp;utm_source=newsletter'));
  assert.ok(out.includes('href="https://utahciviccompact.org/api/unsubscribe?token=t"'));
  assert.ok(out.includes('href="{{unsubscribe_url}}"'));
  assert.ok(out.includes('href="https://other.org/"'));
  assert.ok(out.includes('href="https://utahciviccompact.org/z?utm_source=a"'));
  assert.ok(out.includes('href="https://utahciviccompact.org?utm_source=newsletter'));
  assert.equal(tagLinks(html, '', 'c'), html);
});

test('viewUrl adds a View in browser line to html and text; campaign tags the body links', () => {
  const { html, text } = renderEmail(doc, { viewUrl: 'https://utahciviccompact.org/newsletters/2026-10-06-x', siteUrl: 'https://utahciviccompact.org', campaign: '2026-10-06-x' });
  assert.ok(html.includes('>View in browser</a>'));
  assert.ok(text.startsWith('View in browser: https://utahciviccompact.org/newsletters/2026-10-06-x'));
  assert.ok(html.includes('https://utahciviccompact.org/mida?utm_source=newsletter&utm_medium=email&utm_campaign=2026-10-06-x'));
  assert.ok(!renderEmail(doc).html.includes('View in browser'));
});

test('pixelUrl adds the open pixel only when asked', () => {
  const withPixel = renderEmail(doc, { pixelUrl: 'https://utahciviccompact.org/api/open?c=abc' }).html;
  assert.ok(withPixel.includes('<img src="https://utahciviccompact.org/api/open?c=abc" width="1" height="1" alt=""'));
  assert.ok(!renderEmail(doc).html.includes('/api/open'));
  assert.ok(!previewHtml(doc, 'light').includes('/api/open'));
});

// Raw HTML mode ("Ignore all style — raw HTML"): the author's HTML goes out
// as typed; the only addition is the unsubscribe link.
test('raw block: HTML sent as typed, unsubscribe appended before </body>, no theme', () => {
  const raw = '<html><body><h1 style="color:red">Hi</h1><p>Body &amp; more<br>line two</p></body></html>';
  const { html, text } = renderEmail({ ...doc, blocks: [{ type: 'raw', html: raw }, ...doc.blocks] }, { viewUrl: 'https://x/v', pixelUrl: 'https://x/p', siteUrl: 'https://utahciviccompact.org', campaign: 'c' });
  assert.ok(html.startsWith('<html><body><h1 style="color:red">Hi</h1><p>Body &amp; more<br>line two</p>'));
  assert.match(html, new RegExp(`<a href="${UNSUBSCRIBE_TOKEN.replace(/[{}]/g, '\\$&')}"[^>]*>Unsubscribe</a></p>\\s*</body></html>$`));
  assert.ok(!html.includes('What happened'));       // builder blocks ignored
  assert.ok(!html.includes('View in browser') && !html.includes('https://x/p')); // nothing else added
  assert.ok(!html.includes(DEFAULT_THEME.accent));
  assert.match(text, /Hi\s+Body & more\nline two/);
  assert.ok(text.trimEnd().endsWith(`Unsubscribe: ${UNSUBSCRIBE_TOKEN}`));
});

test('raw block: an author-placed unsubscribe token is not duplicated; fragment without </body> gets it at the end', () => {
  const placed = renderEmail({ blocks: [{ type: 'raw', html: `<p><a href="${UNSUBSCRIBE_TOKEN}">stop</a></p>` }] }).html;
  assert.equal(placed.split(UNSUBSCRIBE_TOKEN).length - 1, 1);
  const frag = renderEmail({ blocks: [{ type: 'raw', html: '<p>x</p>' }] }).html;
  assert.ok(frag.startsWith('<p>x</p>') && frag.includes(UNSUBSCRIBE_TOKEN));
  assert.ok(previewHtml({ blocks: [{ type: 'raw', html: '<p>x</p>' }] }, 'light').includes('href="#"'));
});

test('normalizeBlocks keeps a raw block (trimmed, clipped) and drops an empty one', () => {
  assert.deepEqual(normalizeBlocks([{ type: 'raw', html: '  <p>a</p> ' }]), [{ type: 'raw', html: '<p>a</p>' }]);
  assert.deepEqual(normalizeBlocks([{ type: 'raw', html: '   ' }]), []);
});
