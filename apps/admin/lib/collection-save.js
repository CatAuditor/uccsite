// Shared server-side save path for list collections: role check, payload
// sanitation (strings only, trimmed, unknown keys dropped), atomic
// wipe-and-load via replaceCollectionRows (scoped by the spec's where key),
// revision snapshot of the previous rows + audit row — one fresh connection.
import { list, replaceCollectionRows } from '@uccsite/db/content';
import { requireRole } from './auth';
import { withWriteDb, recordChange } from './data';
import { COLLECTIONS } from './collections';

export function sanitizeItems(fields, payload) {
  let parsed;
  try { parsed = JSON.parse(payload); } catch { throw new Error('Bad payload'); }
  if (!Array.isArray(parsed)) throw new Error('Bad payload');
  return parsed.map((item) => Object.fromEntries(
    fields.map(f => {
      const v = item?.[f.name];
      const s = (typeof v === 'string' ? v : '').trim();
      return [f.name, s];
    }).filter(([, v]) => v !== ''),
  ));
}

export function loadCollectionItems(client, key) {
  const spec = COLLECTIONS[key];
  const where = spec.where ? `WHERE ${spec.where[0]} = $1` : '';
  const params = spec.where ? [spec.where[1]] : [];
  return list(client, spec.table, where, params);
}

export async function saveCollection(key, formData) {
  const spec = COLLECTIONS[key];
  const session = await requireRole('editor');
  const items = sanitizeItems(spec.fields, formData.get('payload'));
  await withWriteDb(async (client) => {
    const before = await loadCollectionItems(client, key);
    await replaceCollectionRows(client, spec.table, items, { where: spec.where });
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
