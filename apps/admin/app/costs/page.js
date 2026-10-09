// Financial → Costs (docs/systems/finance.md): what running the site costs,
// next to what comes in. AWS from Cost Explorer (by service, by month),
// Stripe from its balance transactions (gross, refunds, fees, net, paid
// out), monthly plans from our own subscriptions table, and the services
// with no bill to pull. Editor+ like Donations. Each source fails on its
// own: the page says what it could not reach and shows the rest.
import { monthlyPlansQuery } from '@uccsite/db/donations';
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';
import { awsCosts, stripeSummary, monthLabel } from '../../lib/finance';

export const dynamic = 'force-dynamic';

const MONTHS = 6;
const usd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (c) => usd((Number(c) || 0) / 100);
// Tiny AWS lines (a fraction of a cent) show as "<$0.01" rather than $0.00.
const small = (n) => (n > 0 && n < 0.005 ? '<$0.01' : usd(n));

// The services the site depends on whose cost cannot be pulled by API.
// Static on purpose: say where the money is (or is not), not a guess at it.
const OTHER_SERVICES = [
  ['Stripe', 'Card processing', 'Per-transaction fees only, shown above. No monthly charge.'],
  ['Cloudflare', 'DNS, Turnstile (the form bot check)', 'Free plan. The domain renews yearly on the Cloudflare account; check the Cloudflare dashboard for the renewal date and price.'],
  ['GitHub', 'Code and the nightly content export', 'Free plan.'],
  ['Google Fonts', 'Inter (self-hosted on the site; the admin fetches it at build)', 'Free.'],
];

export default async function CostsPage() {
  await requireRole('editor');
  const [aws, stripe, plans] = await Promise.all([
    awsCosts(MONTHS),
    stripeSummary(MONTHS),
    withDb(async (client) => { const q = monthlyPlansQuery(); return (await client.query(q.sql, q.params)).rows; }),
  ]);
  const plan = (s) => plans.find(p => p.status === s) || { n: 0, cents: 0 };
  const active = plan('active');
  const months = aws.months || stripe.months || [];
  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2];
  const awsThis = aws.totals?.[thisMonth] || 0;
  const awsLast = aws.totals?.[lastMonth] || 0;
  const stThis = stripe.byMonth?.[thisMonth];
  const stLast = stripe.byMonth?.[lastMonth];

  return (
    <div>
      <h1>Costs <span className="hint">AWS, Stripe and the services around the site · last {MONTHS} months</span></h1>
      <p className="notice">
        <strong>AWS</strong> is the hosting bill as AWS reports it (site, admin, database, email, the lot), by
        service and month; the current month is to date. <strong>Stripe</strong> is read from Stripe itself:
        every card charge, what Stripe kept, and what it paid out to the bank, so these figures match the
        Stripe dashboard rather than our own donations table. Figures refresh when the page is opened
        (AWS at most hourly). Individual gifts are under <a href="/donations">Donations</a>.
      </p>

      <div className="stats">
        <div className="stat"><div className="stat-value">{aws.error ? '—' : usd(awsThis)}</div><div className="stat-label">AWS {thisMonth ? monthLabel(thisMonth) : 'this month'} to date · {aws.error ? 'unavailable' : `${usd(awsLast)} last month`}</div></div>
        <div className="stat"><div className="stat-value">{stThis ? cents(stThis.net) : '—'}</div><div className="stat-label">Stripe net {thisMonth ? monthLabel(thisMonth) : 'this month'} · {stThis ? `${cents(stThis.gross)} gross, ${cents(stThis.fees)} fees` : 'unavailable'}</div></div>
        <div className="stat"><div className="stat-value">{stLast ? cents(stLast.net) : '—'}</div><div className="stat-label">Stripe net {lastMonth ? monthLabel(lastMonth) : 'last month'} · {stLast ? `${cents(stLast.gross)} gross, ${cents(stLast.fees)} fees` : 'unavailable'}</div></div>
        <div className="stat"><div className="stat-value">{cents(active.cents)}<span className="stat-unit">/mo</span></div><div className="stat-label">{active.n} active monthly {active.n === 1 ? 'plan' : 'plans'} · {plan('past_due').n} past due · {plan('canceled').n} canceled</div></div>
        <div className="stat"><div className="stat-value">{stripe.balance ? cents(stripe.balance.available + stripe.balance.pending) : '—'}</div><div className="stat-label">in Stripe, not yet paid out · {stripe.balance ? `${cents(stripe.balance.available)} available, ${cents(stripe.balance.pending)} pending` : 'unavailable'}</div></div>
      </div>

      <h2>AWS by service</h2>
      {aws.error
        ? <p className="error">{aws.error}</p>
        : (
          <table className="numbers">
            <thead><tr><th>Service</th>{aws.months.map(m => <th key={m} className="num">{monthLabel(m)}{m === thisMonth ? ' (to date)' : ''}</th>)}</tr></thead>
            <tbody>
              {aws.services.map(s => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  {aws.months.map(m => <td key={m} className="num">{s.byMonth[m] === undefined ? '' : small(s.byMonth[m])}</td>)}
                </tr>
              ))}
              {!aws.services.length && <tr><td colSpan={aws.months.length + 1}>No AWS charges in this window.</td></tr>}
            </tbody>
            <tfoot><tr><th>Total</th>{aws.months.map(m => <th key={m} className="num">{usd(aws.totals[m] || 0)}</th>)}</tr></tfoot>
          </table>
        )}
      {!aws.error && <p className="hint">As billed, including tax and any credits. Fetched {aws.fetchedAt.slice(0, 16).replace('T', ' ')} UTC.</p>}

      <h2>Stripe by month {stripe.livemode === false && <span className="chip override">test mode key</span>}</h2>
      {stripe.error
        ? <p className={stripe.unset ? 'hint' : 'error'}>{stripe.error}</p>
        : (
          <table className="numbers">
            <thead><tr><th>Month</th><th className="num">Charges</th><th className="num">Gross</th><th className="num">Refunds</th><th className="num">Stripe fees</th><th className="num">Net</th><th className="num">Paid out</th></tr></thead>
            <tbody>
              {[...stripe.months].reverse().map(m => {
                const r = stripe.byMonth[m];
                return (
                  <tr key={m}>
                    <td>{monthLabel(m)}{m === thisMonth ? <span className="hint"> to date</span> : ''}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{cents(r.gross)}</td>
                    <td className="num">{r.refunds ? cents(r.refunds) : ''}</td>
                    <td className="num">{cents(r.fees)}</td>
                    <td className="num"><strong>{cents(r.net)}</strong></td>
                    <td className="num">{r.payouts ? cents(r.payouts) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      {!stripe.error && <p className="hint">Net = gross − refunds − fees; &ldquo;paid out&rdquo; is what reached the bank that month (Stripe pays out on its own schedule, so a month&rsquo;s net and payout differ). Fetched {stripe.fetchedAt.slice(0, 16).replace('T', ' ')} UTC.</p>}

      <h2>Other services</h2>
      <table>
        <thead><tr><th>Service</th><th>What it does for the site</th><th>Cost</th></tr></thead>
        <tbody>
          {OTHER_SERVICES.map(([name, role, cost]) => <tr key={name}><td>{name}</td><td>{role}</td><td>{cost}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
