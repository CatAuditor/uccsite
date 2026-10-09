// Admin Financial → Donations: filter normalisation + the SQL builders
// (docs/systems/finance.md). The SQL is asserted by shape, not run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  toCents, normalizeDonationFilters, donationsQuery, donationsSummaryQuery, monthlyPlansQuery, describeDonationFilters,
} = require('../donations.js');

test('toCents: dollars → cents, blanks and junk → null', () => {
  assert.equal(toCents('25'), 2500);
  assert.equal(toCents('$1,000.50'), 100050);
  assert.equal(toCents(''), null);
  assert.equal(toCents('abc'), null);
  assert.equal(toCents('-5'), null);
  assert.equal(toCents(undefined), null);
});

test('normalize: unknown values fall back, q is trimmed and capped', () => {
  assert.deepEqual(normalizeDonationFilters({}), {
    timeframe: 'all', min: null, max: null, residency: 'all', kind: 'all', monthly: 'any', ticker: 'any', q: '',
  });
  const f = normalizeDonationFilters({ timeframe: 'bogus', residency: 'mars', kind: 'x', monthly: 'y', ticker: 'z', q: '  a@b.c  ' });
  assert.equal(f.timeframe, 'all');
  assert.equal(f.residency, 'all');
  assert.equal(f.q, 'a@b.c');
  assert.equal(normalizeDonationFilters({ q: 'x'.repeat(200) }).q.length, 80);
});

test('donationsQuery: no filters = every row, newest first, limit as the only param', () => {
  const { sql, params } = donationsQuery({}, { limit: 50 });
  assert.deepEqual(params, [50]);
  assert.match(sql, /FROM donations d LEFT JOIN members m/);
  assert.doesNotMatch(sql, /\n  WHERE/); // subqueries have their own WHEREs; no top-level one
  assert.match(sql, /ORDER BY d\.created_at DESC LIMIT \$1/);
  assert.match(sql, /AS monthly/);
  assert.match(sql, /AS sub_status/);
  assert.match(sql, /AS residency/);
});

test('donationsQuery: every filter lands in WHERE with numbered params in order', () => {
  const { sql, params } = donationsQuery({
    timeframe: '30d', min: '25', max: '100', residency: 'utah', kind: 'monthly', monthly: 'active', ticker: 'no', q: 'al_ex',
  });
  assert.deepEqual(params, [2500, 10000, 'utah', 'active', '%al\\_ex%', 200]);
  assert.match(sql, /d\.created_at >= now\(\) - interval '30 days'/);
  assert.match(sql, /d\.amount_cents >= \$1/);
  assert.match(sql, /d\.amount_cents <= \$2/);
  assert.match(sql, /END = \$3/);                 // residency CASE
  assert.match(sql, /LIMIT 1\) = \$4/);           // newest plan status
  assert.match(sql, /d\.public = 0/);
  assert.match(sql, /m\.email ILIKE \$5/);
  assert.match(sql, /LIMIT \$6$/);
  assert.match(sql, /\(d\.stripe_subscription_id IS NOT NULL OR EXISTS/);
});

test('donationsQuery: one-time = NOT monthly; ticker yes = public 1', () => {
  const { sql } = donationsQuery({ kind: 'one-time', ticker: 'yes' });
  assert.match(sql, /NOT \(d\.stripe_subscription_id IS NOT NULL OR EXISTS/);
  assert.match(sql, /d\.public = 1/);
});

test('summary shares the WHERE and has no limit', () => {
  const list = donationsQuery({ timeframe: 'ytd', min: '10' });
  const sum = donationsSummaryQuery({ timeframe: 'ytd', min: '10' });
  assert.deepEqual(sum.params, [1000]);
  assert.deepEqual(list.params, [1000, 200]);
  assert.match(sum.sql, /date_trunc\('year', now\(\)\)/);
  assert.match(sum.sql, /AS total_cents/);
  assert.match(sum.sql, /AS utah_cents/);
  assert.match(sum.sql, /AS monthly_n/);
  assert.doesNotMatch(sum.sql, /LIMIT/);
});

test('monthlyPlansQuery groups subscriptions by status', () => {
  const { sql, params } = monthlyPlansQuery();
  assert.deepEqual(params, []);
  assert.match(sql, /FROM subscriptions GROUP BY status/);
});

test('describeDonationFilters reads like a sentence fragment', () => {
  assert.equal(describeDonationFilters({}), 'all time');
  assert.equal(describeDonationFilters({ timeframe: '30d', min: '25', residency: 'utah', kind: 'monthly', monthly: 'past_due', ticker: 'no', q: 'ann' }),
    'last 30 days · $25+ · Utah residents · monthly payments · monthly plan past due · off the ticker · matching “ann”');
  assert.equal(describeDonationFilters({ min: '5', max: '50' }), 'all time · $5–$50');
  assert.equal(describeDonationFilters({ max: '50' }), 'all time · up to $50');
});
