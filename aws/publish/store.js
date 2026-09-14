'use strict';
// publish_runs persistence (DSQL) + the publish mutex. Split from core.js so
// tests can inject an in-memory store and so the reconciler shares the exact
// same row semantics.
//
// Run lifecycle (the reconciler depends on this):
//   'publishing' row (with the intended manifest) is inserted BEFORE any S3
//   mutation; it flips to 'succeeded'/'noop'/'failed' when the run ends.
//   A crash leaves a 'publishing' row — the reconciler treats a fresh one as
//   "stand down" and a stale one as an abandoned publish to roll back.
//   'refused' rows record a run that lost the mutex (visible in the admin).
//   Failures BEFORE the S3 phase (render errors, bulk-delete refusal) are
//   recorded as 'failed' rows too — an async-invoked Lambda has no other way
//   to surface them.
//
// Mutex: ONE row in publish_lock. acquireLock is a conditional UPDATE that
// DSQL's optimistic concurrency serializes — two Lambdas racing get exactly
// one winner (the loser's 40001 retry sees run_id set and gets 0 rows). A
// lock older than STALE_LOCK_MINUTES is a crashed run and may be taken over.
const { withConnection, withRetry } = require('@uccsite/db');

const STALE_LOCK_MINUTES = 30; // > the publish Lambda's 10-minute timeout

const DDL = [
  `CREATE TABLE IF NOT EXISTS publish_runs (
    id UUID PRIMARY KEY,
    trigger_source TEXT NOT NULL,
    status TEXT NOT NULL,
    changed_paths TEXT,
    manifest TEXT,
    invalidation_id TEXT,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_publish_runs_started ON publish_runs(started_at)`,
  `CREATE TABLE IF NOT EXISTS publish_lock (
    id TEXT PRIMARY KEY,
    run_id UUID,
    started_at TIMESTAMPTZ
  )`,
];
const SEED_LOCK = `INSERT INTO publish_lock (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING`;

// makeDsqlStore({ endpoint, region }) → store
// Store contract: ensureSchema(), acquireLock(runId) → bool, releaseLock(runId),
// startRun({runId,trigger,manifest,startedAt}),
// finishRun({runId,status,changed,invalidationId,error}), latestState().
function makeDsqlStore(dbConfig) {
  let ensured = false;
  const run = (fn) => withRetry(() => withConnection(dbConfig, fn));

  return {
    async ensureSchema() {
      if (ensured) return;
      for (const ddl of DDL) await run((c) => c.query(ddl)); // one DDL per transaction (DSQL)
      await run((c) => c.query(SEED_LOCK));
      ensured = true;
    },
    async acquireLock(runId) {
      await this.ensureSchema();
      const res = await run((c) => c.query(
        `UPDATE publish_lock SET run_id = $1, started_at = now()
         WHERE id = 'singleton'
           AND (run_id IS NULL OR started_at < now() - interval '${STALE_LOCK_MINUTES} minutes')`,
        [runId]));
      return res.rowCount === 1;
    },
    async releaseLock(runId) {
      await run((c) => c.query(
        `UPDATE publish_lock SET run_id = NULL, started_at = NULL WHERE id = 'singleton' AND run_id = $1`,
        [runId]));
    },
    async startRun({ runId, trigger, manifest, startedAt }) {
      await this.ensureSchema();
      await run((c) => c.query(
        `INSERT INTO publish_runs (id, trigger_source, status, manifest, started_at)
         VALUES ($1, $2, 'publishing', $3, $4)`,
        [runId, trigger, manifest ? JSON.stringify(manifest) : null, startedAt],
      ));
    },
    // annotateRun(runId, note) — a post-publish problem (redirect sync) on an
    // otherwise successful run; the dashboard shows the error column.
    async annotateRun({ runId, note }) {
      await run((c) => c.query(`UPDATE publish_runs SET error = $2 WHERE id = $1`, [runId, note]));
    },
    async finishRun({ runId, status, changed = [], invalidationId = null, error = null }) {
      await run((c) => c.query(
        `UPDATE publish_runs
         SET status = $2, changed_paths = $3, invalidation_id = $4, error = $5, finished_at = now()
         WHERE id = $1`,
        [runId, status, JSON.stringify(changed), invalidationId, error],
      ));
    },
    // latest: the newest run still marked 'publishing' if any (fresh = in
    // flight, stale = abandoned), else the newest run of any status — so a
    // run that finished later can no longer hide an unfinished one.
    // good: the latest GOOD manifest = expected live state.
    async latestState() {
      await this.ensureSchema();
      return run(async (c) => {
        const inFlight = await c.query(
          `SELECT id, status, started_at FROM publish_runs WHERE status = 'publishing'
           ORDER BY started_at DESC LIMIT 1`);
        const latest = inFlight.rows[0]
          ? inFlight
          : await c.query(`SELECT id, status, started_at FROM publish_runs ORDER BY started_at DESC LIMIT 1`);
        const good = await c.query(
          `SELECT id, manifest FROM publish_runs
           WHERE status IN ('succeeded', 'noop') AND manifest IS NOT NULL
           ORDER BY started_at DESC LIMIT 1`);
        return {
          latest: latest.rows[0] || null,
          good: good.rows[0] ? { runId: good.rows[0].id, manifest: JSON.parse(good.rows[0].manifest) } : null,
        };
      });
    },
  };
}

// In-memory store with the same contract — tests, and callers without a DB.
function makeMemoryStore() {
  const rows = [];
  const lock = { runId: null, startedAt: null };
  return {
    rows,
    lock,
    async ensureSchema() {},
    async acquireLock(runId) {
      const stale = lock.startedAt && Date.now() - lock.startedAt > STALE_LOCK_MINUTES * 60_000;
      if (lock.runId && !stale) return false;
      lock.runId = runId;
      lock.startedAt = Date.now();
      return true;
    },
    async releaseLock(runId) {
      if (lock.runId === runId) { lock.runId = null; lock.startedAt = null; }
    },
    async startRun(row) { rows.push({ ...row, status: 'publishing' }); },
    async finishRun({ runId, ...rest }) {
      const row = rows.find(r => r.runId === runId);
      if (row) Object.assign(row, rest);
    },
    async annotateRun({ runId, note }) {
      const row = rows.find(r => r.runId === runId);
      if (row) row.error = note;
    },
    async latestState() {
      const inFlight = [...rows].reverse().find(r => r.status === 'publishing');
      const latest = inFlight || rows[rows.length - 1] || null;
      const good = [...rows].reverse().find(r => (r.status === 'succeeded' || r.status === 'noop') && r.manifest);
      return {
        latest: latest ? { id: latest.runId, status: latest.status, started_at: latest.startedAt } : null,
        good: good ? { runId: good.runId, manifest: good.manifest } : null,
      };
    },
  };
}

module.exports = { makeDsqlStore, makeMemoryStore, STALE_LOCK_MINUTES };
