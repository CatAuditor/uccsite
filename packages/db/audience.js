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

const UTAH_ZIP_PREFIX = '84';
function isUtahZip(zip) {
  return typeof zip === 'string' && /^84\d{3}(-\d{4})?$/.test(zip.trim());
}
// SQL predicate for a ZIP column/expression (same rule as isUtahZip).
function utahZipSql(expr) {
  return `${expr} LIKE '${UTAH_ZIP_PREFIX}%'`;
}

const RESIDENCIES = ['utah', 'outside', 'unknown'];

// The base row set. Callers wrap it: SELECT … FROM (${AUDIENCE_ROWS_SQL}) a WHERE …
const AUDIENCE_ROWS_SQL = `
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
         ), '') AS petitions
  FROM (
    SELECT s.email, s.first_name, s.last_name, s.address, s.zip, s.created_at, 'subscriber' AS via
    FROM subscribers s
    UNION ALL
    SELECT mm.email, MAX(mm.first_name), MAX(mm.last_name), NULL, MAX(mm.zip), MIN(mm.created_at), 'member'
    FROM members mm
    WHERE mm.newsletter_opt_in = 1 AND mm.email IS NOT NULL
      AND mm.email NOT IN (SELECT s2.email FROM subscribers s2)
    GROUP BY mm.email
  ) p
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(p.zip, ''),
      (SELECT ps2.zip FROM petition_signatures ps2 WHERE ps2.email = p.email ORDER BY ps2.created_at DESC LIMIT 1),
      (SELECT m2.zip FROM members m2 WHERE m2.email = p.email AND m2.zip IS NOT NULL AND m2.zip <> '' ORDER BY m2.created_at DESC LIMIT 1)
    ) AS best_zip
  ) z`;

// normalizeFilters(raw) → { residency: 'all'|'utah'|'outside'|'unknown', donors: bool, petition: ''|slug }
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function normalizeFilters(raw = {}) {
  const residency = RESIDENCIES.includes(raw.residency) ? raw.residency : 'all';
  const donors = raw.donors === true || raw.donors === '1' || raw.donors === 'on' || raw.donors === 'true';
  const petition = typeof raw.petition === 'string' && SLUG_RE.test(raw.petition) ? raw.petition : '';
  return { residency, donors, petition };
}

// audienceQuery(filters, { columns, orderBy }) → { sql, params }
// columns: the SELECT list over the alias `a` (default: everything).
function audienceQuery(filters, { columns = 'a.*', orderBy = 'a.created_at DESC', limit } = {}) {
  const f = normalizeFilters(filters);
  const where = [];
  const params = [];
  if (f.residency !== 'all') { params.push(f.residency); where.push(`a.residency = $${params.length}`); }
  if (f.donors) where.push('a.donor');
  if (f.petition) {
    params.push(f.petition);
    where.push(`EXISTS (SELECT 1 FROM petition_signatures px WHERE px.email = a.email AND px.petition = $${params.length})`);
  }
  const sql = `SELECT ${columns} FROM (${AUDIENCE_ROWS_SQL}) a`
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
  return parts.length ? parts.join(' · ') : 'everyone';
}

module.exports = { UTAH_ZIP_PREFIX, RESIDENCIES, isUtahZip, utahZipSql, AUDIENCE_ROWS_SQL, normalizeFilters, audienceQuery, describeFilters };
