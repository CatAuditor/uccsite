// Financial → Costs shaping (lib/finance-shape.mjs; docs/systems/finance.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastMonths, monthLabel, shapeAwsCosts, shapeStripeMonths, sumCents } from '../lib/finance-shape.mjs';

test('lastMonths: n keys ending with the current month, across a year boundary', () => {
  assert.deepEqual(lastMonths(3, new Date('2026-10-09T23:30:00Z')), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(lastMonths(4, new Date('2026-02-01T00:00:00Z')), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(monthLabel('2026-10'), 'Oct 2026');
});

test('shapeAwsCosts: services × months, zero-only services dropped, sorted by the latest month', () => {
  const keys = ['2026-09', '2026-10'];
  const results = [
    { TimePeriod: { Start: '2026-09-01', End: '2026-10-01' }, Groups: [
      { Keys: ['AWS Amplify'], Metrics: { UnblendedCost: { Amount: '0.146' } } },
      { Keys: ['AWS Secrets Manager'], Metrics: { UnblendedCost: { Amount: '4.135' } } },
      { Keys: ['Amazon Cognito'], Metrics: { UnblendedCost: { Amount: '0' } } },
    ] },
    { TimePeriod: { Start: '2026-10-01', End: '2026-10-10' }, Groups: [
      { Keys: ['AWS Amplify'], Metrics: { UnblendedCost: { Amount: '2.438' } } },
      { Keys: ['AWS Secrets Manager'], Metrics: { UnblendedCost: { Amount: '2.028' } } },
      { Keys: ['Tax'], Metrics: { UnblendedCost: { Amount: '0.33' } } },
    ] },
  ];
  const out = shapeAwsCosts(results, keys);
  assert.deepEqual(out.services.map(s => s.name), ['AWS Amplify', 'AWS Secrets Manager', 'Tax']);
  assert.equal(out.services[0].byMonth['2026-09'], 0.146);
  assert.equal(out.services[0].total.toFixed(3), '2.584');
  assert.equal(out.totals['2026-09'].toFixed(3), '4.281');
  assert.equal(out.totals['2026-10'].toFixed(3), '4.796');
  assert.equal(out.services.find(s => s.name === 'Tax').byMonth['2026-09'], undefined);
});

test('shapeStripeMonths: charges, refunds, payouts and Stripe fees land in the right month and sign', () => {
  const keys = ['2026-09', '2026-10'];
  const sep = Math.floor(Date.UTC(2026, 8, 15) / 1000);
  const oct = Math.floor(Date.UTC(2026, 9, 3) / 1000);
  const txns = [
    { type: 'charge', created: sep, amount: 5000, fee: 175, net: 4825 },
    { type: 'charge', created: sep, amount: 2500, fee: 103, net: 2397 },
    { type: 'refund', created: sep, amount: -2500, fee: -103, net: -2397 },
    { type: 'payout', created: sep, amount: -4825, fee: 0, net: -4825 },
    { type: 'charge', created: oct, amount: 1000, fee: 59, net: 941 },
    { type: 'stripe_fee', created: oct, amount: -200, fee: 0, net: -200 },
    { type: 'charge', created: Math.floor(Date.UTC(2026, 6, 1) / 1000), amount: 999, fee: 1, net: 998 }, // outside the window
  ];
  const out = shapeStripeMonths(txns, keys);
  assert.deepEqual(out['2026-09'], { gross: 7500, refunds: 2500, fees: 175, net: 4825, payouts: 4825, count: 2 });
  assert.deepEqual(out['2026-10'], { gross: 1000, refunds: 0, fees: 259, net: 741, payouts: 0, count: 1 });
});

test('sumCents: USD balances only', () => {
  assert.equal(sumCents([{ amount: 100, currency: 'usd' }, { amount: 50, currency: 'eur' }, { amount: 7, currency: 'usd' }]), 107);
  assert.equal(sumCents(undefined), 0);
});
