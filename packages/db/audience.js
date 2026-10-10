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
// giving: any = a donor (≥1 donation or a live subscription — same as `donor`);
// monthly = a live subscription; onetime = donor without one; none = not a donor.
const GIVINGS = ['any', 'monthly', 'onetime', 'none'];
// via: how the person first reached us — 'join' (the join form), 'petition'
// (a signature created the row: a signature within 5 minutes of the
// subscribers row's created_at — both are written in the same request;
// signing later does not change a join-form row's via), or 'member'
// (donation checkout opt-in with no subscribers row). 'subscriber' = join OR
// petition, kept so filters saved before 2026-10-10 still apply.
const VIAS = ['join', 'petition', 'member', 'subscriber'];
const VIA_SQL = `CASE WHEN EXISTS (SELECT 1 FROM petition_signatures ps3 WHERE ps3.email = s.email
                   AND ps3.created_at BETWEEN s.created_at - interval '5 minutes' AND s.created_at + interval '5 minutes')
                 THEN 'petition' ELSE 'join' END`;
// petition: a slug, or 'any' (signed something) / 'none' (signed nothing).
const PETITION_SPECIALS = ['any', 'none'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ZIP_PREFIX_RE = /^\d{1,5}$/;
// Every filter key a form / query string may carry (lib/lists.js filtersFrom,
// the audience-count route, the CSV route read them generically).
const FILTER_KEYS = ['residency', 'donors', 'petition', 'not_petition', 'history', 'list', 'not_list', 'giving', 'via', 'joined_after', 'joined_before', 'zip', 'last_sent_before'];

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
         z.best_zip,
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
    SELECT s.email, s.first_name, s.last_name, s.address, s.zip, s.created_at, ${VIA_SQL} AS via,
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

// normalizeFilters(raw) → { residency: 'all'|'utah'|'outside'|'unknown', donors: bool, petition: ''|slug|'any'|'none',
//                           history: 'all'|'never'|'reached', list: ''|uuid, giving: ''|GIVINGS, via: ''|VIAS,
//                           joined_after: ''|date, joined_before: ''|date, zip: ''|digits, last_sent_before: ''|date,
//                           not_petition: ''|slug|'any' (EXCLUDE signers), not_list: ''|uuid (EXCLUDE a saved list's members) }
// list = a saved list's id (packages/db/lists.js): when set, the OTHER
// filters are ignored by the resolver (audienceFor) — the list carries its
// own. It is kept here so a newsletter's stored audience round-trips.
// donors (the pre-2026-10-10 checkbox) is kept for stored audiences; it means
// the same as giving = 'any'.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const dateOr = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : '');
function normalizeFilters(raw = {}) {
  const residency = RESIDENCIES.includes(raw.residency) ? raw.residency : 'all';
  const donors = raw.donors === true || raw.donors === '1' || raw.donors === 'on' || raw.donors === 'true';
  const petition = typeof raw.petition === 'string' && (SLUG_RE.test(raw.petition) || PETITION_SPECIALS.includes(raw.petition)) ? raw.petition : '';
  const history = HISTORIES.includes(raw.history) ? raw.history : 'all';
  const list = typeof raw.list === 'string' && UUID_RE.test(raw.list) ? raw.list.toLowerCase() : '';
  const giving = GIVINGS.includes(raw.giving) ? raw.giving : '';
  const via = VIAS.includes(raw.via) ? raw.via : '';
  const zip = typeof raw.zip === 'string' && ZIP_PREFIX_RE.test(raw.zip.trim()) ? raw.zip.trim() : '';
  const not_petition = typeof raw.not_petition === 'string' && (SLUG_RE.test(raw.not_petition) || raw.not_petition === 'any') ? raw.not_petition : '';
  const not_list = typeof raw.not_list === 'string' && UUID_RE.test(raw.not_list) ? raw.not_list.toLowerCase() : '';
  return { residency, donors, petition, not_petition, history, list, not_list, giving, via, joined_after: dateOr(raw.joined_after), joined_before: dateOr(raw.joined_before), zip, last_sent_before: dateOr(raw.last_sent_before) };
}

const REACHED_SQL = (email) => `EXISTS (SELECT 1 FROM newsletter_deliveries nd WHERE nd.email = ${email} AND nd.status = 'sent')`;
const MONTHLY_SQL = `EXISTS (SELECT 1 FROM members mo JOIN subscriptions xo ON xo.member_id = mo.id WHERE mo.email = a.email AND xo.status <> 'canceled')`;

// Shared WHERE fragments over the alias `a` for the audience filters.
function audienceWhere(f, params) {
  const where = [];
  if (f.residency !== 'all') { params.push(f.residency); where.push(`a.residency = $${params.length}`); }
  if (f.donors || f.giving === 'any') where.push('a.donor');
  if (f.giving === 'monthly') where.push(MONTHLY_SQL);
  if (f.giving === 'onetime') where.push(`a.donor AND NOT ${MONTHLY_SQL}`);
  if (f.giving === 'none') where.push('NOT a.donor');
  if (f.petition === 'any') where.push(`a.petitions <> ''`);
  else if (f.petition === 'none') where.push(`a.petitions = ''`);
  else if (f.petition) {
    params.push(f.petition);
    where.push(`EXISTS (SELECT 1 FROM petition_signatures px WHERE px.email = a.email AND px.petition = $${params.length})`);
  }
  if (f.not_petition === 'any') where.push(`a.petitions = ''`);
  else if (f.not_petition) {
    params.push(f.not_petition);
    where.push(`NOT EXISTS (SELECT 1 FROM petition_signatures pn WHERE pn.email = a.email AND pn.petition = $${params.length})`);
  }
  if (f.not_list) {
    // everyone on that saved list (snapshot + by hand) is left out — e.g. "all
    // except the people the dormant mailing already went to"
    params.push(f.not_list);
    where.push(`NOT EXISTS (SELECT 1 FROM mailing_list_members ln WHERE ln.list_id = $${params.length}::uuid AND ln.email = a.email)`);
  }
  if (f.history === 'never') where.push(`NOT ${REACHED_SQL('a.email')}`);
  if (f.history === 'reached') where.push(REACHED_SQL('a.email'));
  if (f.via === 'subscriber') where.push(`a.via IN ('join', 'petition')`);
  else if (f.via) { params.push(f.via); where.push(`a.via = $${params.length}`); }
  if (f.joined_after) { params.push(f.joined_after); where.push(`a.created_at::timestamptz >= $${params.length}::date`); }
  if (f.joined_before) { params.push(f.joined_before); where.push(`a.created_at::timestamptz < $${params.length}::date + 1`); }
  if (f.zip) { params.push(`${f.zip}%`); where.push(`a.best_zip LIKE $${params.length}`); }
  if (f.last_sent_before) {
    // nothing sent on or after the date (never emailed counts too)
    params.push(f.last_sent_before);
    where.push(`NOT EXISTS (SELECT 1 FROM newsletter_deliveries nd2 WHERE nd2.email = a.email AND nd2.status = 'sent' AND nd2.at >= $${params.length}::date)`);
  }
  return where;
}

// audienceQuery(filters, { columns, orderBy, limit, memberOf, orManualOf }) → { sql, params }
// columns: the SELECT list over the alias `a` (default: everything).
// memberOf: a FROZEN saved list's id — only addresses in its members table
// (snapshot + added by hand) are returned; the filters passed are still
// applied (pass {} for "the members, minus anyone no longer eligible").
// orManualOf: a DYNAMIC list's id — the filters OR the people added to the
// list by hand (source 'manual'); eligibility rules apply to both.
function audienceQuery(filters, { columns = 'a.*', orderBy = 'a.created_at DESC', limit, memberOf, orManualOf } = {}) {
  const f = normalizeFilters(filters);
  const params = [];
  const where = audienceWhere(f, params);
  if (memberOf) {
    if (!UUID_RE.test(String(memberOf))) throw new Error('memberOf must be a list id');
    params.push(String(memberOf).toLowerCase());
    where.push(`EXISTS (SELECT 1 FROM mailing_list_members lm WHERE lm.list_id = $${params.length}::uuid AND lm.email = a.email)`);
  }
  let whereSql = where.join(' AND ');
  if (orManualOf && where.length) {
    if (!UUID_RE.test(String(orManualOf))) throw new Error('orManualOf must be a list id');
    params.push(String(orManualOf).toLowerCase());
    whereSql = `(${whereSql}) OR EXISTS (SELECT 1 FROM mailing_list_members lm WHERE lm.list_id = $${params.length}::uuid AND lm.source = 'manual' AND lm.email = a.email)`;
  }
  const sql = `SELECT ${columns} FROM (${AUDIENCE_ROWS_SQL}) a`
    + (whereSql ? ` WHERE ${whereSql}` : '')
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
  if (f.donors || f.giving === 'any') parts.push('donors only');
  if (f.giving === 'monthly') parts.push('monthly members');
  if (f.giving === 'onetime') parts.push('one-time donors');
  if (f.giving === 'none') parts.push('non-donors');
  if (f.petition === 'any') parts.push('signed a petition');
  else if (f.petition === 'none') parts.push('signed no petition');
  else if (f.petition) parts.push(`signed ${f.petition}`);
  if (f.not_petition === 'any') parts.push('signed no petition');
  else if (f.not_petition) parts.push(`did not sign ${f.not_petition}`);
  if (f.not_list) parts.push('not on a saved list');
  if (f.history === 'never') parts.push('never received a newsletter');
  if (f.history === 'reached') parts.push('received a newsletter before');
  if (f.via === 'join') parts.push('via the join form');
  if (f.via === 'petition') parts.push('via a petition');
  if (f.via === 'subscriber') parts.push('via join form / petition');
  if (f.via === 'member') parts.push('via donation checkout');
  if (f.joined_after) parts.push(`joined ${f.joined_after} or later`);
  if (f.joined_before) parts.push(`joined by ${f.joined_before}`);
  if (f.zip) parts.push(`ZIP starts ${f.zip}`);
  if (f.last_sent_before) parts.push(`not emailed since ${f.last_sent_before}`);
  return parts.length ? parts.join(' · ') : 'everyone';
}

module.exports = {
  UTAH_ZIP_PREFIX, RESIDENCIES, STATUSES, HISTORIES, GIVINGS, VIAS, PETITION_SPECIALS, FILTER_KEYS, UUID_RE, isUtahZip, utahZipSql, AUDIENCE_ROWS_SQL, DIRECTORY_ROWS_SQL,
  normalizeFilters, audienceQuery, normalizeDirectoryFilters, directoryQuery, describeFilters,
};
