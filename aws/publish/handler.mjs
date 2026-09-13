// Lambda entrypoint for the publish pipeline (Phase 7): the admin invokes
// this (async) instead of a developer running scripts/publish.mjs. Content
// comes from the DATABASE (source of truth after migrate-content); templates,
// partials, css/js/assets are bundled into the Lambda asset at deploy
// (site-src/, copied by the CDK commandHooks).
//
// Sitemap lastmod: per page, the newest updated_at across the collections it
// renders (falls back to the deploy date for pages whose inputs carry none).
// Status surfacing: core.publish writes the publish_runs lifecycle row; the
// admin polls that for Draft/Publishing/Live/Failed.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { buildSite, PAGES } from '@uccsite/render';
import { publish } from '@uccsite/publish';
import { makeDsqlStore } from '@uccsite/publish/store';
import { loadRenderInputs, collectStaticFiles } from '@uccsite/publish/inputs';
import { withConnection } from '@uccsite/db';
import { loadContent, contentMeta, makeDbLastmod } from '@uccsite/db/content';

const { SITE_BUCKET, DISTRIBUTION_ID, DSQL_ENDPOINT } = process.env;
const region = process.env.AWS_REGION;

// esbuild emits CJS: __dirname survives bundling (import.meta does not).
// eslint-disable-next-line no-undef
const SITE_SRC = join(typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url)), 'site-src');

// Render from the database. Throws with every error listed (fail-fast, §7).
async function renderFromDb(dbConfig, log) {
  const { content, meta } = await withConnection(dbConfig, async (client) => ({
    content: await loadContent(client),
    meta: await contentMeta(client),
  }));
  const errors = [];
  const inputs = loadRenderInputs(SITE_SRC, (msg) => errors.push(msg), { includeContent: false });
  inputs.content = content;
  const { files, errors: renderErrors } = errors.length
    ? { files: {}, errors: [] }
    : buildSite({ ...inputs, lastmod: makeDbLastmod(meta) });
  const allErrors = [...errors, ...renderErrors];
  if (allErrors.length) {
    for (const e of allErrors) console.error('[publish] RENDER ERROR: ' + e);
    throw new Error(`render failed: ${allErrors.length} error(s): ${allErrors[0]}`);
  }
  const outputs = collectStaticFiles(SITE_SRC);
  for (const [name, text] of Object.entries(files)) outputs.set(name, Buffer.from(text, 'utf8'));
  log(`[publish] rendered ${Object.keys(files).length} files, ${outputs.size} total outputs (${PAGES.length} pages)`);
  return outputs;
}

export async function handler(event = {}) {
  const trigger = event.trigger || 'admin';
  const log = (m) => console.log(m);
  const dbConfig = { endpoint: DSQL_ENDPOINT, region };
  const store = makeDsqlStore(dbConfig);
  const runId = randomUUID();
  const startedAt = new Date();

  // The mutex lives in the database (publish_lock), acquired BEFORE any
  // work: the admin's disabled button is cosmetic, and restore-triggered
  // publishes come through here too. A refused run is recorded so the
  // dashboard shows why nothing happened.
  if (!(await store.acquireLock(runId))) {
    log(`[publish] refused: another publish holds the lock (run ${runId}, trigger ${trigger})`);
    await store.startRun({ runId, trigger, manifest: null, startedAt });
    await store.finishRun({ runId, status: 'refused', error: 'another publish was in flight' });
    return { status: 'refused' };
  }
  try {
    let outputs;
    try {
      outputs = await renderFromDb(dbConfig, log);
    } catch (err) {
      // Nothing was written; record the failure where the admin can see it.
      await store.startRun({ runId, trigger, manifest: null, startedAt });
      await store.finishRun({ runId, status: 'failed', error: String(err.message || err) });
      throw err;
    }
    const result = await publish({
      outputs,
      s3: new S3Client({ region }),
      cf: new CloudFrontClient({ region }),
      bucket: SITE_BUCKET,
      distributionId: DISTRIBUTION_ID,
      store,
      runId,
      startedAt,
      trigger,
      allowBulkDelete: Boolean(event.allowBulkDelete),
      log,
    });
    return { status: result.status, changed: result.changed.length, removed: result.removed.length, invalidationId: result.invalidationId };
  } finally {
    await store.releaseLock(runId).catch((err) => log(`[publish] WARNING: lock release failed: ${err.message}`));
  }
}
