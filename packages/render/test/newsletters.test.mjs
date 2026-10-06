import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildNewsletterArchive } = require('../newsletters.js');

const shell = '<html><head>{{{seo_block}}}{{{page_css_link}}}</head><body>{{> header}}{{{body}}}{{> footer}}</body></html>';
const partials = { header: '<nav class="{{#current.newsletters}}on{{/current.newsletters}}">h</nav>', footer: '<footer>f</footer>' };
const settings = { orgName: 'Utah Civic Compact' };
const rows = [
  { slug: '2026-10-06-busy', subject: 'Busy <week>', preheader: 'Three things', webHtml: '<h1 class="nl-headline">Busy</h1><p>x</p>', sentAt: '2026-10-06T15:00:00Z' },
  { slug: '2026-09-01-first', subject: 'First', preheader: '', webHtml: '<p>y</p>', sentAt: '2026-09-01T15:00:00Z' },
];

test('index + one page per archived newsletter, inside the shell, in the sitemap', () => {
  const out = buildNewsletterArchive({ newsletters: rows, shell, partials, settings, siteUrl: 'https://utahciviccompact.org' });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(Object.keys(out.files).sort(), ['newsletters.html', 'newsletters/2026-09-01-first.html', 'newsletters/2026-10-06-busy.html']);
  const page = out.files['newsletters/2026-10-06-busy.html'];
  assert.ok(page.includes('<title>Busy &lt;week&gt; | Utah Civic Compact</title>'));
  assert.ok(page.includes('<link rel="canonical" href="https://utahciviccompact.org/newsletters/2026-10-06-busy" />'));
  assert.ok(page.includes('href="/css/newsletters.css"'));
  assert.ok(page.includes('<nav class="on">h</nav>'));
  assert.ok(page.includes('<h1 class="nl-headline">Busy</h1><p>x</p>'));
  assert.ok(page.includes('Sent October 6, 2026'));
  assert.ok(page.includes('<footer>f</footer>'));
  const index = out.files['newsletters.html'];
  assert.ok(index.includes('<a href="/newsletters/2026-10-06-busy">Busy &lt;week&gt;</a>'));
  assert.ok(index.includes('<p>Three things</p>'));
  assert.ok(!index.includes('style='));
  assert.deepEqual(out.pages.map((p) => p.template), ['newsletters/2026-10-06-busy.html', 'newsletters/2026-09-01-first.html', 'newsletters.html']);
});

test('nothing archived = an empty index only; bad slugs and missing copies are errors', () => {
  const empty = buildNewsletterArchive({ newsletters: [], shell, partials, settings, siteUrl: 'x' });
  assert.deepEqual(Object.keys(empty.files), ['newsletters.html']);
  assert.ok(empty.files['newsletters.html'].includes('Nothing in the archive yet'));
  assert.deepEqual(empty.errors, []);
  const out = buildNewsletterArchive({ newsletters: [{ slug: 'Bad Slug', subject: 's', webHtml: '<p>', sentAt: '' }, { slug: 'ok', subject: 's', webHtml: '', sentAt: '' }], shell, partials, settings, siteUrl: 'x' });
  assert.equal(out.errors.length, 2);
  assert.deepEqual(Object.keys(out.files), ['newsletters.html']);
});

test('every sitemap entry has a content list and a valid ISO lastmodAt (the publish pipeline needs both)', () => {
  const out = buildNewsletterArchive({ newsletters: [{ slug: 'ok', subject: 's', webHtml: '<p>', sentAt: 'not a date' }], shell, partials, settings, siteUrl: 'x' });
  for (const p of out.pages) {
    assert.deepEqual(p.content, []);
    assert.equal(new Date(p.lastmodAt).toISOString(), p.lastmodAt);
  }
  const empty = buildNewsletterArchive({ newsletters: [], shell, partials, settings, siteUrl: 'x' });
  assert.equal(new Date(empty.pages[0].lastmodAt).toISOString(), empty.pages[0].lastmodAt);
});
