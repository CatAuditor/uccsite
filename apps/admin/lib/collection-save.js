// Shared server-side save path for list collections: role check, payload
// sanitation (strings only, trimmed, unknown keys dropped), lost-update
// check against the baseline stamp the form was rendered with, alt-text
// gate, then ONE transaction holding the wipe-and-load AND the revision
// snapshot + audit row (recordChange) — a 40001 retry replays all of it, so
// a save can never land without its revision.
import { list, replaceCollectionRows, loadProjects, replaceProjects } from '@uccsite/db/content';
import { assetIdFromPath } from '@uccsite/db/media';
import { requireRole } from './auth';
import { withWriteTx, recordChange, collectionStamp } from './data';
import { COLLECTIONS } from './collections';
import { assertAltText } from './media';

export const CONFLICT_MESSAGE = 'Someone else saved this since you opened it. Copy your changes, reload, and re-apply them.';

// sanitizeItems(fields, payload | array) → items with only the declared
// fields, trimmed strings, empty values dropped; widget 'list' fields
// recurse (nested child lists are always present as arrays).
// keepIds: a nested (projects) payload carries each row's id so the save can
// tell a renamed project from a new one (replaceProjects keeps ids —
// docs/decisions/project-tree-nested-urls.md). Only a well-formed UUID passes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function sanitizeItems(fields, payload, { keepIds = false } = {}) {
  let parsed = payload;
  if (typeof payload === 'string') {
    try { parsed = JSON.parse(payload); } catch { throw new Error('Bad payload'); }
  }
  if (!Array.isArray(parsed)) throw new Error('Bad payload');
  if (parsed.length > 2000) throw new Error('Too many items');
  return parsed.map((item) => Object.fromEntries([
    ...(keepIds && typeof item?.id === 'string' && UUID_RE.test(item.id) ? [['id', item.id]] : []),
    ...fields.map(f => {
      const v = item?.[f.name];
      if (f.widget === 'list') return [f.name, sanitizeItems(f.fields, Array.isArray(v) ? v : [])];
      const s = (typeof v === 'string' ? v : '').trim();
      return [f.name, s];
    }).filter(([, v]) => v !== ''),
  // An entry with no text at all (a forgotten "+ Add") would publish as an
  // empty card — drop it instead of storing an all-NULL row.
  ])).filter(o => Object.entries(o).some(([k, v]) => k !== 'id' && !Array.isArray(v)));
}

export function loadCollectionItems(client, key) {
  const spec = COLLECTIONS[key];
  if (spec.nested) return loadProjects(client, { ids: true }); // the one nested collection; ids ride in the form
  const where = spec.where ? `WHERE ${spec.where[0]} = $1` : '';
  const params = spec.where ? [spec.where[1]] : [];
  return list(client, spec.table, where, params);
}

// loadCollectionBaseline(client, key) → the stamp the form carries back.
export function loadCollectionBaseline(client, key) {
  const spec = COLLECTIONS[key];
  return collectionStamp(client, spec.table, spec.where);
}

// mediaAssetIds(spec, items) → asset ids referenced by media-widget fields.
export function mediaAssetIds(spec, items) {
  const mediaFields = spec.fields.filter(f => f.widget === 'media').map(f => f.name);
  return [...new Set(items.flatMap(it => mediaFields.map(f => assetIdFromPath(it[f])).filter(Boolean)))];
}

export async function saveCollection(key, formData) {
  const spec = COLLECTIONS[key];
  const session = await requireRole('editor');
  const items = sanitizeItems(spec.fields, formData.get('payload'), { keepIds: Boolean(spec.nested) });
  const baseline = String(formData.get('baseline') ?? '');
  const mediaIds = mediaAssetIds(spec, items);
  await withWriteTx(async (client) => {
    const current = await collectionStamp(client, spec.table, spec.where);
    if (baseline && current !== baseline) throw new Error(CONFLICT_MESSAGE);
    // Alt-text gate (spec §13): the picker only offers alt'd assets, but a
    // typed path or an alt wiped after picking must not slip through.
    await assertAltText(client, mediaIds);
    const before = await loadCollectionItems(client, key);
    if (spec.nested) await replaceProjects(client, items, { tx: false });
    else await replaceCollectionRows(client, spec.table, items, { where: spec.where, tx: false });
    await recordChange(client, {
      actor: session.email,
      action: `${key}.save`,
      entityType: key,
      entityId: 'collection',
      snapshot: before,
      diff: { count: { before: before.length, after: items.length } },
    });
  });
}
