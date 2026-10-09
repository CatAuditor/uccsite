// kvsEntries: redirect rows + document redirects + archived paths → KeyValueStore entries
// (docs/systems/documents.md "Archiving", publish-pipeline.md "Redirects → KeyValueStore",
// docs/decisions/project-tree-nested-urls.md).
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

test('archived paths become 410 entries; an active redirect from the same path wins', () => {
  const entries = kvsEntries(rows, { gonePaths: ['/alpr', '/old', '/off'] });
  assert.deepEqual(entries, [
    { key: '/old', value: '{"to":"/new","status":301}' },
    { key: '/alpr', value: '{"status":410}' },
    { key: '/off', value: '{"status":410}' }, // the inactive redirect does not protect the path
  ]);
});

test('document redirects are 301s; table rows win over them, they win over 410s; self and dupes dropped', () => {
  const entries = kvsEntries(rows, {
    documentRedirects: [
      { from: '/alpr', to: '/projects/alpr/report' },
      { from: '/old', to: '/projects/alpr/old' },            // the table row keeps /old
      { from: '/weber-county', to: '/weber-county' },        // no-op
      { from: '/alpr', to: '/projects/alpr/other' },         // first wins
    ],
    gonePaths: ['/alpr', '/gone'],
  });
  assert.deepEqual(entries, [
    { key: '/old', value: '{"to":"/new","status":301}' },
    { key: '/alpr', value: '{"to":"/projects/alpr/report","status":301}' },
    { key: '/gone', value: '{"status":410}' },
  ]);
});

test('no extras: unchanged shape', () => {
  assert.deepEqual(kvsEntries(rows, { gonePaths: [] }), kvsEntries(rows));
});
