'use strict';
// Mailing-list audience: ONE definition of who an email goes to, shared by the
// admin's Subscribers ("Mailing list") page + CSV and scripts/send-periodical.js
// so the dashboard's counts are exactly the recipients the sender resolves.
//
// People = every `subscribers` row (join form + petition signers) UNION the
// opted-in Stripe members (newsletter_opt_in = 1) not already subscribed.
// Each person carries three derived labels:
//   residency  'utah' | 'outside' | 'unknown' — from the best ZIP we hold
//              (subscriber ZIP, else the newest petition ZIP, else member ZIP).
//              Every 84xxx ZIP is Utah and nothing else is (USPS allocation),
//              so the rule is a prefix test — UTAH_ZIP_SQL / isUtahZip.
//   donor      ≥1 recorded donation or a non-canceled subscription
//   petitions  comma-separated campaign slugs signed, oldest first
// docs/systems/petition.md "Residency and audiences".
//
// Two row sets come out of ONE template (peopleRowsSql):
//   AUDIENCE_ROWS_SQL  — the recipients: status = 'subscribed' only.
//   DIRECTORY_ROWS_SQL — everyone we hold a row for, each with a `status`
//                        (admin Mailing list page; docs/systems/newsletters.md
//                        "Mailing list management"). status is, in order:
//     unsubscribed  subscribers.unsubscribed_at set (their link, or an admin
//                   removed them — unsubscribed_by says which)
//     suppressed    a suppressing SES event (hard bounce / complaint,
//                   packages/db/email-events.js)
//     unconfirmed   join-form row whose confirm button was never pressed
//                   (double opt-in; petition signers are confirmed at insert)
//     subscribed    everything else — exactly the audience
//   Opted-in members with no subscribers row are 'subscribed' (or
//   'suppressed'); a member with ANY subscribers row is represented by that
//   row only, so unsubscribing (which also clears newsletter_opt_in) is final
//   until the person signs up / signs a petition again or an admin restores
//   an admin removal.
const { SUPPRESSED_SQL } = require('./email-events');

const UTAH_ZIP_PREFIX = '84';
function isUtahZip(zip) {
  return typeof zip === 'string' && /^84\d{3}(-\d{4})?$/.test(zip.trim());
}
// SQL predicate for a ZIP column/expression (same rule as isUtahZip).
function utahZipSql(expr) {
  return `${expr} LIKE '${UTAH_ZIP_PREFIX}%'`;
}

