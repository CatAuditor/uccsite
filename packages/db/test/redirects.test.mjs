// kvsEntries: redirect rows + archived document slugs → KeyValueStore entries
// (docs/systems/documents.md "Archiving", publish-pipeline.md "Redirects → KeyValueStore").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { kvsEntries } = require('../redirects.js');

const rows = [
  { fromPath: '/old', toUrl: '/new', statusCode: 301, active: true },
  { fromPath: '/off', toUrl: '/elsewhere', statusCode: 302, active: false },
];

test('active redirects only, in the viewer function format', () => {
  assert.deepEqual(kvsEntries(rows), [{ key: '/old', value: '{"to":"/new","status":301}' }]);
});

test('archived slugs become 410 entries; an active redirect from the same path wins', () => {
  const entries = kvsEntries(rows, { goneSlugs: ['alpr', 'old', 'off'] });
  assert.deepEqual(entries, [
    { key: '/old', value: '{"to":"/new","status":301}' },
    { key: '/alpr', value: '{"status":410}' },
    { key: '/off', value: '{"status":410}' }, // the inactive redirect does not protect the path
  ]);
});

test('no archived slugs: unchanged shape', () => {
  assert.deepEqual(kvsEntries(rows, { goneSlugs: [] }), kvsEntries(rows));
});
