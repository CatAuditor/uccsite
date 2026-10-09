'use strict';
// Donations for the admin's Financial section (docs/systems/finance.md):
// the filtered list, its summary, and the standing monthly-plan counts.
// Pure SQL builders (tested) — the page runs them with its own client.
//
// Every figure derives from columns we already hold (donations, members,
// subscriptions); nothing new about a donor is stored. Residency is the
// mailing list's rule (packages/db/audience.js): every 84xxx ZIP is Utah.
//
// "Monthly": a row is a monthly payment when it carries the subscription it
// was charged for (donations.stripe_subscription_id, written by invoice.paid
// since 2026-10-10) or — rows older than that — when the donor holds a plan
// of exactly that amount. The donor's "monthly status" is the state of their
// newest plan, an active one first (active / past_due / canceled / …).
const { utahZipSql, RESIDENCIES } = require('./audience');

const TIMEFRAMES = ['30d', '90d', 'ytd', '12m', 'all'];
const TIMEFRAME_SQL = {
  '30d': "d.created_at >= now() - interval '30 days'",
  '90d': "d.created_at >= now() - interval '90 days'",
  ytd: "d.created_at >= date_trunc('year', now())",
  '12m': "d.created_at >= now() - interval '12 months'",
  all: null,
};
const TIMEFRAME_LABEL = { '30d': 'last 30 days', '90d': 'last 90 days', ytd: 'this year', '12m': 'last 12 months', all: 'all time' };
const KINDS = ['all', 'one-time', 'monthly'];
const MONTHLY_STATES = ['any', 'active', 'past_due', 'canceled'];
const TICKER = ['any', 'yes', 'no'];

const MONTHLY_SQL = `(d.stripe_subscription_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM subscriptions x WHERE x.member_id = d.member_id AND x.amount_cents = d.amount_cents))`;
const SUB_STATUS_SQL = `(SELECT x.status FROM subscriptions x WHERE x.member_id = d.member_id
    ORDER BY (x.status = 'active') DESC, x.updated_at DESC LIMIT 1)`;
const RESIDENCY_SQL = `CASE WHEN ${utahZipSql('m.zip')} THEN 'utah'
    WHEN m.zip IS NULL OR m.zip = '' THEN 'unknown' ELSE 'outside' END`;

// Dollars typed into a filter → cents, or null when blank / not a number.
function toCents(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

// normalizeDonationFilters(raw) → every filter present and valid.
function normalizeDonationFilters(raw = {}) {
  const pick = (list, v, dflt) => (list.includes(v) ? v : dflt);
  return {
    timeframe: pick(TIMEFRAMES, raw.timeframe, 'all'),
    min: toCents(raw.min),
    max: toCents(raw.max),
    residency: pick(['all', ...RESIDENCIES], raw.residency, 'all'),
    kind: pick(KINDS, raw.kind, 'all'),
    monthly: pick(MONTHLY_STATES, raw.monthly, 'any'),
    ticker: pick(TICKER, raw.ticker, 'any'),
    q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 80) : '',
  };
}

