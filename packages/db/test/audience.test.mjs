import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isUtahZip, utahZipSql, normalizeFilters, audienceQuery, describeFilters } = require('../audience.js');

test('every 84xxx ZIP is Utah, nothing else is', () => {
  for (const z of ['84101', '84770', '84001-1234', ' 84321 ']) assert.equal(isUtahZip(z), true, z);
  for (const z of ['83001', '85001', '8410', '841011', 'abcde', '', null, undefined, '94101']) assert.equal(isUtahZip(z), false, String(z));
  assert.equal(utahZipSql('s.zip'), "s.zip LIKE '84%'");
});

test('filters normalize to a closed set (nothing user-supplied reaches SQL text)', () => {
  assert.deepEqual(normalizeFilters({}), { residency: 'all', donors: false, petition: '' });
  assert.deepEqual(normalizeFilters({ residency: 'utah', donors: '1', petition: 'udot-alpr-permits' }),
    { residency: 'utah', donors: true, petition: 'udot-alpr-permits' });
  assert.deepEqual(normalizeFilters({ residency: "x' OR 1=1", donors: 'maybe', petition: 'Bad Slug' }),
    { residency: 'all', donors: false, petition: '' });
});

test('audienceQuery binds every filter as a parameter', () => {
  const none = audienceQuery({});
  assert.deepEqual(none.params, []);
  assert.ok(!/\) a WHERE /.test(none.sql), 'no outer WHERE when unfiltered');
  const all = audienceQuery({ residency: 'outside', donors: true, petition: 'udot-alpr-permits' }, { columns: 'a.email', limit: 10 });
  assert.deepEqual(all.params, ['outside', 'udot-alpr-permits']);
  assert.match(all.sql, /a\.residency = \$1/);
  assert.match(all.sql, /a\.donor/);
  assert.match(all.sql, /px\.petition = \$2/);
  assert.match(all.sql, /LIMIT 10$/);
  assert.match(all.sql, /^SELECT a\.email FROM/);
});

test('describeFilters reads back as the dashboard shows it', () => {
  assert.equal(describeFilters({}), 'everyone');
  assert.equal(describeFilters({ residency: 'utah', donors: true, petition: 'udot-alpr-permits' }), 'Utah residents · donors only · signed udot-alpr-permits');
});
