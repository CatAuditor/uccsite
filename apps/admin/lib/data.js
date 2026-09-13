// Admin data layer: DSQL access + the two cross-cutting writes every
// mutation makes — a revisions snapshot (last 20 per entity, the restore
// path) and an audit_log row (replaces Decap's git-history audit trail).
import { createRequire } from 'node:module';
import { config } from './config';

const require = createRequire(import.meta.url);
const { withConnection } = require('@uccsite/db');

export function withDb(fn) {
  return withConnection({ endpoint: config.dsqlEndpoint, region: config.region }, fn);
}

// recordChange(client, { actor, action, entityType, entityId, snapshot, diff })
// Call INSIDE the same withDb as the mutation so bookkeeping can't be lost.
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
