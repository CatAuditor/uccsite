// Blind-spot tracer (docs/error-handling/debug/admin.md "Traces"). Amplify
// Hosting keeps no readable server log for this app and a production
// "Server Components render … ref <digest>" hides the message, so a step
// trace is written to S3 — the media bucket, which the SSR compute role can
// already write — under `_debug/<name>-<timestamp>.json`: the steps reached,
// how long each took, and the error (message + stack) if one was thrown.
//
//   const t = trace('newsletter-request', { id });
//   t.step('saved'); … t.fail(err); … await t.flush();
//
// flush() never throws (a failing tracer must not break the request). Read
// with: aws s3 ls s3://<MEDIA_BUCKET>/_debug/ --profile uccsite
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config';

let s3 = null;

export function trace(name, meta = {}) {
  const started = Date.now();
  const steps = [];
  let error = null;
  return {
    step(label, extra) { steps.push({ label, at: Date.now() - started, ...(extra ? { extra } : {}) }); },
    fail(err) { error = { name: err?.name || 'Error', message: String(err?.message || err).slice(0, 2000), digest: err?.digest || '', stack: String(err?.stack || '').split('\n').slice(0, 15).join('\n') }; },
    async flush() {
      try {
        s3 ||= new S3Client({ region: config.region, requestHandler: { requestTimeout: 4000 } });
        const key = `_debug/${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        await s3.send(new PutObjectCommand({
          Bucket: config.mediaBucket, Key: key, ContentType: 'application/json',
          Body: JSON.stringify({ name, meta, started: new Date(started).toISOString(), ms: Date.now() - started, steps, error }, null, 1),
        }));
        console.log(`[trace] ${name} -> s3://${config.mediaBucket}/${key}${error ? ` FAILED ${error.name}: ${error.message}` : ''}`);
      } catch (e) {
        console.error(`[trace] ${name} could not be written: ${e?.message || e}`);
      }
    },
  };
}
