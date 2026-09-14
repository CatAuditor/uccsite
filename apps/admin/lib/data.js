// Admin data layer: DSQL access + the two cross-cutting writes every
// mutation makes — a revisions snapshot (last 20 per entity, the restore
// path) and an audit_log row (replaces Decap's git-history audit trail).
//
// Reads share one cached connection (makeCachedClient: warm reuse, 40001
// retry, error-drop). Writes open a FRESH connection (withWriteDb): the
// transactional wipe-and-load in replaceCollectionRows needs plain
// BEGIN/COMMIT semantics, not per-statement retry.
import { makeCachedClient, withConnection, withRetry } from '@uccsite/db';
import { config } from './config';
import { assertAwsAccount } from './aws-account';

let readClient = null;
function getReadClient() {
  readClient ??= makeCachedClient({ endpoint: config.dsqlEndpoint, region: config.region });
  return readClient;
}

export async function withDb(fn) {
  await assertAwsAccount();
  return fn(getReadClient());
}

export async function withWriteDb(fn) {
  await assertAwsAccount();
  return withConnection({ endpoint: config.dsqlEndpoint, region: config.region }, fn);
}

// withWriteTx(fn) — fn(client) runs inside ONE transaction on a fresh
// connection, replayed whole on a 40001 abort. Every admin save uses it so
// the mutation, its revision snapshot and its audit row commit together (a
// save can never land without its revision). Callees must pass tx: false to
// the packages/db helpers that would otherwise open their own transaction.
export function withWriteTx(fn) {
  return withWriteDb((client) => withRetry(async () => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }));
}

// Lost-update stamps. A form carries the stamp it was rendered with; the
// save re-reads it inside the transaction and refuses on mismatch. Every
// save re-inserts list rows (fresh updated_at) or bumps the singleton's
// updated_at, so any intervening save changes the stamp. count covers the
// empty-list case where MAX is NULL both before and after.
export async function collectionStamp(client, table, where) {
  const sql = `SELECT count(*)::text AS n, MAX(updated_at)::text AS newest FROM ${table}`
    + (where ? ` WHERE ${where[0]} = $1` : '');
  const r = (await client.query(sql, where ? [where[1]] : [])).rows[0];
  return `${r.n}:${r.newest || ''}`;
}
export async function singletonStamp(client, table) {
  const r = (await client.query(`SELECT updated_at::text AS u FROM ${table} WHERE id = 'singleton'`)).rows[0];
  return r?.u || '';
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

// inFlightPublish(client) → the freshest 'publishing' row younger than the
// abandonment grace, or null. Authoritative mutex is publish_lock in the
// Lambda; this only drives the dashboard's button state and polling.
export const IN_FLIGHT_GRACE_MS = 30 * 60 * 1000;
export async function inFlightPublish(client) {
  const res = await client.query(
    `SELECT id, started_at::text AS started_at FROM publish_runs
     WHERE status = 'publishing' AND started_at > now() - interval '30 minutes'
     ORDER BY started_at DESC LIMIT 1`);
  return res.rows[0] || null;
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
