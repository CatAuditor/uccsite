// Operational data export (build-spec-aws.md §14.3): nightly snapshot of the
// donor/newsletter tables to a RESTRICTED private bucket. Never to git, never
// to the site or media buckets — donor PII stays inside AWS. The bucket
// lifecycle expires exports after 90 days (holding donor PII longer than the
// org can justify is a liability, not a safety margin).
// rate_limits (ephemeral) and processed_events (reconstructible from Stripe)
// are deliberately excluded.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { withConnection } from '@uccsite/db';

const { EXPORT_BUCKET, DSQL_ENDPOINT, ALERT_TOPIC_ARN } = process.env;
const region = process.env.AWS_REGION;
const s3 = new S3Client({ region });
const sns = new SNSClient({ region });

const TABLES = ['members', 'subscriptions', 'donations', 'subscribers'];

export async function handler() {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const counts = {};
    await withConnection({ endpoint: DSQL_ENDPOINT, region }, async (client) => {
      for (const table of TABLES) {
        // No legacy_id in the ORDER BY — that column is migration scaffolding
        // and is dropped after cutover verification; the export must survive it.
        const res = await client.query(`SELECT * FROM ${table} ORDER BY created_at`);
        counts[table] = res.rowCount;
        await s3.send(new PutObjectCommand({
          Bucket: EXPORT_BUCKET,
          Key: `${date}/${table}.json`,
          Body: JSON.stringify(res.rows),
          ContentType: 'application/json',
        }));
      }
      await s3.send(new PutObjectCommand({
        Bucket: EXPORT_BUCKET,
        Key: `${date}/manifest.json`,
        Body: JSON.stringify({ exported_at: new Date().toISOString(), counts }),
        ContentType: 'application/json',
      }));
    });
    console.log(`[export-ops] ${date}: ${JSON.stringify(counts)}`);
    return { date, counts };
  } catch (err) {
    console.error(`[export-ops] FAILED: ${err.message}`);
    if (ALERT_TOPIC_ARN) {
      try {
        await sns.send(new PublishCommand({
          TopicArn: ALERT_TOPIC_ARN,
          Subject: 'uccsite operational export FAILED',
          Message: String(err.message || err),
        }));
      } catch {}
    }
    throw err;
  }
}
