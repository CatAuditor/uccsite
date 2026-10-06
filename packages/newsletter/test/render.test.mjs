import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderEmail, previewHtml, normalizeBlocks, normalizeTheme, fromHeader, safeUrl, UNSUBSCRIBE_TOKEN, DEFAULT_THEME, MAX_BLOCKS,
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
  assert.match(html, /<a href="https:\/\/utahciviccompact.org" style="[^"]*">Read more<\/a>/);
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
  assert.ok(dark.includes('.em-bg{background:#111412!important;}'));
  assert.ok(!light.includes('.em-bg{background:#111412'));
  assert.ok(auto.includes('<meta name="color-scheme" content="light dark">'));
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
