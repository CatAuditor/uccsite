import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lists = require('../lists.js');
const { CONTENT_ACTION_RE } = require('../publish-requests.js');

const ID = '2b9d3f6a-0000-4000-8000-000000000001';

function fakeClient(results = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return results.shift() || { rows: [], rowCount: 0 }; },
  };
}

test('list actions are not site content', () => {
  for (const a of ['list.create', 'list.save', 'list.freeze', 'list.mode', 'list.delete']) assert.equal(CONTENT_ACTION_RE.test(a), false, a);
});

test('rowToList normalizes the stored filters and never lets a list point at a list', () => {
  const l = lists.rowToList({ id: ID, name: 'Dormant', filters: JSON.stringify({ history: 'never', list: ID, residency: 'bogus' }), mode: 'frozen', frozen_at: '2026-10-09 01:02:03+00', frozen_count: 412 });
  assert.deepEqual(l.filters, { residency: 'all', donors: false, petition: '', not_petition: '', history: 'never', list: '', not_list: '', giving: '', via: '', joined_after: '', joined_before: '', zip: '', last_sent_before: '' });
  assert.equal(l.mode, 'frozen');
  assert.equal(lists.rowToList({ id: ID, filters: 'junk', mode: 'weird' }).mode, 'dynamic');
  assert.equal(lists.describeList(l), 'Dormant (frozen 2026-10-09, 412 people)');
  assert.equal(lists.describeList({ ...l, mode: 'dynamic' }), 'Dormant (dynamic: never received a newsletter)');
});

test('a dynamic list re-runs its filters; a frozen list reads its snapshot with the eligibility rules kept', () => {
  const dyn = lists.listQuery({ id: ID, mode: 'dynamic', filters: { history: 'never', residency: 'utah' } }, { columns: 'a.email' });
  assert.deepEqual(dyn.params, ['utah', ID], 'dynamic: filters OR the people added by hand');
  assert.match(dyn.sql, /NOT EXISTS \(SELECT 1 FROM newsletter_deliveries/);
  assert.match(dyn.sql, /OR EXISTS \(SELECT 1 FROM mailing_list_members lm WHERE lm\.list_id = \$2::uuid AND lm\.source = 'manual'/);
  const frz = lists.listQuery({ id: ID, mode: 'frozen', filters: { history: 'never', residency: 'utah' } }, { columns: 'a.email' });
  assert.deepEqual(frz.params, [ID]);
  assert.match(frz.sql, /mailing_list_members lm WHERE lm\.list_id = \$1::uuid/);
  assert.ok(!/a\.residency/.test(frz.sql), 'frozen: the filters are not re-applied');
  assert.match(frz.sql, /s\.unsubscribed_at IS NULL/, 'frozen: the audience rules still apply');
});

test('freezeList replaces the snapshot rows only (people added by hand stay) and stamps the total', async () => {
  const c = fakeClient([{ rowCount: 0 }, { rowCount: 7 }, { rows: [{ n: 9 }] }, { rowCount: 1 }]);
  const n = await lists.freezeList(c, ID, { donors: true });
  assert.equal(n, 9);
  assert.match(c.calls[0].sql, /^DELETE FROM mailing_list_members WHERE list_id = \$1 AND COALESCE\(source, 'snapshot'\) = 'snapshot'/);
  assert.match(c.calls[1].sql, /^INSERT INTO mailing_list_members \(list_id, email, source\) SELECT \$1::uuid, q\.email, 'snapshot' FROM \(SELECT a\.email FROM/);
  assert.match(c.calls[1].sql, /a\.donor/);
  assert.deepEqual(c.calls[1].params, [ID]);
  assert.match(c.calls[3].sql, /frozen_at = now\(\), frozen_count = \$2/);
  assert.deepEqual(c.calls[3].params, [ID, 9]);
});

test('addMembers upserts by hand (lower-cased, de-duplicated, junk skipped); removeMember deletes one', async () => {
  const c = fakeClient([{ rowCount: 1 }, { rowCount: 1 }]);
  assert.equal(await lists.addMembers(c, ID, [' A@X.Y ', 'a@x.y', 'nope', 'b@x.y']), 2);
  assert.equal(c.calls.length, 2);
  assert.deepEqual(c.calls[0].params, [ID, 'a@x.y']);
  assert.match(c.calls[0].sql, /VALUES \(\$1, \$2, 'manual'\) ON CONFLICT \(list_id, email\) DO UPDATE SET source = 'manual'/);
  const d = fakeClient([{ rowCount: 1 }]);
  assert.equal(await lists.removeMember(d, ID, 'B@x.y'), true);
  assert.deepEqual(d.calls[0].params, [ID, 'b@x.y']);
});

test('audienceFor: ad-hoc filters, a saved list, or null when the list is gone', async () => {
  const adhoc = await lists.audienceFor(fakeClient(), { residency: 'utah' }, { columns: 'a.email' });
  assert.equal(adhoc.description, 'Utah residents');
  assert.equal(adhoc.list, null);
  assert.deepEqual(adhoc.params, ['utah']);
  const row = { id: ID, name: 'Dormant', filters: '{"history":"never"}', mode: 'dynamic' };
  const found = await lists.audienceFor(fakeClient([{ rows: [row], rowCount: 1 }]), { list: ID, residency: 'utah' }, { columns: 'a.email' });
  assert.equal(found.description, 'saved list Dormant (dynamic: never received a newsletter)');
  assert.deepEqual(found.params, [ID], "the newsletter's own filters are ignored when a list is chosen (only the list's manual-members id is bound)");
  assert.ok(!/a\.residency/.test(found.sql));
  assert.match(found.sql, /NOT EXISTS \(SELECT 1 FROM newsletter_deliveries/);
  assert.equal(await lists.audienceFor(fakeClient(), { list: ID }), null);
});

test('newslettersUsing matches the stored audience JSON by list id', async () => {
  const c = fakeClient([{ rows: [{ id: 'n1', subject: 'Hi', status: 'pending' }], rowCount: 1 }]);
  const rows = await lists.newslettersUsing(c, ID);
  assert.deepEqual(rows, [{ id: 'n1', subject: 'Hi', status: 'pending' }]);
  assert.deepEqual(c.calls[0].params, [`%"list":"${ID}"%`]);
});
