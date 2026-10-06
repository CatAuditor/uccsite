import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { deriveWriting } = createRequire(import.meta.url)('../writing.js');

const content = {
  statements: { statements: [
    { slug: 'page', title: 'The Page', date: 'July 24, 2026', author: 'Clark Dice', snippet: 'A signature…' },
    { slug: 'how', title: 'How?', date: 'September 9, 2026', author: 'Jarom Gillins', snippet: 'Utah has…', url: '/how-did-this-happen.html' },
  ] },
  documents_index: [
    { slug: 'how-did-this-happen', title: 'If Weber County Followed the Law', category: 'Reports', author: 'Jarom Gillins', date: '', summary: '' },
    { slug: 'alpr', title: 'Ten Cameras', category: 'Reports', author: 'Conner Radcliffe', date: '2026-08-12', summary: 'Weber County…' },
    { slug: 'theory', title: 'Theory of Change', category: 'Whitepapers', author: '', date: '', summary: 'How we work' },
    { slug: 'privacy', title: 'Privacy Policy', category: 'Legal', author: '', date: '', summary: '' },
  ],
};

test('newest first; undated last; Legal left out', () => {
  const w = deriveWriting(content);
  assert.deepEqual(w.items.map((i) => i.title), ['If Weber County Followed the Law', 'Ten Cameras', 'The Page', 'Theory of Change']);
  assert.equal(w.count, 4);
});

test('a statement pointing at a document merges into it: one entry, document title, statement date and snippet', () => {
  const how = deriveWriting(content).items[0];
  assert.deepEqual([how.url, how.date, how.summary, how.type], ['/how-did-this-happen', 'September 9, 2026', 'Utah has…', 'Report']);
});

test('types from category, plain statements link to their anchor, author links resolved', () => {
  const w = deriveWriting(content, (n) => (n === 'Conner Radcliffe' ? '/team/conner-radcliffe' : ''));
  const byTitle = Object.fromEntries(w.items.map((i) => [i.title, i]));
  assert.equal(byTitle['Theory of Change'].type, 'Paper');
  assert.equal(byTitle['The Page'].url, '/statements#page');
  assert.equal(byTitle['Ten Cameras'].author_url, '/team/conner-radcliffe');
  assert.equal(byTitle['Ten Cameras'].date, 'August 12, 2026');
  assert.deepEqual(w.types, [{ label: 'Report', key: 'report', n: 2 }, { label: 'Statement', key: 'statement', n: 1 }, { label: 'Paper', key: 'paper', n: 1 }]);
});

test('nothing published → empty list, no crash', () => {
  assert.deepEqual(deriveWriting({}), { items: [], count: 0, types: [] });
});
