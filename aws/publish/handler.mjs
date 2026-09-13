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
import { PAGES } from '@uccsite/render';
import { publish } from '@uccsite/publish';
import { makeDsqlStore } from '@uccsite/publish/store';
import { loadRenderInputs, collectStaticFiles } from '@uccsite/publish/inputs';
import { loadSiteFromDb, renderSiteFromDb, recordDocumentPublish } from '@uccsite/publish/render-db';
import { withConnection } from '@uccsite/db';
import { SITE_URL } from '@uccsite/render/site';

const { SITE_BUCKET, DISTRIBUTION_ID, DSQL_ENDPOINT } = process.env;
const region = process.env.AWS_REGION;

// esbuild emits CJS: __dirname survives bundling (import.meta does not).
// eslint-disable-next-line no-undef
const SITE_SRC = join(typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url)), 'site-src');

// Render from the database (collections + Documents, aws/publish/render-db.js).
// Throws with every error listed (fail-fast, §7); document-level errors are
// also recorded on the document rows so the admin shows them.
async function renderFromDb(dbConfig, log) {
  const db = await withConnection(dbConfig, loadSiteFromDb);
  const errors = [];
  const inputs = loadRenderInputs(SITE_SRC, (msg) => errors.push(msg), { includeContent: false });
  const outputs = collectStaticFiles(SITE_SRC);
  const siteCss = outputs.get('css/styles.css')?.toString('utf8') || '';
  const rendered = errors.length
    ? { files: {}, errors: [], documentHashes: {}, documentIds: {} }
    : renderSiteFromDb({ inputs, siteCss, ...db, siteUrl: SITE_URL });
  const allErrors = [...errors, ...rendered.errors];
  if (allErrors.length) {
    for (const e of allErrors) console.error('[publish] RENDER ERROR: ' + e);
    await withConnection(dbConfig, (client) => recordDocumentPublish(client, { ...rendered, errors: allErrors }))
      .catch((err) => log(`[publish] WARNING: could not record document errors: ${err.message}`));
    throw new Error(`render failed: ${allErrors.length} error(s): ${allErrors[0]}`);
  }
  for (const [name, text] of Object.entries(rendered.files)) outputs.set(name, Buffer.from(text, 'utf8'));
  log(`[publish] rendered ${Object.keys(rendered.files).length} files (${PAGES.length} fixed pages, ${db.bundle.documents.length} documents), ${outputs.size} total outputs`);
  return { outputs, rendered };
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
    let outputs, rendered;
    try {
      ({ outputs, rendered } = await renderFromDb(dbConfig, log));
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
    // Documents went live with this run (or were unchanged): record it.
    await withConnection(dbConfig, (client) => recordDocumentPublish(client, rendered))
      .catch((err) => log(`[publish] WARNING: could not record document live state: ${err.message}`));
    return { status: result.status, changed: result.changed.length, removed: result.removed.length, invalidationId: result.invalidationId };
  } finally {
    await store.releaseLock(runId).catch((err) => log(`[publish] WARNING: lock release failed: ${err.message}`));
  }
}
