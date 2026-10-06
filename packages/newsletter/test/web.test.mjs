import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWebBody, archiveSlug } from '../web.mjs';

test('renderWebBody emits semantic HTML with classes and no inline styles', () => {
  const html = renderWebBody({ headline: 'Busy <week>', blocks: [
    { type: 'heading', text: 'What' },
    { type: 'text', markdown: 'We **did** [it](https://utahciviccompact.org/x).\n\n- a\n- b\n\n## sub' },
    { type: 'button', label: 'Go', url: 'https://utahciviccompact.org', align: 'left' },
    { type: 'image', url: 'https://utahciviccompact.org/media/a/b-1200.webp', alt: 'Capitol', caption: 'Cap', link: 'https://x.y' },
    { type: 'quote', text: 'Q', cite: 'C' },
    { type: 'divider' },
    { type: 'text', markdown: '<script>x</script> [bad](javascript:1)' },
  ] });
  assert.ok(html.includes('<h1 class="nl-headline">Busy &lt;week&gt;</h1>'));
  assert.ok(html.includes('<h2>What</h2>'));
  assert.ok(html.includes('<strong>did</strong> <a href="https://utahciviccompact.org/x">it</a>'));
  assert.ok(html.includes('<ul><li>a</li><li>b</li></ul>'));
  assert.ok(html.includes('<h3>sub</h3>'));
  assert.ok(html.includes('<p class="nl-button nl-left"><a class="btn" href="https://utahciviccompact.org">Go</a></p>'));
  assert.ok(html.includes('<figure class="nl-figure"><a href="https://x.y"><img src="https://utahciviccompact.org/media/a/b-1200.webp" alt="Capitol" loading="lazy"></a><figcaption>Cap</figcaption></figure>'));
  assert.ok(html.includes('<blockquote class="nl-quote">Q<cite>C</cite></blockquote>'));
  assert.ok(html.includes('<hr>'));
  assert.ok(!html.includes('style='));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
});

test('archiveSlug is date-prefixed, lowercase, bounded', () => {
  assert.equal(archiveSlug('Latest from the Compact!', new Date('2026-10-06T15:00:00Z')), '2026-10-06-latest-from-the-compact');
  assert.equal(archiveSlug('', new Date('2026-10-06T15:00:00Z')), '2026-10-06');
  assert.ok(archiveSlug('x'.repeat(200), new Date('2026-10-06T15:00:00Z')).length <= 71);
});
