// Drift reconciler (build-spec-aws.md §7): hourly, compares live S3 state
// against the last good publish manifest (publish_runs). Handles four cases:
//   - fresh 'publishing' run in flight  → stand down (never race a publish)
//   - abandoned 'publishing' run (>30m) → roll the partial write back to the
//     last good manifest (fail-fast: a partial site is never valid) + alert
//   - drifted/missing object            → restore from S3 version history,
//     invalidate, alert; unrepairable drift is a DISTINCT alert (no useless
//     invalidation, subject says the page is still wrong)
//   - object in the bucket but not in the manifest → alert (rogue write)
// Any handler failure publishes a failure alert and rethrows so the Lambda
// Errors metric/alarm fires — the reconciler must never fail silently.
import {
  S3Client, HeadObjectCommand, ListObjectVersionsCommand, CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { invalidationPaths, listKeys, headHash, pMap } from '@uccsite/publish';
import { makeDsqlStore } from '@uccsite/publish/store';

const { SITE_BUCKET, DISTRIBUTION_ID, DSQL_ENDPOINT, ALERT_TOPIC_ARN } = process.env;
const region = process.env.AWS_REGION;
const s3 = new S3Client({ region });
const cf = new CloudFrontClient({ region });
const sns = new SNSClient({ region });

const IN_FLIGHT_GRACE_MS = 30 * 60 * 1000;
const HEAD_CONCURRENCY = 16;

const log = (m) => console.log(`[reconcile] ${m}`);

async function alert(subject, payload) {
  if (!ALERT_TOPIC_ARN) return;
  await sns.send(new PublishCommand({
    TopicArn: ALERT_TOPIC_ARN,
    Subject: subject.slice(0, 99),
    Message: JSON.stringify(payload, null, 2),
  }));
}

// Find (paginated) the newest version of `key` whose sha256 metadata matches,
// and copy it back to the top. Returns the versionId or null.
async function restore(key, expectedHash) {
  let keyMarker, versionIdMarker;
  do {
    const page = await s3.send(new ListObjectVersionsCommand({
      Bucket: SITE_BUCKET, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker,
    }));
    const candidates = (page.Versions || []).filter(v => v.Key === key);
    const heads = await pMap(candidates, async (v) => {
      const head = await s3.send(new HeadObjectCommand({ Bucket: SITE_BUCKET, Key: key, VersionId: v.VersionId }));
      return head.Metadata?.sha256 === expectedHash ? v.VersionId : null;
    }, 8);
    const match = heads.find(Boolean);
    if (match) {
      await s3.send(new CopyObjectCommand({
        Bucket: SITE_BUCKET,
        Key: key,
        CopySource: encodeURIComponent(`${SITE_BUCKET}/${key}`) + `?versionId=${match}`,
        MetadataDirective: 'COPY',
      }));
      return match;
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker !== undefined || versionIdMarker !== undefined);
  return null;
}

async function reconcile() {
  const store = makeDsqlStore({ endpoint: DSQL_ENDPOINT, region });
  const { latest, good } = await store.latestState();

  if (latest?.status === 'publishing') {
    const age = Date.now() - new Date(latest.started_at).getTime();
    if (age < IN_FLIGHT_GRACE_MS) {
      log(`publish ${latest.id} in flight (${Math.round(age / 1000)}s) — standing down`);
      return { drift: 0, standDown: true };
    }
    log(`publish ${latest.id} abandoned (${Math.round(age / 60000)}m old) — rolling partial write back to last good manifest`);
    await alert('uccsite: abandoned publish being rolled back', { runId: latest.id, startedAt: latest.started_at });
    // Flip the row so the admin's Publish button unblocks and the history
    // shows what happened (a crashed Lambda never reaches finishRun).
    await store.finishRun({ runId: latest.id, status: 'failed', error: 'abandoned (no finish within 30m) — partial write rolled back by the reconciler' });
  }

  if (!good) {
    log('no good publish recorded yet; nothing to reconcile');
    return { drift: 0 };
  }

  const manifest = good.manifest;
  const restored = [];
  const unresolved = [];
  const errors = [];

  const entries = Object.entries(manifest);
  await pMap(entries, async ([key, expected]) => {
    try {
      const live = await headHash(s3, SITE_BUCKET, key);
      if (live === expected) return;
      const versionId = await restore(key, expected);
      if (versionId) restored.push({ key, expected, live, versionId });
      else unresolved.push({ key, expected, live });
      log(`DRIFT ${key}: live=${live} expected=${expected} restored=${!!versionId}`);
    } catch (err) {
      errors.push({ key, error: String(err.message || err) });
      log(`ERROR ${key}: ${err.message}`);
    }
  }, HEAD_CONCURRENCY);

  // Objects living in the bucket that no publish produced (rogue writes).
  const liveKeys = await listKeys(s3, SITE_BUCKET);
  const unexpected = [...liveKeys].filter(key => !(key in manifest));

  // Only successfully-restored objects get invalidated — invalidating an
  // unrepaired path would evict a possibly-good cached copy in favor of the
  // corrupt origin bytes.
  if (restored.length) {
    const items = invalidationPaths(restored.map(r => r.key));
    await cf.send(new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `reconcile-${Date.now()}`,
        Paths: { Quantity: items.length, Items: items },
      },
    }));
    await alert(`uccsite drift: ${restored.length} object(s) restored`, { runId: good.runId, restored });
  }
  if (unresolved.length) {
    await alert(
      `uccsite drift UNRESOLVED: ${unresolved.length} object(s) still wrong — republish needed`,
      { runId: good.runId, unresolved });
  }
  if (unexpected.length) {
    await alert(
      `uccsite: ${unexpected.length} unexpected object(s) in the site bucket`,
      { keys: unexpected.slice(0, 50) });
    for (const key of unexpected) log(`UNEXPECTED ${key}`);
  }
  if (errors.length) {
    await alert(`uccsite reconciler: ${errors.length} key(s) failed to check`, { errors });
  }

  if (!restored.length && !unresolved.length && !unexpected.length && !errors.length) {
    log(`no drift across ${entries.length} paths`);
  }
  return { drift: restored.length + unresolved.length, restored, unresolved, unexpected, errors };
}

export async function handler() {
  try {
    return await reconcile();
  } catch (err) {
    // The reconciler must never fail silently: alert, then rethrow so the
    // Lambda Errors metric (alarmed to the same topic) also fires.
    log(`FATAL ${err.message}`);
    try { await alert('uccsite reconciler FAILED', { error: String(err.message || err) }); } catch {}
    throw err;
  }
}
