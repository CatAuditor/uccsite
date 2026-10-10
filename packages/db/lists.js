'use strict';
// Saved mailing lists (docs/systems/newsletters.md "Saved lists"): a named set
// of audience filters an email can be sent to by name, in one of two modes.
//   dynamic  the filters are re-run whenever the list is used — the audience
//            is whoever matches at send time (how ad-hoc filters have always
//            worked).
//   frozen   the people who matched when the list was frozen (an "Update"
//            re-freezes it) — mailing_list_members is that snapshot. A send
//            goes to the snapshot MINUS anyone no longer eligible
//            (unsubscribed, bounced, unconfirmed): audienceQuery({}, { memberOf })
//            keeps the eligibility rules, so freezing never overrides an
//            unsubscribe.
// People can also be ADDED BY HAND (mailing_list_members.source = 'manual'):
// a frozen list mails them with the snapshot; a dynamic list mails them in
// addition to the filter match. "Update" replaces the snapshot rows only.
// Someone added by hand who is not an eligible mailing-list row (no
// subscribers row, unconfirmed, unsubscribed, bounced) is kept on the list
// but never mailed — the admin page says so per person.
// The one resolver every sender uses is audienceFor(): a newsletter's stored
// audience is either ad-hoc filters or { list: <id> }; the admin's count, the
// CSV, the request's recipient count and the Lambda's recipients all go
// through it, so the number an editor sees is the number that is mailed.
const { audienceQuery, normalizeFilters, describeFilters, UUID_RE, DIRECTORY_ROWS_SQL } = require('./audience');

const DDL = [
  `CREATE TABLE IF NOT EXISTS mailing_lists (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    filters TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'dynamic',
    frozen_at TIMESTAMPTZ,
    frozen_count INTEGER,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS mailing_list_members (
    list_id UUID NOT NULL,
    email TEXT NOT NULL,
    added_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (list_id, email)
  )`,
  // 2026-10-10: 'snapshot' (NULL = snapshot, rows from before the column) | 'manual'
  `ALTER TABLE mailing_list_members ADD COLUMN IF NOT EXISTS source TEXT`,
];
const SNAPSHOT_SQL = `COALESCE(source, 'snapshot') = 'snapshot'`;

const MODES = ['dynamic', 'frozen'];
const NAME_MAX = 120;
const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// The list's own filters never point at another list.
const ownFilters = (raw) => ({ ...normalizeFilters(raw), list: '' });

const COLS = `id, name, filters, mode, frozen_at::text AS frozen_at, frozen_count, created_by,
  created_at::text AS created_at, updated_at::text AS updated_at`;

const rowToList = (r) => ({
  id: r.id, name: r.name || '', filters: ownFilters(parseJson(r.filters, {})), mode: MODES.includes(r.mode) ? r.mode : 'dynamic',
  frozenAt: r.frozen_at || '', frozenCount: r.frozen_count ?? null, createdBy: r.created_by || '',
  createdAt: r.created_at, updatedAt: r.updated_at,
});

async function listLists(client) {
  const res = await client.query(`SELECT ${COLS} FROM mailing_lists ORDER BY lower(name), created_at`);
  return res.rows.map(rowToList);
}

async function getList(client, id) {
  if (!UUID_RE.test(String(id))) return null;
  const res = await client.query(`SELECT ${COLS} FROM mailing_lists WHERE id = $1`, [String(id).toLowerCase()]);
  return res.rows[0] ? rowToList(res.rows[0]) : null;
}

// createList(client, { name, filters, mode, createdBy }) → the new list (not
// yet frozen — the caller freezes a 'frozen' list right after, in the same
// transaction).
async function createList(client, { name, filters, mode, createdBy }) {
  const res = await client.query(
    `INSERT INTO mailing_lists (id, name, filters, mode, created_by) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING ${COLS}`,
    [String(name || '').trim().slice(0, NAME_MAX), JSON.stringify(ownFilters(filters)), MODES.includes(mode) ? mode : 'dynamic', createdBy || null]);
  return rowToList(res.rows[0]);
}

// updateList(client, { id, name, filters, mode }) → true. Any field omitted
// stays. Switching mode is the caller's job to follow up: → frozen needs a
// freeze; → dynamic clears the snapshot (clearSnapshot).
async function updateList(client, { id, name, filters, mode }) {
  const res = await client.query(
    `UPDATE mailing_lists SET name = COALESCE($2, name), filters = COALESCE($3, filters), mode = COALESCE($4, mode), updated_at = now() WHERE id = $1`,
    [id, name == null ? null : String(name).trim().slice(0, NAME_MAX), filters == null ? null : JSON.stringify(ownFilters(filters)), MODES.includes(mode) ? mode : null]);
  return res.rowCount === 1;
}

