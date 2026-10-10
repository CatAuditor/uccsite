// Saved mailing lists — every rule (docs/systems/newsletters.md "Saved
// lists"). Editor+ throughout (the Mailing list page is editor+ too: a list
// is a view of the same PII). Each action is one transaction with its audit
// row, `list.<verb>`, entityType 'mailing_list' — a prefix CONTENT_ACTION_RE
// ignores, so list work never counts as an unpublished site save.
//
//   dynamic  filters re-run at every use (send, count, CSV)
//   frozen   the snapshot taken at the last freeze; "Update" re-freezes
// Switching to frozen freezes right away; switching to dynamic drops the
// snapshot. A list named by a newsletter that is pending / approved /
// sending cannot be deleted or re-frozen (the reviewer approved a number).
import * as db from '@uccsite/db/lists';
import { normalizeFilters, describeFilters, FILTER_KEYS, DIRECTORY_ROWS_SQL } from '@uccsite/db/audience';
import { requireRole } from './auth';
import { withDb, withWriteTx, recordChange } from './data';

const UUID_RE = /^[0-9a-f-]{36}$/;
const assertId = (id) => { if (!UUID_RE.test(String(id))) throw new Error('Bad list id'); return String(id).toLowerCase(); };
const IN_FLIGHT = new Set(['pending', 'approved', 'sending']);

// filtersFrom(formData) → the list's own audience filters (never a list).
// Reads every FILTER_KEY, so a new filter needs no change here.
export function filtersFrom(fd) {
  const raw = {};
  for (const k of FILTER_KEYS) raw[k] = fd.get(k) ?? '';
  return { ...normalizeFilters(raw), list: '' };
}

// listsPage() → { lists: [{ ...list, count, description, using, inFlight, manual }], petitions }
// count = what the list reaches NOW (a frozen list: its members minus anyone
// no longer eligible), so a stale frozen list shows the drift. manual = the
// people added by hand, each with their mailing-list status.
export async function listsPage() {
  await requireRole('editor');
  return withDb(async (client) => {
    const rows = await db.listLists(client);
    const lists = [];
    for (const l of rows) {
      const q = db.listQuery(l, { columns: 'count(*)::int AS n', orderBy: null });
      const count = (await client.query(q.sql, q.params)).rows[0].n;
      const using = await db.newslettersUsing(client, l.id);
      const manual = await db.manualMembers(client, l.id);
      lists.push({ ...l, count, description: describeFilters(l.filters), using, inFlight: using.some((n) => IN_FLIGHT.has(n.status)), manual });
    }
    const petitions = (await client.query('SELECT DISTINCT petition FROM petition_signatures ORDER BY petition')).rows.map((r) => r.petition);
    return { lists, petitions };
  });
}