const RESIDENCIES = ['utah', 'outside', 'unknown'];
const STATUSES = ['subscribed', 'unconfirmed', 'unsubscribed', 'suppressed'];
// history: has the admin's sender (newsletter_deliveries, status 'sent')
// ever reached this address? 'never' = the dormant part of the list. The
// ledger starts 2026-10-05 — issues sent by other tools before that are not
// in it (docs/systems/newsletters.md "Saved lists").
const HISTORIES = ['never', 'reached'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_SQL = `CASE WHEN p.unsubscribed_at IS NOT NULL THEN 'unsubscribed'
              WHEN ${SUPPRESSED_SQL('p.email')} THEN 'suppressed'
              WHEN p.confirmed_at IS NULL THEN 'unconfirmed'
              ELSE 'subscribed' END`;

// peopleRowsSql(everyone) — everyone=false: only the recipients (the audience);
// everyone=true: every row we hold, plus status / confirmed_at /
// unsubscribed_at / unsubscribed_by columns for the admin page.
function peopleRowsSql(everyone) {
  const subscriberWhere = everyone ? '' : `
    WHERE s.confirmed_at IS NOT NULL
      AND s.unsubscribed_at IS NULL
      AND NOT ${SUPPRESSED_SQL('s.email')}`;
  const memberWhere = everyone ? '' : `
      AND NOT ${SUPPRESSED_SQL('mm.email')}`;
  const extra = everyone ? `,
         ${STATUS_SQL} AS status,
         p.confirmed_at::text AS confirmed_at, p.unsubscribed_at::text AS unsubscribed_at, p.unsubscribed_by` : '';
  return `
  SELECT p.email, p.first_name, p.last_name, p.address, p.zip, p.created_at::text AS created_at, p.via,
         CASE WHEN ${utahZipSql('z.best_zip')} THEN 'utah'
              WHEN z.best_zip IS NULL OR z.best_zip = '' THEN 'unknown'
              ELSE 'outside' END AS residency,
         EXISTS (
           SELECT 1 FROM members m
           WHERE m.email = p.email AND (
             EXISTS (SELECT 1 FROM donations d WHERE d.member_id = m.id)
             OR EXISTS (SELECT 1 FROM subscriptions x WHERE x.member_id = m.id AND x.status <> 'canceled')
           )
         ) AS donor,
         COALESCE((
           SELECT string_agg(ps.petition, ', ' ORDER BY ps.created_at)
           FROM petition_signatures ps WHERE ps.email = p.email
         ), '') AS petitions${extra}
  FROM (
    SELECT s.email, s.first_name, s.last_name, s.address, s.zip, s.created_at, 'subscriber' AS via,
           s.confirmed_at, s.unsubscribed_at, s.unsubscribed_by
    FROM subscribers s${subscriberWhere}
    UNION ALL
    SELECT mm.email, MAX(mm.first_name), MAX(mm.last_name), NULL, MAX(mm.zip), MIN(mm.created_at), 'member',
           MIN(mm.created_at), NULL, NULL
    FROM members mm
    WHERE mm.newsletter_opt_in = 1 AND mm.email IS NOT NULL
      AND mm.email NOT IN (SELECT s2.email FROM subscribers s2)${memberWhere}
    GROUP BY mm.email
  ) p
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(p.zip, ''),
      (SELECT ps2.zip FROM petition_signatures ps2 WHERE ps2.email = p.email ORDER BY ps2.created_at DESC LIMIT 1),
      (SELECT m2.zip FROM members m2 WHERE m2.email = p.email AND m2.zip IS NOT NULL AND m2.zip <> '' ORDER BY m2.created_at DESC LIMIT 1)
    ) AS best_zip
  ) z`;
}

// The base row set. Callers wrap it: SELECT … FROM (${AUDIENCE_ROWS_SQL}) a WHERE …
const AUDIENCE_ROWS_SQL = peopleRowsSql(false);
const DIRECTORY_ROWS_SQL = peopleRowsSql(true);

// Per-person delivery history for the admin page (newsletter_deliveries,
// packages/db/newsletters.js): how many newsletters reached them, when the
// last one did, and how many sends failed.
const DELIVERY_STATS_SQL = `
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE nd.status = 'sent')::int AS sent_count,
           count(*) FILTER (WHERE nd.status = 'failed')::int AS failed_count,
           max(nd.at) FILTER (WHERE nd.status = 'sent')::text AS last_sent_at
    FROM newsletter_deliveries nd WHERE nd.email = a.email
  ) dl ON true`;

// normalizeFilters(raw) → { residency: 'all'|'utah'|'outside'|'unknown', donors: bool, petition: ''|slug,
//                           history: 'all'|'never'|'reached', list: ''|uuid }
// list = a saved list's id (packages/db/lists.js): when set, the OTHER
// filters are ignored by the resolver (audienceFor) — the list carries its
// own. It is kept here so a newsletter's stored audience round-trips.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function normalizeFilters(raw = {}) {
  const residency = RESIDENCIES.includes(raw.residency) ? raw.residency : 'all';
  const donors = raw.donors === true || raw.donors === '1' || raw.donors === 'on' || raw.donors === 'true';
  const petition = typeof raw.petition === 'string' && SLUG_RE.test(raw.petition) ? raw.petition : '';
  const history = HISTORIES.includes(raw.history) ? raw.history : 'all';
  const list = typeof raw.list === 'string' && UUID_RE.test(raw.list) ? raw.list.toLowerCase() : '';
  return { residency, donors, petition, history, list };
}

const REACHED_SQL = (email) => `EXISTS (SELECT 1 FROM newsletter_deliveries nd WHERE nd.email = ${email} AND nd.status = 'sent')`;

// Shared WHERE fragments over the alias `a` for the audience filters.
function audienceWhere(f, params) {
  const where = [];
  if (f.residency !== 'all') { params.push(f.residency); where.push(`a.residency = $${params.length}`); }
  if (f.donors) where.push('a.donor');
  if (f.petition) {
    params.push(f.petition);
    where.push(`EXISTS (SELECT 1 FROM petition_signatures px WHERE px.email = a.email AND px.petition = $${params.length})`);
  }
  if (f.history === 'never') where.push(`NOT ${REACHED_SQL('a.email')}`);
  if (f.history === 'reached') where.push(REACHED_SQL('a.email'));
  return where;
}

