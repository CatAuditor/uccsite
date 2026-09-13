'use strict';
// Publish pipeline core (build-spec-aws.md §7): render the whole site, hash
// every output, PUT + invalidate only what changed, poll the invalidation,
// read back and verify, record a publish_runs row. Fail-fast: any render error
// aborts before a single object is written — a partially-published site is
// never a valid state.
const { createHash } = require('crypto');
const { randomUUID } = require('crypto');
const {
  PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { CreateInvalidationCommand, GetInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const { withConnection } = require('@uccsite/db');

const WILDCARD_THRESHOLD = 15; // §7: >15 changed paths → one '/*' invalidation
const INVALIDATION_TIMEOUT_MS = 5 * 60 * 1000;
const INVALIDATION_POLL_MS = 5 * 1000;

// Pages revalidate at the browser on every request; CloudFront holds them
// until the publish invalidates. (Asset fingerprinting + immutable caching
// arrives in Phase 8 with the per-page CSS work.)
const CACHE_CONTROL = 'public, max-age=0, s-maxage=31536000, must-revalidate';

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript',
  mjs: 'application/javascript',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  md: 'text/markdown; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  woff2: 'font/woff2',
};

function contentTypeFor(key) {
  const ext = key.split('.').pop().toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const PUBLISH_RUNS_DDL = `CREATE TABLE IF NOT EXISTS publish_runs (
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

// publish({ outputs, s3, bucket, cf, distributionId, dbConfig, trigger, log })
//   outputs: Map<key, Buffer> — the COMPLETE site (rendered pages + static files)
// Returns { status, changed, removed, invalidationId, manifest }.
async function publish({ outputs, s3, bucket, cf, distributionId, dbConfig, trigger = 'manual', log = () => {} }) {
  const startedAt = new Date();
  const runId = randomUUID();
  const manifest = {};
  for (const [key, bytes] of outputs) manifest[key] = sha256(bytes);

  // ── Diff against live object metadata (self-healing: works from an empty
  // bucket, a drifted bucket, or a bucket seeded outside the pipeline).
  const liveHashes = new Map();
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const obj of page.Contents || []) liveHashes.set(obj.Key, null);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  for (const key of Object.keys(manifest)) {
    if (!liveHashes.has(key)) continue;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      liveHashes.set(key, head.Metadata?.sha256 || null);
    } catch { liveHashes.set(key, null); }
  }

  const changed = Object.keys(manifest).filter(key => liveHashes.get(key) !== manifest[key]);
  const removed = [...liveHashes.keys()].filter(key => !(key in manifest));

  if (!changed.length && !removed.length) {
    log('No changes — nothing to publish.');
    await recordRun(dbConfig, { runId, trigger, status: 'noop', changed, manifest, startedAt });
    return { status: 'noop', changed, removed, invalidationId: null, manifest };
  }

  // ── Write changed, delete removed ─────────────────────────────────────────
  for (const key of changed) {
    const bytes = outputs.get(key);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentTypeFor(key),
      CacheControl: CACHE_CONTROL,
      Metadata: { sha256: manifest[key] },
    }));
    log(`put ${key}`);
  }
  for (const key of removed) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    log(`deleted ${key}`);
  }

  // ── Invalidate ────────────────────────────────────────────────────────────
  const touched = [...changed, ...removed];
  // A page's public URL is its clean form; invalidate both spellings.
  const paths = new Set();
  for (const key of touched) {
    paths.add('/' + key);
    if (key.endsWith('.html')) {
      paths.add(key === 'index.html' ? '/' : '/' + key.slice(0, -5));
    }
  }
  const items = paths.size > WILDCARD_THRESHOLD ? ['/*'] : [...paths];
  const inv = await cf.send(new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: `publish-${runId}`,
      Paths: { Quantity: items.length, Items: items },
    },
  }));
  const invalidationId = inv.Invalidation.Id;
  log(`invalidation ${invalidationId} (${items.length} path${items.length === 1 ? '' : 's'})`);

  const deadline = Date.now() + INVALIDATION_TIMEOUT_MS;
  for (;;) {
    const got = await cf.send(new GetInvalidationCommand({ DistributionId: distributionId, Id: invalidationId }));
    if (got.Invalidation.Status === 'Completed') break;
    if (Date.now() > deadline) throw new Error(`Invalidation ${invalidationId} not Completed within 5 minutes`);
    await new Promise(r => setTimeout(r, INVALIDATION_POLL_MS));
  }
  log('invalidation completed');

  // ── Read back and verify (§7 step 9) ──────────────────────────────────────
  const mismatches = [];
  for (const key of changed) {
    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await streamToBuffer(got.Body);
    if (sha256(bytes) !== manifest[key]) mismatches.push(key);
  }
  const status = mismatches.length ? 'failed' : 'succeeded';
  const error = mismatches.length ? `verify mismatch: ${mismatches.join(', ')}` : null;

  await recordRun(dbConfig, { runId, trigger, status, changed: touched, manifest, invalidationId, error, startedAt });
  if (error) throw new Error(error);
  log(`publish ${status}: ${changed.length} changed, ${removed.length} removed`);
  return { status, changed, removed, invalidationId, manifest };
}

async function recordRun(dbConfig, { runId, trigger, status, changed, manifest, invalidationId = null, error = null, startedAt }) {
  if (!dbConfig) return; // tests may run without a database
  await withConnection(dbConfig, async (client) => {
    await client.query(PUBLISH_RUNS_DDL);
    await client.query(
      `INSERT INTO publish_runs (id, trigger_source, status, changed_paths, manifest, invalidation_id, error, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [runId, trigger, status, JSON.stringify(changed), JSON.stringify(manifest), invalidationId, error, startedAt],
    );
  });
}

// latestManifest(dbConfig) → { manifest, runId } | null — the reconciler's
// source of expected state.
async function latestManifest(dbConfig) {
  return withConnection(dbConfig, async (client) => {
    await client.query(PUBLISH_RUNS_DDL);
    const r = await client.query(
      `SELECT id, manifest FROM publish_runs WHERE status IN ('succeeded', 'noop') AND manifest IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`);
    if (!r.rows.length) return null;
    return { runId: r.rows[0].id, manifest: JSON.parse(r.rows[0].manifest) };
  });
}

module.exports = { publish, latestManifest, sha256, contentTypeFor, CACHE_CONTROL };