// parsePeople(text) → [{ email, firstName, lastName }]: one person per line,
// "email", "email, First", "email, First, Last" or "email First Last"
// (commas, semicolons, tabs or spaces). Junk lines are dropped.
export function parsePeople(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(/[,;\t]+|\s+/).map((p) => p.trim()).filter(Boolean);
    const i = parts.findIndex((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
    if (i < 0) continue;
    const email = parts[i].toLowerCase().slice(0, 254);
    const names = parts.filter((_, j) => j !== i).map((p) => p.replace(/^["']|["']$/g, '')).slice(0, 4);
    if (!out.has(email)) out.set(email, { email, firstName: (names[0] || '').slice(0, 100), lastName: names.slice(1).join(' ').slice(0, 100) });
  }
  return [...out.values()];
}

// addPeople(id, formData) → { added, subscribed, notOnList, notMailable }.
// Adds the pasted addresses to the list by hand. Only eligible mailing-list
// rows are ever mailed, so the report says who will not be: `notOnList` (no
// subscribers/member row) and `notMailable` (unconfirmed / unsubscribed /
// bounced). With `subscribe=1` the unknown addresses are ALSO added to the
// mailing list as confirmed subscribers (consent given to the org in person
// or in writing — the editor is asserting that; audited `subscribers.add`
// per address). An existing unconfirmed or unsubscribed row is never
// touched — their own decision stands.
export async function addPeople(id, formData) {
  const s = await requireRole('editor');
  const lid = assertId(id);
  const people = parsePeople(formData.get('people'));
  if (!people.length) throw new Error('Paste at least one email address (one per line).');
  if (people.length > 500) throw new Error('At most 500 addresses at a time.');
  const subscribe = formData.get('subscribe') === '1';
  return withWriteTx(async (client) => {
    const list = await db.getList(client, lid);
    if (!list) throw new Error('That list no longer exists.');
    const emails = people.map((p) => p.email);
    const known = new Map((await client.query(`SELECT a.email, a.status FROM (${DIRECTORY_ROWS_SQL}) a WHERE a.email = ANY($1::text[])`, [emails])).rows.map((r) => [r.email, r.status]));
    const notOnList = people.filter((p) => !known.has(p.email));
    let subscribed = 0;
    if (subscribe) {
      for (const p of notOnList) {
        const r = await client.query(
          `INSERT INTO subscribers (id, email, first_name, last_name, confirmed_at) VALUES (gen_random_uuid(), $1, $2, $3, now()) ON CONFLICT (email) DO NOTHING`,
          [p.email, p.firstName || null, p.lastName || null]);
        if (r.rowCount === 1) {
          subscribed++;
          await recordChange(client, { actor: s.email, action: 'subscribers.add', entityType: 'subscriber', entityId: p.email, diff: { via: 'saved list', list: lid, named: Boolean(p.firstName) } });
        }
      }
    }
    const added = await db.addMembers(client, lid, emails);
    const notMailable = [...known].filter(([, st]) => st !== 'subscribed').map(([email, status]) => ({ email, status }));
    await recordChange(client, { actor: s.email, action: 'list.add', entityType: 'mailing_list', entityId: lid, diff: { added, subscribed, notOnList: subscribe ? 0 : notOnList.length, notMailable: notMailable.length } });
    console.log(`[lists] ${s.email} added ${added} to ${lid} (subscribed ${subscribed}, not on list ${subscribe ? 0 : notOnList.length}, not mailable ${notMailable.length})`);
    return { added, subscribed, notOnList: subscribe ? [] : notOnList.map((p) => p.email), notMailable };
  });
}

// addToList(id, email): the Mailing list page's per-row "Add to list".
export async function addToList(id, email) {
  const s = await requireRole('editor');
  const lid = assertId(id);
  const addr = String(email || '').trim().toLowerCase();
  if (!addr.includes('@')) throw new Error('Pick a person first.');
  return withWriteTx(async (client) => {
    const list = await db.getList(client, lid);
    if (!list) throw new Error('That list no longer exists.');
    await db.addMembers(client, lid, [addr]);
    await recordChange(client, { actor: s.email, action: 'list.add', entityType: 'mailing_list', entityId: lid, diff: { added: 1, from: 'mailing list page' } });
    console.log(`[lists] ${s.email} added 1 to ${lid} "${list.name}"`);
    return list;
  });
}

// removePerson(id, email): takes someone off a list (by-hand or snapshot
// row). They stay on the mailing list itself.
export async function removePerson(id, email) {
  const s = await requireRole('editor');
  const lid = assertId(id);
  await withWriteTx(async (client) => {
    if (!(await db.removeMember(client, lid, email))) throw new Error('They are not on this list.');
    await recordChange(client, { actor: s.email, action: 'list.remove', entityType: 'mailing_list', entityId: lid, diff: { removed: 1 } });
    console.log(`[lists] ${s.email} removed 1 from ${lid}`);
  });
}

// createList(formData) → the new list. A frozen list is frozen in the same
// transaction so it is never empty between create and first update.
export async function createList(formData) {
  const s = await requireRole('editor');
  const name = String(formData.get('name') || '').trim().slice(0, db.NAME_MAX);
  if (!name) throw new Error('Give the list a name.');
  const mode = formData.get('mode') === 'frozen' ? 'frozen' : 'dynamic';
  const filters = filtersFrom(formData);
  return withWriteTx(async (client) => {
    const list = await db.createList(client, { name, filters, mode, createdBy: s.email });
    const count = mode === 'frozen' ? await db.freezeList(client, list.id, filters) : null;
    await recordChange(client, { actor: s.email, action: 'list.create', entityType: 'mailing_list', entityId: list.id, diff: { name, mode, filters: describeFilters(filters), count } });
    console.log(`[lists] ${s.email} created ${list.id} "${name}" ${mode} ${describeFilters(filters)}${count == null ? '' : ` frozen=${count}`}`);
    return list;
  });
}

// saveList(id, formData): name + filters. A frozen list is NOT re-frozen by a
// save (its snapshot stays what the editor saw) — press Update for that.
export async function saveList(id, formData) {
  const s = await requireRole('editor');
  const lid = assertId(id);
  const name = String(formData.get('name') || '').trim().slice(0, db.NAME_MAX);
  if (!name) throw new Error('Give the list a name.');
  const filters = filtersFrom(formData);
  await withWriteTx(async (client) => {
    const list = await db.getList(client, lid);
    if (!list) throw new Error('That list no longer exists.');
    await db.updateList(client, { id: lid, name, filters });
    await recordChange(client, { actor: s.email, action: 'list.save', entityType: 'mailing_list', entityId: lid, diff: { name, filters: describeFilters(filters), from: { name: list.name, filters: describeFilters(list.filters) } } });
  });
}

// freezeList(id) → count. "Update" on a frozen list: the snapshot becomes
// whoever matches the filters now. Refused while a newsletter is in flight
// against it (the approved recipient count would silently change).
export async function freezeList(id) {
  const s = await requireRole('editor');
  const lid = assertId(id);
  return withWriteTx(async (client) => {
    const list = await db.getList(client, lid);
    if (!list) throw new Error('That list no longer exists.');
    if (list.mode !== 'frozen') throw new Error('Only a frozen list can be updated — a dynamic list always reflects the current filters.');
    await assertNotInFlight(client, lid);
    const count = await db.freezeList(client, lid, list.filters);
    await recordChange(client, { actor: s.email, action: 'list.freeze', entityType: 'mailing_list', entityId: lid, diff: { count, before: list.frozenCount, filters: describeFilters(list.filters) } });
    console.log(`[lists] ${s.email} froze ${lid} count=${count} (was ${list.frozenCount})`);
    return count;
  });
}

// setMode(id, mode) → count | null. → frozen snapshots now; → dynamic drops
// the snapshot. Refused while a newsletter is in flight against the list.
export async function setMode(id, mode) {
  const s = await requireRole('editor');
  const lid = assertId(id);
  if (!db.MODES.includes(mode)) throw new Error('Mode must be dynamic or frozen.');
  return withWriteTx(async (client) => {
    const list = await db.getList(client, lid);
    if (!list) throw new Error('That list no longer exists.');
    if (list.mode === mode) return list.frozenCount;
    await assertNotInFlight(client, lid);
    await db.updateList(client, { id: lid, mode });
    let count = null;
    if (mode === 'frozen') count = await db.freezeList(client, lid, list.filters);
    else await db.clearSnapshot(client, lid);
    await recordChange(client, { actor: s.email, action: 'list.mode', entityType: 'mailing_list', entityId: lid, diff: { from: list.mode, to: mode, count } });
    console.log(`[lists] ${s.email} ${lid} mode ${list.mode} -> ${mode}${count == null ? '' : ` frozen=${count}`}`);
    return count;
  });
}

export async function deleteList(id) {
  const s = await requireRole('editor');
  const lid = assertId(id);
  await withWriteTx(async (client) => {
    const list = await db.getList(client, lid);
    if (!list) throw new Error('Already deleted.');
    await assertNotInFlight(client, lid);
    await db.deleteList(client, lid);
    await recordChange(client, { actor: s.email, action: 'list.delete', entityType: 'mailing_list', entityId: lid, diff: { name: list.name, mode: list.mode, filters: describeFilters(list.filters) } });
    console.log(`[lists] ${s.email} deleted ${lid} "${list.name}"`);
  });
}

async function assertNotInFlight(client, lid) {
  const busy = (await db.newslettersUsing(client, lid)).filter((n) => IN_FLIGHT.has(n.status));
  if (busy.length) throw new Error(`"${busy[0].subject || 'An email'}" is ${busy[0].status} and goes to this list — wait for it to send (or withdraw it) first.`);
}
