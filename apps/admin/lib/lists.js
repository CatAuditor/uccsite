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
import { normalizeFilters, describeFilters } from '@uccsite/db/audience';
import { requireRole } from './auth';
import { withDb, withWriteTx, recordChange } from './data';

const UUID_RE = /^[0-9a-f-]{36}$/;
const assertId = (id) => { if (!UUID_RE.test(String(id))) throw new Error('Bad list id'); return String(id).toLowerCase(); };
const IN_FLIGHT = new Set(['pending', 'approved', 'sending']);

// filtersFrom(formData) → the list's own audience filters (never a list).
export function filtersFrom(fd) {
  return { ...normalizeFilters({ residency: fd.get('residency'), donors: fd.get('donors'), petition: fd.get('petition'), history: fd.get('history') }), list: '' };
}

// listsPage() → { lists: [{ ...list, count, description, inFlight }], petitions }
// count = what the list reaches NOW (a frozen list: its snapshot minus anyone
// no longer eligible), so a stale frozen list shows the drift.
export async function listsPage() {
  await requireRole('editor');
  return withDb(async (client) => {
    const rows = await db.listLists(client);
    const lists = [];
    for (const l of rows) {
      const q = db.listQuery(l, { columns: 'count(*)::int AS n', orderBy: null });
      const count = (await client.query(q.sql, q.params)).rows[0].n;
      const using = await db.newslettersUsing(client, l.id);
      lists.push({ ...l, count, description: describeFilters(l.filters), using, inFlight: using.some((n) => IN_FLIGHT.has(n.status)) });
    }
    const petitions = (await client.query('SELECT DISTINCT petition FROM petition_signatures ORDER BY petition')).rows.map((r) => r.petition);
    return { lists, petitions };
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
