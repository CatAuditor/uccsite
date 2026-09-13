'use strict';
// Publish pipeline core (build-spec-aws.md §7): render the whole site, hash
// every output, PUT + invalidate only what changed, poll the invalidation,
// read back and verify, record a publish_runs row. Fail-fast: any render error
// aborts before a single object is written — a partially-published site is
// never a valid state.
//
// Run lifecycle: a 'publishing' row with the intended manifest is written
// BEFORE the first S3 mutation and flipped to succeeded/noop/failed at the
// end. Every failure path records a 'failed' row; the reconciler stands down
// while a fresh 'publishing' row exists (see aws/reconcile-drift).
const { createHash, randomUUID } = require('node:crypto');
const {
  PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { CreateInvalidationCommand, GetInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const { makeDsqlStore } = require('./store');

const WILDCARD_THRESHOLD = 15; // §7: more paths than this → one '/*' invalidation
const INVALIDATION_TIMEOUT_MS = 5 * 60 * 1000;
const INVALIDATION_POLL_MS = 5 * 1000;
const HEAD_CONCURRENCY = 16;
const PUT_CONCURRENCY = 8;

// Refuse to delete more than this many keys unless the caller explicitly opts
// in — a swallowed fs error upstream must not empty the live bucket.
const MAX_REMOVED_WITHOUT_OPTIN = 5;

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

// Bounded-concurrency map preserving order of results.
async function pMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// The ONE place S3 keys become CloudFront invalidation paths — the publish
// pipeline and the drift reconciler both use it. Paths are URL-encoded
// (CloudFront requires it; a Decap upload like "Weber County Report.pdf"
// otherwise breaks or silently misses). A page gets BOTH URL spellings —
// its key and its clean form (any <dir>/index.html also covers /<dir>) —
// because the cache key depends on the viewer-function rewrite and covering
// both is cheap under the wildcard collapse.
function invalidationPaths(keys) {
  const paths = new Set();
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  for (const key of keys) {
    paths.add('/' + enc(key));
    if (key === 'index.html') paths.add('/');
    else if (key.endsWith('/index.html')) paths.add('/' + enc(key.slice(0, -'/index.html'.length)));
    else if (key.endsWith('.html')) paths.add('/' + enc(key.slice(0, -5)));
  }
  return paths.size > WILDCARD_THRESHOLD ? ['/*'] : [...paths];
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function headHash(s3, bucket, key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.Metadata?.sha256 || null;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return null;
    throw err;
  }
}

async function listKeys(s3, bucket) {
  const keys = new Set();
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const obj of page.Contents || []) keys.add(obj.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// publish({ outputs, s3, bucket, cf, distributionId, store?|dbConfig?, trigger,
//           allowBulkDelete?, log? })
//   outputs: Map<key, Buffer> — the COMPLETE site (rendered pages + static files)
// Returns { status, changed, removed, invalidationId, manifest }.
async function publish(opts) {
  const {
    outputs, s3, bucket, cf, distributionId,
    trigger = 'manual', allowBulkDelete = false,
  } = opts;
  const log = (m) => (opts.log || (() => {}))(`[publish] ${m}`);
  const store = opts.store || (opts.dbConfig ? makeDsqlStore(opts.dbConfig) : null);

  // runId/startedAt may come from the caller (the Lambda acquires the mutex
  // under the same id before rendering) — see aws/publish/handler.mjs.
  const startedAt = opts.startedAt || new Date();
  const runId = opts.runId || randomUUID();
  const manifest = {};
  for (const [key, bytes] of outputs) manifest[key] = sha256(bytes);

  // Failures BEFORE the S3 phase still get a 'failed' row: an async-invoked
  // Lambda has no return value to surface them through, and "the dashboard
  // shows nothing" is not a failure state (§7).
  const recordEarlyFailure = async (err) => {
    if (!store) return;
    try {
      await store.startRun({ runId, trigger, manifest, startedAt });
      await store.finishRun({ runId, status: 'failed', error: String(err && err.message || err) });
    } catch (dbErr) {
      log(`WARNING: could not record early failure: ${dbErr.message}`);
    }
  };

  let changed, removed;
  try {
    if (!Object.keys(manifest).length) throw new Error('Refusing to publish an empty outputs set.');

    // ── Diff against live state ─────────────────────────────────────────────
    const liveKeys = await listKeys(s3, bucket);
    const manifestKeys = Object.keys(manifest);
    const liveHashes = await pMap(
      manifestKeys,
      async (key) => (liveKeys.has(key) ? headHash(s3, bucket, key) : null),
      HEAD_CONCURRENCY,
    );
    changed = manifestKeys.filter((key, i) => liveHashes[i] !== manifest[key]);
    removed = [...liveKeys].filter(key => !(key in manifest));

    if (removed.length > MAX_REMOVED_WITHOUT_OPTIN && !allowBulkDelete) {
      throw new Error(
        `Refusing to delete ${removed.length} live objects (${removed.slice(0, 5).join(', ')}…). `
        + 'If this is intentional, re-run with allowBulkDelete/--allow-bulk-delete. '
        + 'A missing input directory produces exactly this signature.');
    }
  } catch (err) {
    await recordEarlyFailure(err);
    throw err;
  }

  if (!changed.length && !removed.length) {
    log('no changes — nothing to publish');
    if (store) {
      await store.startRun({ runId, trigger, manifest, startedAt });
      await store.finishRun({ runId, status: 'noop' });
    }
    return { status: 'noop', changed, removed, invalidationId: null, manifest };
  }

  // Record intent BEFORE mutating S3 — the reconciler stands down on a fresh
  // 'publishing' row, and a crash leaves an audit trail instead of silence.
  if (store) await store.startRun({ runId, trigger, manifest, startedAt });

  let invalidationId = null;
  try {
    // ── Write changed, delete removed ───────────────────────────────────────
    await pMap(changed, async (key) => {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: outputs.get(key),
        ContentType: contentTypeFor(key),
        CacheControl: CACHE_CONTROL,
        Metadata: { sha256: manifest[key] },
      }));
      log(`put ${key}`);
    }, PUT_CONCURRENCY);

    for (let i = 0; i < removed.length; i += 1000) {
      const batch = removed.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      }));
      for (const key of batch) log(`deleted ${key}`);
    }

    // ── Invalidate, verify concurrently (verify reads S3, not the edge) ─────
    const items = invalidationPaths([...changed, ...removed]);
    const inv = await cf.send(new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `publish-${runId}`,
        Paths: { Quantity: items.length, Items: items },
      },
    }));
    invalidationId = inv.Invalidation.Id;
    log(`invalidation ${invalidationId} (${items.length} path${items.length === 1 ? '' : 's'})`);

    const pollInvalidation = async () => {
      const deadline = Date.now() + INVALIDATION_TIMEOUT_MS;
      for (;;) {
        const got = await cf.send(new GetInvalidationCommand({ DistributionId: distributionId, Id: invalidationId }));
        if (got.Invalidation.Status === 'Completed') return;
        if (Date.now() > deadline) throw new Error(`Invalidation ${invalidationId} not Completed within 5 minutes`);
        await new Promise(r => setTimeout(r, INVALIDATION_POLL_MS));
      }
    };
    const verifyAll = async () => {
      const mismatched = await pMap(changed, async (key) => {
        const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await streamToBuffer(got.Body);
        return sha256(bytes) !== manifest[key] ? key : null;
      }, PUT_CONCURRENCY);
      const bad = mismatched.filter(Boolean);
      if (bad.length) throw new Error(`verify mismatch: ${bad.join(', ')}`);
    };
    await Promise.all([pollInvalidation(), verifyAll()]);
    log('invalidation completed, read-back verified');

    if (store) await store.finishRun({ runId, status: 'succeeded', changed: [...changed, ...removed], invalidationId });
    log(`succeeded: ${changed.length} changed, ${removed.length} removed`);
    return { status: 'succeeded', changed, removed, invalidationId, manifest };
  } catch (err) {
    // Best-effort failure record — the reconciler needs to know this run died.
    if (store) {
      try {
        await store.finishRun({ runId, status: 'failed', changed: [...changed, ...removed], invalidationId, error: String(err && err.message || err) });
      } catch (dbErr) {
        log(`WARNING: could not record failed run: ${dbErr.message}`);
      }
    }
    throw err;
  }
}

module.exports = {
  publish, invalidationPaths, sha256, contentTypeFor, listKeys, headHash, pMap,
  CACHE_CONTROL, WILDCARD_THRESHOLD,
};
