'use strict';
// publish_runs persistence (DSQL). Split from core.js so tests can inject an
// in-memory store and so the reconciler shares the exact same row semantics.
//
// Run lifecycle (the reconciler depends on this):
//   'publishing' row (with the intended manifest) is inserted BEFORE any S3
//   mutation; it flips to 'succeeded'/'noop'/'failed' when the run ends.
//   A crash leaves a 'publishing' row — the reconciler treats a fresh one as
//   "stand down" and a stale one as an abandoned publish to roll back.
const { withConnection, withRetry } = require('@uccsite/db');

const DDL = `CREATE TABLE IF NOT EXISTS publish_runs (
  id UUID PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  changed_paths TEXT,
  manifest TEXT,
  invalidation_id TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
)`;

// makeDsqlStore({ endpoint, region }) → store
// Store contract: ensureSchema(), startRun({runId,trigger,manifest,startedAt}),
// finishRun({runId,status,changed,invalidationId,error}), latestState().
function makeDsqlStore(dbConfig) {
  let ensured = false;
  const run = (fn) => withRetry(() => withConnection(dbConfig, fn));

  return {
    async ensureSchema() {
      if (ensured) return;
      await run((c) => c.query(DDL)); // one DDL per transaction (DSQL)
      ensured = true;
    },
    async startRun({ runId, trigger, manifest, startedAt }) {
      await this.ensureSchema();
      await run((c) => c.query(
        `INSERT INTO publish_runs (id, trigger_source, status, manifest, started_at)
         VALUES ($1, $2, 'publishing', $3, $4)`,
        [runId, trigger, JSON.stringify(manifest), startedAt],
      ));
    },
    async finishRun({ runId, status, changed = [], invalidationId = null, error = null }) {
      await run((c) => c.query(
        `UPDATE publish_runs
         SET status = $2, changed_paths = $3, invalidation_id = $4, error = $5, finished_at = now()
         WHERE id = $1`,
        [runId, status, JSON.stringify(changed), invalidationId, error],
      ));
    },
    // Latest run of any status, plus the latest GOOD manifest. The reconciler
    // needs both: the former to detect in-flight/abandoned publishes, the
    // latter as expected state.
    async latestState() {
      await this.ensureSchema();
      return run(async (c) => {
        const latest = await c.query(
          `SELECT id, status, started_at FROM publish_runs ORDER BY started_at DESC LIMIT 1`);
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
  return {
    rows,
    async ensureSchema() {},
    async startRun(row) { rows.push({ ...row, status: 'publishing' }); },
    async finishRun({ runId, ...rest }) {
      const row = rows.find(r => r.runId === runId);
      if (row) Object.assign(row, rest);
    },
    async latestState() {
      const latest = rows[rows.length - 1] || null;
      const good = [...rows].reverse().find(r => (r.status === 'succeeded' || r.status === 'noop') && r.manifest);
      return {
        latest: latest ? { id: latest.runId, status: latest.status, started_at: latest.startedAt } : null,
        good: good ? { runId: good.runId, manifest: good.manifest } : null,
      };
    },
  };
}

module.exports = { makeDsqlStore, makeMemoryStore };
