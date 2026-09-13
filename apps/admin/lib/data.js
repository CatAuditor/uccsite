// Admin data layer: DSQL access + the two cross-cutting writes every
// mutation makes — a revisions snapshot (last 20 per entity, the restore
// path) and an audit_log row (replaces Decap's git-history audit trail).
//
// Reads share one cached connection (makeCachedClient: warm reuse, 40001
// retry, error-drop). Writes open a FRESH connection (withWriteDb): the
// transactional wipe-and-load in replaceCollectionRows needs plain
// BEGIN/COMMIT semantics, not per-statement retry.
import { makeCachedClient, withConnection } from '@uccsite/db';
import { config } from './config';

let readClient = null;
function getReadClient() {
  readClient ??= makeCachedClient({ endpoint: config.dsqlEndpoint, region: config.region });
  return readClient;
}

export function withDb(fn) {
  return fn(getReadClient());
}

export function withWriteDb(fn) {
  return withConnection({ endpoint: config.dsqlEndpoint, region: config.region }, fn);
}

// recordChange(client, { actor, action, entityType, entityId, snapshot, diff })
// Call INSIDE the same withWriteDb as the mutation so bookkeeping can't be lost.
export async function recordChange(client, { actor, action, entityType, entityId, snapshot, diff }) {
  if (snapshot !== undefined) {
    await client.query(
      `INSERT INTO revisions (id, entity_type, entity_id, snapshot, author)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [entityType, String(entityId), JSON.stringify(snapshot), actor]);
    // Keep the last 20 revisions per entity (spec §9).
    await client.query(
      `DELETE FROM revisions WHERE entity_type = $1 AND entity_id = $2 AND id NOT IN (
         SELECT id FROM revisions WHERE entity_type = $1 AND entity_id = $2
         ORDER BY created_at DESC LIMIT 20)`,
      [entityType, String(entityId)]);
  }
  await client.query(
    `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [actor, action, entityType ?? null, entityId != null ? String(entityId) : null, diff ? JSON.stringify(diff) : null]);
  console.log(`[admin] ${actor} ${action}${entityType ? ` ${entityType}/${entityId}` : ''}`);
}

// latestPublishRuns(client, limit) → recent rows for the dashboard.
export async function latestPublishRuns(client, limit = 10) {
  const res = await client.query(
    `SELECT id, trigger_source, status, changed_paths, invalidation_id, error,
            started_at::text AS started_at, finished_at::text AS finished_at
     FROM publish_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
  return res.rows.map(r => ({
    ...r,
    changed: r.changed_paths ? JSON.parse(r.changed_paths).length : 0,
  }));
}
