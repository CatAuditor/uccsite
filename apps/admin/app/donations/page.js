// Financial → Donations (docs/systems/finance.md). Staff see every donation
// — amount, donor, contact info where given — while the public site shows
// only the opt-in ticker. Filters (timeframe, amount, residency, one-time /
// monthly, the donor's monthly-plan state, ticker, search) and the summary
// above the table come from packages/db/donations.js; the summary covers
// the whole filtered set, the table the newest LIST_LIMIT rows of it.
// Nothing new about a donor is stored: residency is derived from the ZIP
// at read time (every 84xxx ZIP is Utah), monthly from the subscription.
import {
  donationsQuery, donationsSummaryQuery, monthlyPlansQuery, normalizeDonationFilters, describeDonationFilters,
  TIMEFRAMES, TIMEFRAME_LABEL,
} from '@uccsite/db/donations';
import { RESIDENCIES } from '@uccsite/db/audience';
import { requireRole } from '../../lib/auth';
import { withDb } from '../../lib/data';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 200;
const RESIDENCY_LABEL = { utah: 'Utah residents', outside: 'outside Utah', unknown: 'ZIP unknown' };
const PLAN_LABEL = { active: 'active', past_due: 'past due', canceled: 'canceled', trialing: 'trialing', unpaid: 'unpaid', incomplete: 'incomplete', incomplete_expired: 'expired', paused: 'paused' };
const PLAN_CLASS = { active: 'status-subscribed', past_due: 'status-unconfirmed', canceled: 'status-unsubscribed' };
const fmt = (c) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function DonationsPage({ searchParams }) {
  // Donor PII: editor or owner only (spec §11 gives "read form submissions"
  // to editor; viewer is read-only CONTENT). requireRole throws for viewer —
  // the layout still gates unauthenticated users to /login.
  await requireRole('editor');
  const sp = await searchParams;
  const pick = (k) => (typeof sp?.[k] === 'string' ? sp[k] : '');
  const filters = normalizeDonationFilters({
    timeframe: pick('timeframe') || 'all', min: pick('min'), max: pick('max'), residency: pick('residency') || 'all',
    kind: pick('kind') || 'all', monthly: pick('monthly') || 'any', ticker: pick('ticker') || 'any', q: pick('q'),
  });
  const { rows, summary, plans } = await withDb(async (client) => {
    const list = donationsQuery(filters, { limit: LIST_LIMIT });
    const sum = donationsSummaryQuery(filters);
    const planQ = monthlyPlansQuery();
    return {
      rows: (await client.query(list.sql, list.params)).rows,
      summary: (await client.query(sum.sql, sum.params)).rows[0],
      plans: (await client.query(planQ.sql, planQ.params)).rows,
    };
  });
  console.log(`[finance] donations list: ${rows.length} of ${summary.n} rows (${describeDonationFilters(filters)})`);
  const plan = (s) => plans.find(p => p.status === s) || { n: 0, cents: 0 };
  const active = plan('active');
  const avg = summary.n ? Math.round(Number(summary.total_cents) / summary.n) : 0;
  const pct = (part, whole) => (whole ? Math.round((Number(part) / Number(whole)) * 100) : 0);
  const filtered = describeDonationFilters(filters) !== 'all time';
  const minDollars = filters.min === null ? '' : String(filters.min / 100);
  const maxDollars = filters.max === null ? '' : String(filters.max / 100);

  return (
    <div>
      <h1>Donations <span className="hint">{summary.n} gifts · {fmt(summary.total_cents)} · {describeDonationFilters(filters)}</span></h1>
      <p className="notice">
        Every donation Stripe has told us about, with the donor&rsquo;s contact details where they gave them.
        Internal only &mdash; the public site shows no totals, just the opt-in ticker of first names.
        <strong> Monthly</strong> means the charge came from a monthly plan; <strong>Plan</strong> is the state of
        that donor&rsquo;s plan today (<em>active</em> = still charging, <em>past due</em> = a card failed,
        <em>canceled</em> = stopped). Residency is read from the ZIP (every 84xxx ZIP is Utah); nothing
        extra is stored about anyone. AWS and Stripe costs are under <a href="/costs">Costs</a>.
      </p>

      <div className="stats">
        <div className="stat"><div className="stat-value">{fmt(summary.total_cents)}</div><div className="stat-label">{summary.n} {summary.n === 1 ? 'gift' : 'gifts'} from {summary.donors} {summary.donors === 1 ? 'donor' : 'donors'}</div></div>
        <div className="stat"><div className="stat-value">{fmt(avg)}</div><div className="stat-label">average gift · largest {fmt(summary.max_cents)}</div></div>
        <div className="stat"><div className="stat-value">{pct(summary.utah_cents, summary.total_cents)}%</div><div className="stat-label">from Utah · {summary.utah_n} gifts, {fmt(summary.utah_cents)}</div></div>
        <div className="stat"><div className="stat-value">{pct(summary.monthly_cents, summary.total_cents)}%</div><div className="stat-label">from monthly plans · {summary.monthly_n} payments, {fmt(summary.monthly_cents)}</div></div>
        <div className="stat"><div className="stat-value">{fmt(active.cents)}<span className="stat-unit">/mo</span></div><div className="stat-label">{active.n} active monthly {active.n === 1 ? 'plan' : 'plans'} · {plan('past_due').n} past due · {plan('canceled').n} canceled</div></div>
        <div className="stat"><div className="stat-value">{pct(summary.public_n, summary.n)}%</div><div className="stat-label">on the public ticker · {summary.public_n} of {summary.n}</div></div>
      </div>

      <form method="get" action="/donations" className="list-tools">
        <label htmlFor="timeframe">When</label>
        <select id="timeframe" name="timeframe" defaultValue={filters.timeframe}>
          {TIMEFRAMES.map(t => <option key={t} value={t}>{TIMEFRAME_LABEL[t]}</option>)}
        </select>
        <label htmlFor="min">Amount $</label>
        <input id="min" name="min" type="number" min="0" step="1" inputMode="decimal" placeholder="min" defaultValue={minDollars} className="short" />
        <span aria-hidden="true">–</span>
        <input id="max" name="max" type="number" min="0" step="1" inputMode="decimal" placeholder="max" defaultValue={maxDollars} className="short" aria-label="Maximum amount in dollars" />
        <label htmlFor="residency">Where</label>
        <select id="residency" name="residency" defaultValue={filters.residency}>
          <option value="all">anywhere</option>
          {RESIDENCIES.map(r => <option key={r} value={r}>{RESIDENCY_LABEL[r]}</option>)}
        </select>
        <label htmlFor="kind">Type</label>
        <select id="kind" name="kind" defaultValue={filters.kind}>
          <option value="all">one-time and monthly</option>
          <option value="one-time">one-time gifts</option>
          <option value="monthly">monthly payments</option>
        </select>
        <label htmlFor="monthly">Plan</label>
        <select id="monthly" name="monthly" defaultValue={filters.monthly}>
          <option value="any">any</option>
          <option value="active">active</option>
          <option value="past_due">past due</option>
          <option value="canceled">canceled</option>
        </select>
        <label htmlFor="ticker">Ticker</label>
        <select id="ticker" name="ticker" defaultValue={filters.ticker}>
          <option value="any">any</option>
          <option value="yes">shown</option>
          <option value="no">opted out</option>
        </select>
        <input type="search" name="q" placeholder="Search name or email" defaultValue={filters.q} aria-label="Search name or email" />
        <button type="submit">Apply</button>
        {filtered && <a href="/donations" className="hint">clear</a>}
      </form>

      <p className="hint">
        {rows.length < summary.n
          ? `Showing the newest ${rows.length} of ${summary.n} matching donations; the figures above cover all ${summary.n}.`
          : `${rows.length} ${rows.length === 1 ? 'donation' : 'donations'} — ${describeDonationFilters(filters)}.`}
      </p>

      <table>
        <thead>
          <tr><th>Date</th><th>Amount</th><th>Donor</th><th>Email</th><th>ZIP</th><th>Type</th><th>Plan</th><th>Ticker</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.created_at?.slice(0, 10)}</td>
              <td>{fmt(r.amount_cents)}</td>
              <td>
                {[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}
                {r.donor_gifts > 1 && <div className="hint">{r.donor_gifts} gifts</div>}
              </td>
              <td>{r.email || '—'}</td>
              <td>
                {r.zip || '—'}
                {r.residency === 'utah' && <span className="chip rule ut" title="Utah ZIP">UT</span>}
              </td>
              <td>{r.monthly ? 'monthly' : 'one-time'}</td>
              <td>
                {r.sub_status
                  ? <span className={`chip ${PLAN_CLASS[r.sub_status] || ''}`}>{PLAN_LABEL[r.sub_status] || r.sub_status}</span>
                  : <span className="hint">no plan</span>}
              </td>
              <td>{r.public ? 'shown' : 'opted out'}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="8">{filtered ? 'No donations match these filters.' : 'No donations recorded yet.'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
