import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { documents: docs, SITE_URL } = require('@uccsite/render');
const site = require('@uccsite/render/site.js');
const { loadRenderInputs } = require('../aws/publish/inputs.js');
const S = process.env.SCRATCH;
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const inputs = loadRenderInputs(ROOT);
const siteCss = readFileSync(ROOT + '/css/styles.css', 'utf8');
const colorsCss = null;
const meta = JSON.parse(readFileSync(S + '/doc-meta.json', 'utf8'));
const doc = {
  id: 'fd028a95-8233-49a9-a770-e4f28b9a05be', templateKey: 'report', status: 'draft', updatedAt: new Date().toISOString(),
  bodyHtmlRaw: readFileSync(S + '/body.html', 'utf8'), pageCss: readFileSync(S + '/page.css', 'utf8'),
  ...meta,
};
const out = docs.composeDocument({
  doc, shell: inputs.shells.report, partials: inputs.partials, settings: inputs.content.settings, siteUrl: SITE_URL,
  siteCss, authors: site.authorIndex ? site.authorIndex(inputs.content.team?.members, SITE_URL) : {},
});
const r = out.ingestResult.report;
console.log('errors', out.errors);
console.log('ingest: removed', JSON.stringify(r.removed), 'foreign', JSON.stringify(r.foreignClasses), 'a11y', JSON.stringify(r.a11y), 'warnings', JSON.stringify(r.warnings));
const cssTag = (css) => `<style>${css.replace(/<\/style/gi, '<\/style')}</style>`;
const html = out.html
  .replace('<link rel="stylesheet" href="/css/styles.css" />', () => cssTag(siteCss))
  .replace(/<link rel="stylesheet" href="\/css\/pages\/[^"]+" \/>/, () => cssTag(doc.pageCss))
  .replace('<head>', () => `<head><base href="${SITE_URL}/" />`);
writeFileSync(S + '/preview.html', html);
writeFileSync(S + '/composed-head.html', out.html.slice(0, out.html.indexOf('</head>')));
console.log('preview bytes', html.length, 'cssKey', out.cssKey);
