// Shared server-side save path for list collections: role check, payload
// sanitation (strings only, trimmed, unknown keys dropped), wipe-and-load
// via replaceCollectionRows scoped to the spec's WHERE key when present,
// revision snapshot of the previous rows + audit row — all inside one
// connection.
import { createRequire } from 'node:module';
import { requireRole } from './auth';
import { withDb, recordChange } from './data';
import { COLLECTIONS } from './collections';

const require = createRequire(import.meta.url);
const { replaceCollectionRows, rowToObject, FIELD_MAPS } = require('@uccsite/db/content');

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

export async function loadCollectionItems(client, key) {
  const spec = COLLECTIONS[key];
  const where = spec.where ? `WHERE ${spec.where[0]} = $1` : '';
  const params = spec.where ? [spec.where[1]] : [];
  const res = await client.query(`SELECT * FROM ${spec.table} ${where} ORDER BY sort_order`, params);
  return res.rows.map(row => rowToObject(spec.table, row));
}

export async function saveCollection(key, formData) {
  const spec = COLLECTIONS[key];
  const session = await requireRole('editor');
  const items = sanitizeItems(spec.fields, formData.get('payload'));
  await withDb(async (client) => {
    const before = await loadCollectionItems(client, key);
    if (spec.where) {
      // Scoped wipe-and-load (e.g. one coverage strip): delete only this key's
      // rows, then insert with the scope column stamped.
      await client.query(`DELETE FROM ${spec.table} WHERE ${spec.where[0]} = $1`, [spec.where[1]]);
      const cols = Object.keys(FIELD_MAPS[spec.table]);
      for (let i = 0; i < items.length; i++) {
        const params = [spec.where[1], i, ...cols.map(c => items[i][FIELD_MAPS[spec.table][c]] ?? null)];
        await client.query(
          `INSERT INTO ${spec.table} (id, ${spec.where[0]}, sort_order, ${cols.join(', ')})
           VALUES (gen_random_uuid(), ${params.map((_, j) => `$${j + 1}`).join(', ')})`,
          params);
      }
    } else {
      await replaceCollectionRows(client, spec.table, items);
    }
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