// audienceQuery(filters, { columns, orderBy, limit, memberOf }) → { sql, params }
// columns: the SELECT list over the alias `a` (default: everything).
// memberOf: a FROZEN saved list's id — only addresses in its snapshot
// (mailing_list_members) are returned; the filters passed are still applied
// (pass {} for "the snapshot, minus anyone no longer eligible").
function audienceQuery(filters, { columns = 'a.*', orderBy = 'a.created_at DESC', limit, memberOf } = {}) {
  const f = normalizeFilters(filters);
  const params = [];
  const where = audienceWhere(f, params);
  if (memberOf) {
    if (!UUID_RE.test(String(memberOf))) throw new Error('memberOf must be a list id');
    params.push(String(memberOf).toLowerCase());
    where.push(`EXISTS (SELECT 1 FROM mailing_list_members lm WHERE lm.list_id = $${params.length}::uuid AND lm.email = a.email)`);
  }
  const sql = `SELECT ${columns} FROM (${AUDIENCE_ROWS_SQL}) a`
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + (orderBy ? ` ORDER BY ${orderBy}` : '')
    + (limit ? ` LIMIT ${Number(limit)}` : '');
  return { sql, params, filters: f };
}

// normalizeDirectoryFilters(raw) → audience filters + { status: 'all'|STATUSES, q: search text }
// q matches email or name (case-insensitive substring, bound as a parameter).
function normalizeDirectoryFilters(raw = {}) {
  const status = STATUSES.includes(raw.status) ? raw.status : raw.status === 'all' ? 'all' : 'subscribed';
  const q = typeof raw.q === 'string' ? raw.q.trim().slice(0, 100) : '';
  return { ...normalizeFilters(raw), status, q };
}

// directoryQuery(filters, { columns, orderBy, limit, deliveries }) → { sql, params, filters }
// Every row we hold, narrowed by status / search / the audience filters.
// deliveries: true adds sent_count, failed_count, last_sent_at per row.
function directoryQuery(filters, { columns = 'a.*', orderBy = 'a.created_at DESC', limit, deliveries = false } = {}) {
  const f = normalizeDirectoryFilters(filters);
  const params = [];
  const where = audienceWhere(f, params);
  if (f.status !== 'all') { params.push(f.status); where.push(`a.status = $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(a.email ILIKE $${params.length} OR COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '') ILIKE $${params.length})`);
  }
  const cols = deliveries && columns === 'a.*' ? 'a.*, dl.sent_count, dl.failed_count, dl.last_sent_at' : columns;
  const sql = `SELECT ${cols} FROM (${DIRECTORY_ROWS_SQL}) a`
    + (deliveries ? DELIVERY_STATS_SQL : '')
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + (orderBy ? ` ORDER BY ${orderBy}` : '')
    + (limit ? ` LIMIT ${Number(limit)}` : '');
  return { sql, params, filters: f };
}

// describeFilters(filters) → 'everyone' | 'Utah residents · donors only · signed udot-alpr-permits'
function describeFilters(filters) {
  const f = normalizeFilters(filters);
  const parts = [];
  if (f.residency === 'utah') parts.push('Utah residents');
  if (f.residency === 'outside') parts.push('outside Utah');
  if (f.residency === 'unknown') parts.push('ZIP unknown');
  if (f.donors) parts.push('donors only');
  if (f.petition) parts.push(`signed ${f.petition}`);
  if (f.history === 'never') parts.push('never received a newsletter');
  if (f.history === 'reached') parts.push('received a newsletter before');
  return parts.length ? parts.join(' · ') : 'everyone';
}

module.exports = {
  UTAH_ZIP_PREFIX, RESIDENCIES, STATUSES, HISTORIES, UUID_RE, isUtahZip, utahZipSql, AUDIENCE_ROWS_SQL, DIRECTORY_ROWS_SQL,
  normalizeFilters, audienceQuery, normalizeDirectoryFilters, directoryQuery, describeFilters,
};