// The FROM + WHERE every donations query shares. params is appended to.
function fromWhere(f, params) {
  const where = [];
  if (TIMEFRAME_SQL[f.timeframe]) where.push(TIMEFRAME_SQL[f.timeframe]);
  if (f.min !== null) { params.push(f.min); where.push(`d.amount_cents >= $${params.length}`); }
  if (f.max !== null) { params.push(f.max); where.push(`d.amount_cents <= $${params.length}`); }
  if (f.residency !== 'all') { params.push(f.residency); where.push(`${RESIDENCY_SQL} = $${params.length}`); }
  if (f.kind === 'one-time') where.push(`NOT ${MONTHLY_SQL}`);
  if (f.kind === 'monthly') where.push(MONTHLY_SQL);
  if (f.monthly !== 'any') { params.push(f.monthly); where.push(`${SUB_STATUS_SQL} = $${params.length}`); }
  if (f.ticker === 'yes') where.push('d.public = 1');
  if (f.ticker === 'no') where.push('d.public = 0');
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(m.email ILIKE $${params.length} OR (COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) ILIKE $${params.length})`);
  }
  return `FROM donations d LEFT JOIN members m ON d.member_id = m.id${where.length ? `\n  WHERE ${where.join('\n    AND ')}` : ''}`;
}

// donationsQuery(filters, { limit }) → { sql, params }: the rows, newest first.
function donationsQuery(filters, { limit = 200 } = {}) {
  const f = normalizeDonationFilters(filters);
  const params = [];
  const body = fromWhere(f, params);
  params.push(limit);
  return {
    sql: `SELECT d.id, d.amount_cents, d.public, d.created_at::text AS created_at,
         d.stripe_subscription_id, m.first_name, m.last_name, m.email, m.zip,
         ${RESIDENCY_SQL} AS residency,
         ${MONTHLY_SQL} AS monthly,
         ${SUB_STATUS_SQL} AS sub_status,
         (SELECT count(*)::int FROM donations p WHERE p.member_id = d.member_id) AS donor_gifts
  ${body}
  ORDER BY d.created_at DESC LIMIT $${params.length}`,
    params,
  };
}

// donationsSummaryQuery(filters) → one row: counts and totals over the SAME
// filtered set the list shows (not capped by the list limit).
function donationsSummaryQuery(filters) {
  const f = normalizeDonationFilters(filters);
  const params = [];
  const body = fromWhere(f, params);
  return {
    sql: `SELECT count(*)::int AS n, COALESCE(sum(d.amount_cents), 0)::bigint AS total_cents,
         COALESCE(max(d.amount_cents), 0)::int AS max_cents,
         count(DISTINCT d.member_id)::int AS donors,
         count(*) FILTER (WHERE ${utahZipSql('m.zip')})::int AS utah_n,
         COALESCE(sum(d.amount_cents) FILTER (WHERE ${utahZipSql('m.zip')}), 0)::bigint AS utah_cents,
         count(*) FILTER (WHERE ${MONTHLY_SQL})::int AS monthly_n,
         COALESCE(sum(d.amount_cents) FILTER (WHERE ${MONTHLY_SQL}), 0)::bigint AS monthly_cents,
         count(*) FILTER (WHERE d.public = 1)::int AS public_n
  ${body}`,
    params,
  };
}

// monthlyPlansQuery() → rows { status, n, cents }: every subscription by
// state. active n × cents = what comes in each month if nothing changes.
function monthlyPlansQuery() {
  return {
    sql: `SELECT status, count(*)::int AS n, COALESCE(sum(amount_cents), 0)::bigint AS cents
  FROM subscriptions GROUP BY status ORDER BY status`,
    params: [],
  };
}

// describeDonationFilters(f) → "last 30 days · $25+ · Utah residents · monthly"
function describeDonationFilters(filters) {
  const f = normalizeDonationFilters(filters);
  const parts = [TIMEFRAME_LABEL[f.timeframe]];
  const dollars = (c) => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (f.min !== null && f.max !== null) parts.push(`${dollars(f.min)}–${dollars(f.max)}`);
  else if (f.min !== null) parts.push(`${dollars(f.min)}+`);
  else if (f.max !== null) parts.push(`up to ${dollars(f.max)}`);
  if (f.residency === 'utah') parts.push('Utah residents');
  if (f.residency === 'outside') parts.push('outside Utah');
  if (f.residency === 'unknown') parts.push('ZIP unknown');
  if (f.kind !== 'all') parts.push(f.kind === 'monthly' ? 'monthly payments' : 'one-time gifts');
  if (f.monthly !== 'any') parts.push(`monthly plan ${f.monthly.replace('_', ' ')}`);
  if (f.ticker === 'yes') parts.push('on the public ticker');
  if (f.ticker === 'no') parts.push('off the ticker');
  if (f.q) parts.push(`matching “${f.q}”`);
  return parts.join(' · ');
}

module.exports = {
  TIMEFRAMES, TIMEFRAME_LABEL, KINDS, MONTHLY_STATES, TICKER, toCents,
  normalizeDonationFilters, donationsQuery, donationsSummaryQuery, monthlyPlansQuery, describeDonationFilters,
};
