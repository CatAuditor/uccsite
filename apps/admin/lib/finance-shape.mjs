// Pure shaping for Financial → Costs (lib/finance.js does the fetching):
// month keys, Cost Explorer results → the by-service table, Stripe balance
// transactions → per-month gross / refunds / fees / net / payouts. Tested in
// test/finance-shape.test.mjs. docs/systems/finance.md.

// ── month helpers (UTC, which is what both AWS billing and Stripe use) ──────
export function monthKey(d) { return d.toISOString().slice(0, 7); }
// lastMonths(n, now) → ['2026-05', …, '2026-10'] oldest first, ending with now's month.
export function lastMonths(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Pure: Cost Explorer ResultsByTime → the table shape (tested).
export function shapeAwsCosts(resultsByTime, keys) {
  const byService = new Map();
  const totals = Object.fromEntries(keys.map(k => [k, 0]));
  for (const period of resultsByTime) {
    const key = period.TimePeriod.Start.slice(0, 7);
    for (const g of period.Groups || []) {
      const name = g.Keys?.[0] || 'Other';
      const usd = Number(g.Metrics?.UnblendedCost?.Amount || 0);
      if (!byService.has(name)) byService.set(name, { name, byMonth: {}, total: 0 });
      const row = byService.get(name);
      row.byMonth[key] = (row.byMonth[key] || 0) + usd;
      row.total += usd;
      totals[key] = (totals[key] || 0) + usd;
    }
  }
  const latest = keys[keys.length - 1];
  const services = [...byService.values()]
    .filter(s => s.total >= 0.005)
    .sort((a, b) => (b.byMonth[latest] || 0) - (a.byMonth[latest] || 0) || b.total - a.total);
  return { months: keys, services, totals, fetchedAt: new Date().toISOString() };
}

export const sumCents = (list) => (list || []).filter(b => b.currency === 'usd').reduce((s, b) => s + (b.amount || 0), 0);

// Pure: balance transactions → per-month cents (tested). Stripe's amounts are
// signed from the balance's point of view: a refund is negative, a payout is
// negative, and a fee on a refund is a negative fee (the refund of the fee).
export function shapeStripeMonths(txns, keys) {
  const out = Object.fromEntries(keys.map(k => [k, { gross: 0, refunds: 0, fees: 0, net: 0, payouts: 0, count: 0 }]));
  for (const t of txns) {
    const key = monthKey(new Date(t.created * 1000));
    const m = out[key];
    if (!m) continue;
    switch (t.type) {
      case 'charge': case 'payment':
        m.gross += t.amount; m.fees += t.fee; m.count += 1; break;
      case 'refund': case 'payment_refund': case 'payment_failure_refund':
        m.refunds += -t.amount; m.fees += t.fee; break;
      case 'payout':
        m.payouts += -t.amount; break;
      case 'payout_cancel': case 'payout_failure':
        m.payouts -= t.amount; break;
      case 'stripe_fee': case 'application_fee': case 'tax_fee':
        m.fees += -t.amount; break;
      default:
        m.gross += t.net; // adjustments, disputes, transfers: counted at their net effect
    }
  }
  for (const m of Object.values(out)) m.net = m.gross - m.refunds - m.fees;
  return out;
}
