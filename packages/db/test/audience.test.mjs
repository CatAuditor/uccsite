import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isUtahZip, utahZipSql, normalizeFilters, audienceQuery, describeFilters, normalizeDirectoryFilters, directoryQuery, AUDIENCE_ROWS_SQL, DIRECTORY_ROWS_SQL, STATUSES } = require('../audience.js');

test('every 84xxx ZIP is Utah, nothing else is', () => {
  for (const z of ['84101', '84770', '84001-1234', ' 84321 ']) assert.equal(isUtahZip(z), true, z);
  for (const z of ['83001', '85001', '8410', '841011', 'abcde', '', null, undefined, '94101']) assert.equal(isUtahZip(z), false, String(z));
  assert.equal(utahZipSql('s.zip'), "s.zip LIKE '84%'");
});

test('filters normalize to a closed set (nothing user-supplied reaches SQL text)', () => {
  assert.deepEqual(normalizeFilters({}), { residency: 'all', donors: false, petition: '', history: 'all', list: '' });
  assert.deepEqual(normalizeFilters({ residency: 'utah', donors: '1', petition: 'udot-alpr-permits', history: 'never', list: '2B9D3F6A-0000-4000-8000-000000000001' }),
    { residency: 'utah', donors: true, petition: 'udot-alpr-permits', history: 'never', list: '2b9d3f6a-0000-4000-8000-000000000001' });
  assert.deepEqual(normalizeFilters({ residency: "x' OR 1=1", donors: 'maybe', petition: 'Bad Slug', history: 'yes', list: 'not-a-uuid' }),
    { residency: 'all', donors: false, petition: '', history: 'all', list: '' });
});

test('history filter reads the send ledger; memberOf narrows to a frozen snapshot', () => {
  const never = audienceQuery({ history: 'never' }, { columns: 'a.email' });
  assert.match(never.sql, /NOT EXISTS \(SELECT 1 FROM newsletter_deliveries nd WHERE nd\.email = a\.email AND nd\.status = 'sent'\)/);
  const reached = audienceQuery({ history: 'reached' });
  assert.match(reached.sql, /WHERE EXISTS \(SELECT 1 FROM newsletter_deliveries/);
  const id = '2b9d3f6a-0000-4000-8000-000000000001';
  const frozen = audienceQuery({}, { memberOf: id, columns: 'a.email' });
  assert.deepEqual(frozen.params, [id]);
  assert.match(frozen.sql, /mailing_list_members lm WHERE lm\.list_id = \$1::uuid AND lm\.email = a\.email/);
  assert.throws(() => audienceQuery({}, { memberOf: 'x' }), /list id/);
  // `list` is carried, never applied here (the resolver in lists.js applies it).
  assert.deepEqual(audienceQuery({ list: id }).params, []);
  assert.equal(describeFilters({ history: 'never' }), 'never received a newsletter');
  assert.equal(describeFilters({ residency: 'utah', history: 'reached' }), 'Utah residents · received a newsletter before');
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

test('the audience is the confirmed, still-subscribed, non-suppressed rows; the directory is everyone with a status', () => {
  assert.match(AUDIENCE_ROWS_SQL, /s\.confirmed_at IS NOT NULL/);
  assert.match(AUDIENCE_ROWS_SQL, /s\.unsubscribed_at IS NULL/);
  assert.ok(!/AS status/.test(AUDIENCE_ROWS_SQL), 'audience rows carry no status column');
  assert.ok(!/WHERE s\.confirmed_at/.test(DIRECTORY_ROWS_SQL), 'directory keeps unconfirmed rows');
  assert.match(DIRECTORY_ROWS_SQL, /AS status/);
  for (const s of STATUSES) assert.match(DIRECTORY_ROWS_SQL, new RegExp(`'${s}'`));
  // A member with any subscribers row is represented by that row only, in both sets.
  assert.match(AUDIENCE_ROWS_SQL, /NOT IN \(SELECT s2\.email FROM subscribers s2\)/);
  assert.match(DIRECTORY_ROWS_SQL, /NOT IN \(SELECT s2\.email FROM subscribers s2\)/);
});

test('directory filters: status defaults to subscribed, search is bound and escaped', () => {
  assert.deepEqual(normalizeDirectoryFilters({}), { residency: 'all', donors: false, petition: '', history: 'all', list: '', status: 'subscribed', q: '' });
  assert.equal(normalizeDirectoryFilters({ status: 'all' }).status, 'all');
  assert.equal(normalizeDirectoryFilters({ status: 'bogus' }).status, 'subscribed');
  const q = directoryQuery({ status: 'unsubscribed', residency: 'utah', q: '50%_off' }, { limit: 5, deliveries: true });
  assert.deepEqual(q.params, ['utah', 'unsubscribed', '%50\\%\\_off%']);
  assert.match(q.sql, /a\.status = \$2/);
  assert.match(q.sql, /a\.email ILIKE \$3/);
  assert.match(q.sql, /dl\.sent_count/);
  assert.match(q.sql, /LIMIT 5$/);
  const all = directoryQuery({ status: 'all' }, { columns: 'a.status, count(*)::int AS n', orderBy: null });
  assert.deepEqual(all.params, []);
  assert.ok(!/ WHERE /.test(all.sql.split(') a')[1] || ''), 'no outer WHERE for status=all');
  assert.ok(!/dl\./.test(all.sql), 'delivery stats only when asked');
});
