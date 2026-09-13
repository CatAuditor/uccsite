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
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { buildSite, PAGES } from '@uccsite/render';
import { publish } from '@uccsite/publish';
import { loadRenderInputs, collectStaticFiles } from '@uccsite/publish/inputs';
import { withConnection } from '@uccsite/db';
import { loadContent, contentMeta } from '@uccsite/db/content';

const { SITE_BUCKET, DISTRIBUTION_ID, DSQL_ENDPOINT } = process.env;
const region = process.env.AWS_REGION;

// esbuild emits CJS: __dirname survives bundling (import.meta does not).
// eslint-disable-next-line no-undef
const SITE_SRC = join(typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url)), 'site-src');

// content/*.json names → the tables whose updated_at governs that collection.
const COLLECTION_TABLES = {
  settings: ['site_settings'],
  homepage: ['homepage', 'homepage_press'],
  team: ['team_members'],
  statements: ['statements'],
  issues: ['issues'],
  blog: ['blog_articles', 'blog_videos'],
  projects: ['projects', 'project_articles', 'project_videos'],
  coverage: ['coverage_entries'],
};

export async function handler(event = {}) {
  const trigger = event.trigger || 'admin';
  const log = (m) => console.log(m);

  const dbConfig = { endpoint: DSQL_ENDPOINT, region };
  const { content, meta } = await withConnection(dbConfig, async (client) => ({
    content: await loadContent(client),
    meta: await contentMeta(client),
  }));

  const errors = [];
  const inputs = loadRenderInputs(SITE_SRC, (msg) => errors.push(msg), { includeContent: false });
  inputs.content = content;

  const today = new Date().toISOString().slice(0, 10);
  const lastmod = (page) => {
    let best = '';
    for (const name of page.content) {
      for (const table of COLLECTION_TABLES[name] || []) {
        const iso = meta[table];
        if (iso && iso > best) best = iso;
      }
    }
    return best ? best.slice(0, 10) : today;
  };

  const { files, errors: renderErrors } = errors.length
    ? { files: {}, errors: [] }
    : buildSite({ ...inputs, lastmod });
  const allErrors = [...errors, ...renderErrors];
  if (allErrors.length) {
    // Fail-fast (§7): abort before anything is written.
    for (const e of allErrors) console.error('[publish] RENDER ERROR: ' + e);
    throw new Error(`render failed: ${allErrors.length} error(s)`);
  }

  const outputs = collectStaticFiles(SITE_SRC);
  for (const [name, text] of Object.entries(files)) outputs.set(name, Buffer.from(text, 'utf8'));
  log(`[publish] rendered ${Object.keys(files).length} files, ${outputs.size} total outputs (${PAGES.length} pages)`);

  const result = await publish({
    outputs,
    s3: new S3Client({ region }),
    cf: new CloudFrontClient({ region }),
    bucket: SITE_BUCKET,
    distributionId: DISTRIBUTION_ID,
    dbConfig,
    trigger,
    allowBulkDelete: Boolean(event.allowBulkDelete),
    log,
  });
  return { status: result.status, changed: result.changed.length, removed: result.removed.length, invalidationId: result.invalidationId };
}
