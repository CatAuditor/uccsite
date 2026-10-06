import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDbTime, when } from '../lib/when.mjs';

test('parses every DSQL text form the admin sees', () => {
  for (const t of ['2026-10-06 03:14:16.177+00', '2026-10-06 03:14:16+00', '2026-10-06 03:14:16.177123+00', '2026-10-06T03:14:16.177Z', '2026-10-06 03:14:16.177+00:00']) {
    assert.equal(parseDbTime(t)?.toISOString().slice(0, 19), '2026-10-06T03:14:16', t);
  }
  assert.equal(parseDbTime(null), null);
  assert.equal(parseDbTime('yesterday'), null);
});

test('formats in Mountain time with a label', () => {
  assert.equal(when('2026-10-06 03:14:16.177+00'), 'Oct 5, 9:14 PM MT');   // MDT
  assert.equal(when('2026-12-06 03:14:16+00'), 'Dec 5, 8:14 PM MT');       // MST
  assert.equal(when('2026-10-06 03:14:16+00', { seconds: true }), 'Oct 5, 9:14:16 PM MT');
  assert.equal(when(''), '');
});
