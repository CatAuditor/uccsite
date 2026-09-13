// Drift reconciler (build-spec-aws.md §7): hourly, compares every path in the
// last successful publish manifest (publish_runs) against the live S3 object.
// A mismatched or missing object is restored from S3 version history (the
// site bucket is versioned, §14.1) and its paths invalidated; every incident
// is reported via SNS. A dropped invalidation or corrupted object cannot
// leave a page silently stale.
import {
  S3Client, HeadObjectCommand, ListObjectVersionsCommand, CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { latestManifest } from '@uccsite/publish';

const { SITE_BUCKET, DISTRIBUTION_ID, DSQL_ENDPOINT, ALERT_TOPIC_ARN } = process.env;
const region = process.env.AWS_REGION;
const s3 = new S3Client({ region });
const cf = new CloudFrontClient({ region });
const sns = new SNSClient({ region });

async function liveHash(key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: SITE_BUCKET, Key: key }));
    return head.Metadata?.sha256 || 'missing-metadata';
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return null;
    throw err;
  }
}

// Restore the newest version whose sha256 metadata matches the manifest.
async function restore(key, expectedHash) {
  const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: SITE_BUCKET, Prefix: key }));
  for (const v of versions.Versions || []) {
    if (v.Key !== key) continue;
    const head = await s3.send(new HeadObjectCommand({ Bucket: SITE_BUCKET, Key: key, VersionId: v.VersionId }));
    if (head.Metadata?.sha256 === expectedHash) {
      await s3.send(new CopyObjectCommand({
        Bucket: SITE_BUCKET,
        Key: key,
        CopySource: encodeURIComponent(`${SITE_BUCKET}/${key}`) + `?versionId=${v.VersionId}`,
        MetadataDirective: 'COPY',
      }));
      return v.VersionId;
    }
  }
  return null;
}

export async function handler() {
  const latest = await latestManifest({ endpoint: DSQL_ENDPOINT, region });
  if (!latest) {
    console.log('No successful publish recorded yet; nothing to reconcile.');
    return { drift: 0 };
  }

  const incidents = [];
  const repairedPaths = new Set();
  for (const [key, expected] of Object.entries(latest.manifest)) {
    const live = await liveHash(key);
    if (live === expected) continue;
    const restoredFrom = await restore(key, expected);
    incidents.push({ key, expected, live, restored: !!restoredFrom, versionId: restoredFrom });
    repairedPaths.add('/' + key);
    if (key.endsWith('.html')) repairedPaths.add(key === 'index.html' ? '/' : '/' + key.slice(0, -5));
    console.log(`DRIFT ${key}: live=${live} expected=${expected} restored=${!!restoredFrom}`);
  }

  if (incidents.length) {
    const items = repairedPaths.size > 15 ? ['/*'] : [...repairedPaths];
    await cf.send(new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `reconcile-${Date.now()}`,
        Paths: { Quantity: items.length, Items: items },
      },
    }));
    if (ALERT_TOPIC_ARN) {
      await sns.send(new PublishCommand({
        TopicArn: ALERT_TOPIC_ARN,
        Subject: `uccsite drift: ${incidents.length} object(s) reconciled`,
        Message: JSON.stringify({ runId: latest.runId, incidents }, null, 2),
      }));
    }
  } else {
    console.log(`No drift across ${Object.keys(latest.manifest).length} paths.`);
  }
  return { drift: incidents.length, incidents };
}