// freezeList(client, id, filters) → count (snapshot + manual). Replaces the
// SNAPSHOT rows with everyone the filters match NOW (the audience rules
// included — only people who could be mailed today are captured); people
// added by hand stay.
async function freezeList(client, id, filters) {
  await client.query(`DELETE FROM mailing_list_members WHERE list_id = $1 AND ${SNAPSHOT_SQL}`, [id]);
  const { sql, params } = audienceQuery(ownFilters(filters), { columns: 'a.email', orderBy: null });
  await client.query(
    `INSERT INTO mailing_list_members (list_id, email, source) SELECT $${params.length + 1}::uuid, q.email, 'snapshot' FROM (${sql}) q WHERE q.email IS NOT NULL ON CONFLICT DO NOTHING`,
    [...params, id]);
  const count = (await client.query(`SELECT count(*)::int AS n FROM mailing_list_members WHERE list_id = $1`, [id])).rows[0].n;
  await client.query(`UPDATE mailing_lists SET frozen_at = now(), frozen_count = $2, updated_at = now() WHERE id = $1`, [id, count]);
  return count;
}

// clearSnapshot: → dynamic. The snapshot goes; people added by hand stay.
async function clearSnapshot(client, id) {
  await client.query(`DELETE FROM mailing_list_members WHERE list_id = $1 AND ${SNAPSHOT_SQL}`, [id]);
  await client.query(`UPDATE mailing_lists SET frozen_at = NULL, frozen_count = NULL, updated_at = now() WHERE id = $1`, [id]);
}

// addMembers(client, id, emails) → how many are now on the list by hand
// (an address already in the snapshot becomes 'manual' so an Update keeps it).
async function addMembers(client, id, emails) {
  let n = 0;
  for (const email of new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter((e) => e.includes('@')))) {
    const res = await client.query(
      `INSERT INTO mailing_list_members (list_id, email, source) VALUES ($1, $2, 'manual')
       ON CONFLICT (list_id, email) DO UPDATE SET source = 'manual'`, [id, email]);
    n += res.rowCount;
  }
  return n;
}

async function removeMember(client, id, email) {
  const res = await client.query(`DELETE FROM mailing_list_members WHERE list_id = $1 AND email = $2`, [id, String(email || '').trim().toLowerCase()]);
  return res.rowCount === 1;
}

// manualMembers(client, id) → [{ email, addedAt, firstName, lastName, status }]
// status = the directory status ('subscribed' = will be mailed), or '' when
// the address is not on the mailing list at all.
async function manualMembers(client, id) {
  const res = await client.query(
    `SELECT lm.email, lm.added_at::text AS added_at, a.first_name, a.last_name, a.status
     FROM mailing_list_members lm LEFT JOIN (${DIRECTORY_ROWS_SQL}) a ON a.email = lm.email
     WHERE lm.list_id = $1 AND lm.source = 'manual' ORDER BY lm.added_at, lm.email`, [id]);
  return res.rows.map((r) => ({ email: r.email, addedAt: r.added_at || '', firstName: r.first_name || '', lastName: r.last_name || '', status: r.status || '' }));
}

async function deleteList(client, id) {
  await client.query(`DELETE FROM mailing_list_members WHERE list_id = $1`, [id]);
  const res = await client.query(`DELETE FROM mailing_lists WHERE id = $1`, [id]);
  return res.rowCount === 1;
}

// newslettersUsing(client, id) → [{ id, subject, status }] — every newsletter
// whose audience names this list (a pending/approved/sending one blocks a
// delete; drafts and sent ones are reported so the deleter knows).
async function newslettersUsing(client, id) {
  const res = await client.query(
    `SELECT id, subject, status FROM newsletters WHERE audience LIKE $1 ORDER BY created_at DESC`, [`%"list":"${String(id).toLowerCase()}"%`]);
  return res.rows.map((r) => ({ id: r.id, subject: r.subject || '', status: r.status }));
}

// listQuery(list, opts) → { sql, params }: the recipients of a saved list —
// frozen: the members table (snapshot + by hand); dynamic: the filters OR the
// people added by hand. Eligibility rules apply to both.
function listQuery(list, opts = {}) {
  return list.mode === 'frozen' ? audienceQuery({}, { ...opts, memberOf: list.id }) : audienceQuery(list.filters, { ...opts, orManualOf: list.id });
}

// describeList(list) → 'Dormant (frozen 2026-10-09, 412 people)' | 'Dormant (dynamic: never received a newsletter)'
function describeList(list) {
  if (list.mode === 'frozen') return `${list.name} (frozen ${String(list.frozenAt || '').slice(0, 10)}, ${list.frozenCount ?? 0} people)`;
  return `${list.name} (dynamic: ${describeFilters(list.filters)})`;
}

// audienceFor(client, audience, opts) → { sql, params, description, list } |
// null when the audience names a saved list that no longer exists. The ONE
// resolver (see the header). opts are audienceQuery's.
async function audienceFor(client, audience, opts = {}) {
  const f = normalizeFilters(audience || {});
  if (f.list) {
    const list = await getList(client, f.list);
    if (!list) return null;
    return { ...listQuery(list, opts), description: `saved list ${describeList(list)}`, list };
  }
  return { ...audienceQuery(f, opts), description: describeFilters(f), list: null };
}

module.exports = {
  DDL, MODES, NAME_MAX, rowToList, listLists, getList, createList, updateList, freezeList, clearSnapshot, deleteList,
  addMembers, removeMember, manualMembers, newslettersUsing, listQuery, describeList, audienceFor,
};
