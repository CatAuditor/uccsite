import { test } from 'node:test';
import assert from 'node:assert/strict';
import { show, diffFields, diffList, diffNavigation, diffDocument } from '../lib/change-detail-core.mjs';

test('show: blanks, html, long text, arrays', () => {
  assert.equal(show(''), '(blank)');
  assert.equal(show(null), '(blank)');
  assert.equal(show('Tell <em>UDOT</em>'), 'Tell UDOT');
  assert.equal(show('x'.repeat(200)).length, 90);
  assert.equal(show([1, 2]), '2 items');
});

test('diffFields: only real changes, with labels', () => {
  assert.deepEqual(diffFields({ title: 'CTO', name: 'Kaden' }, { title: 'CTO, Board', name: 'Kaden' }, { title: 'Title' }),
    [{ label: 'Title', before: 'CTO', after: 'CTO, Board' }]);
  assert.deepEqual(diffFields({ a: '' }, { a: undefined }), [], 'blank and missing are the same');
});

test('diffList: edit is matched by key, not add+remove; adds, removes, reorders', () => {
  const before = [{ name: 'Conner', title: 'President' }, { name: 'Kaden', title: 'CTO' }];
  const edited = diffList(before, [{ name: 'Conner', title: 'President' }, { name: 'Kaden', title: 'CTO, Board' }], { title: 'Title' });
  assert.deepEqual(edited, [{ kind: 'changed', text: 'Edited: Kaden', fields: [{ label: 'Title', before: 'CTO', after: 'CTO, Board' }] }]);

  const lines = diffList(before, [{ name: 'Clark', title: 'Comms' }, { name: 'Kaden', title: 'CTO' }]);
  assert.deepEqual(lines.map((l) => l.text), ['Added: Clark', 'Removed: Conner']);

  const moved = diffList(before, [before[1], before[0]]);
  assert.deepEqual(moved.map((l) => l.kind), ['moved']);
  assert.match(moved[0].text, /now: Kaden · Conner/);
});

test('diffList: news items match by url, videos by YouTube id', () => {
  const a = [{ url: 'https://kutv.com/a', headline: 'Old' }];
  assert.equal(diffList(a, [{ url: 'https://kutv.com/a', headline: 'New' }], { headline: 'Headline' })[0].text, 'Edited: New');
  assert.equal(diffList([], [{ youtube_id: 'Q14', headline: 'Flock' }])[0].text, 'Added: Flock');
});

test('diffNavigation: added footer link, changed target, defaults when unset', () => {
  const defaults = { header: [{ label: 'Mission', href: '/#mission' }], footer: { columns: [], bottom: [{ label: 'Privacy Policy', href: '/privacy.html' }] } };
  const after = { header: [{ label: 'Mission', href: '/#mission2' }], footer: { columns: [], bottom: [{ label: 'Privacy Policy', href: '/privacy.html' }, { label: 'Terms', href: '/terms.html' }] } };
  const lines = diffNavigation(null, after, defaults);
  assert.deepEqual(lines.map((l) => l.text), ['Added: Footer bottom › Terms → /terms.html', 'Edited: Header › Mission']);
  assert.deepEqual(lines[1].fields, [{ label: 'Links to', before: '/#mission', after: '/#mission2' }]);
});

test('diffDocument: new, details, text length', () => {
  assert.equal(diffDocument(null, { title: 'Plates', status: 'draft' })[0].text, 'New document: Plates (draft)');
  const lines = diffDocument({ title: 'A', status: 'draft', bodyHtmlRaw: '<p>one two</p>' }, { title: 'A', status: 'published', bodyHtmlRaw: '<p>one two three</p>' });
  assert.deepEqual(lines.map((l) => l.text), ['Details', 'Text edited (+1 words, now 3)']);
  assert.deepEqual(lines[0].fields, [{ label: 'Status', before: 'draft', after: 'published' }]);
});
