#!/usr/bin/env node
// convert-documents-to-blocks.mjs — move the legacy (raw-HTML) documents onto
// the block builder (docs/systems/document-builder.md "Legacy conversion")
// and PROVE the page still looks the same.
//
// For every document in the environment that has no body_blocks yet (or the
// --only slugs): parse the body into blocks, serialize the blocks back,
// rewrite the page CSS to the new frame, then compare OLD (legacy HTML +
// legacy page CSS + the site CSS from before the "Document blocks" group) with
// NEW (generated HTML + rewritten page CSS + the current site CSS):
//   - text content must be identical (hard failure otherwise)
//   - full-page screenshots in headless Chrome, pixel-diffed (pixelmatch);
//     the percentage of differing pixels and a diff image are reported
// --apply writes body_blocks / body_html_raw / page_css to the row inside a
// revision (snapshot of the fields before) + audit row, like the admin's
// "Convert to blocks". Never touches a document that already has blocks.
//
// Usage: $env:AWS_PROFILE='uccsite'
//        node scripts/convert-documents-to-blocks.mjs --env staging [--only alpr,stratos]
//             [--out <dir>] [--no-shots] [--apply] [--threshold 0.5]
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { resolveEnv, argValue } from './lib/stack.mjs';
import { parse, serialize, rewritePageCss } from '../packages/doc-blocks/index.js';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { withConnection } = require('../packages/db');
const { getDocument, listDocuments, upsertDocument, listStyleRules, listOverrides, loadForeignClassMap } = require('../packages/db/documents');
const { loadSettings, list } = require('../packages/db/content');
const { ingest, parseFragmentTree } = require('../packages/html-ingest');
const { documents: compose, SITE_URL, memberSlug } = require('../packages/render');
const { textContent } = require('domutils');

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const ONLY = argValue(args, '--only', '').split(',').filter(Boolean);
const OUT = argValue(args, '--out', join(ROOT, '.tmp', 'blocks-conversion'));
const APPLY = args.includes('--apply');
const SHOTS = !args.includes('--no-shots');
const THRESHOLD = Number(argValue(args, '--threshold', '0.5')); // % differing pixels allowed for "pass"
const OLD_CSS_REF = '68dc73c'; // the commit before the "Document blocks" group landed in css/styles.css
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

// Per-document class aliases: a legacy class whose look is a DIFFERENT site
// class (alpr's and weber-county's grey finding-box is the site's violation-box).
const CLASS_ALIASES = {
  alpr: { 'finding-box': 'violation-box' },
  'weber-county': { 'finding-box': 'violation-box' },
};
// Documents that should LOSE their own frame and take the site's standard
// document frame (doc-body > doc-inner, byline strip, contents list): the
// license-plate statement was written on the generic kit frame and never
// styled like the reports, so it is expected to change (the pixel check
// reports it as CHECK, not a failure of the conversion).
const STANDARD_FRAME = new Set(['license-plate-has-a-price']);

const readDir = (dir) => Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.html')).map(f => [f.replace(/\.html$/, ''), readFileSync(join(dir, f), 'utf8')]));
const partials = readDir(join(ROOT, 'templates', 'partials'));
const shells = readDir(join(ROOT, 'templates', 'documents'));
const newSiteCss = readFileSync(join(ROOT, 'css', 'styles.css'), 'utf8');
const oldSiteCss = execSync(`git show ${OLD_CSS_REF}:css/styles.css`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const colorsCss = existsSync(join(ROOT, 'css', 'colors.css')) ? readFileSync(join(ROOT, 'css', 'colors.css'), 'utf8') : '';

function flatText(html) {
  const out = [];
  (function walk(n) { for (const c of n.children || []) { if (c.type === 'text' && c.data.trim()) out.push(c.data.replace(/\s+/g, ' ').trim()); walk(c); } })(parseFragmentTree(html));
  return out.join(' ');
}

// composePage(doc, siteCss) → a standalone HTML page for the screenshot:
// the real composed shell, stylesheets inlined, fonts/assets from the
// production origin (public), scripts removed (no nav behaviour needed).
function composePage(doc, { siteCss, settings, rules, overrides, foreignClassMap, coverage, authors }) {
  const res = compose.composeDocument({ doc, shell: shells[doc.templateKey] || shells.report, partials, settings, siteUrl: SITE_URL, siteCss, rules, overrides, foreignClassMap, coverage, authors });
  if (res.errors?.length) console.warn(`   compose warnings for ${doc.slug}: ${res.errors.join('; ')}`);
  const cssTag = (css) => `<style>${String(css || '').replace(/<\/style/gi, '<\\/style')}</style>`;
  return res.html
    .replace('<link rel="stylesheet" href="/css/fonts.css" />', () => `<link rel="stylesheet" href="${SITE_URL}/css/fonts.css" />`)
    .replace('<link rel="stylesheet" href="/css/styles.css" />', () => cssTag(siteCss))
    .replace('<link rel="stylesheet" href="/css/colors.css" />', () => cssTag(colorsCss))
    .replace(/<link rel="stylesheet" href="\/css\/pages\/[^"]+" \/>/, () => cssTag(doc.pageCss))
    .replace('<head>', () => `<head><base href="${SITE_URL}/" /><style>html{scroll-behavior:auto}*{animation:none!important;transition:none!important}</style>`)
    .replace(/<script[^>]*src="\/js\/[^"]+"[^>]*><\/script>/g, '');
}

async function screenshot(browser, htmlPath, pngPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts?.ready);
  // open every <details> so collapsed sections are compared too
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: pngPath, fullPage: true });
  await page.close();
}

function diffPngs(aPath, bPath, outPath) {
  const { PNG } = require('pngjs');
  const pm = require('pixelmatch'); const pixelmatch = pm.default || pm; // v6 ships ESM with a default export
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (img) => {
    if (img.width === width && img.height === height) return img.data;
    const out = Buffer.alloc(width * height * 4, 255);
    for (let y = 0; y < img.height; y++) img.data.copy(out, y * width * 4, y * img.width * 4, (y + 1) * img.width * 4);
    return out;
  };
  const diff = new PNG({ width, height });
  const n = pixelmatch(pad(a), pad(b), diff.data, width, height, { threshold: 0.1, includeAA: true });
  writeFileSync(outPath, PNG.sync.write(diff));
  return { differing: n, total: width * height, pct: (100 * n) / (width * height), heightOld: a.height, heightNew: b.height };
}

const { region, outputs } = await resolveEnv(envName, ['DsqlEndpoint']);
mkdirSync(OUT, { recursive: true });
const summary = [];
let failures = 0;

await withConnection({ endpoint: outputs.DsqlEndpoint, region }, async (client) => {
  const settings = await loadSettings(client);
  const rules = await listStyleRules(client);
  const coverage = {
    alpr_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['alpr']),
    stratos_coverage: await list(client, 'coverage_entries', 'WHERE report_key = $1', ['stratos']),
  };
  const members = (await client.query('SELECT name, slug FROM team_members')).rows;
  const authors = Object.fromEntries(members.filter(m => m.name).map(m => [m.name.trim(), { slug: memberSlug(m), url: `/team/${memberSlug(m)}`, id: `${SITE_URL}/team/${memberSlug(m)}#person` }]));
  const all = await listDocuments(client);
  const docs = all.filter(d => (ONLY.length ? ONLY.includes(d.slug) : !d.bodyBlocks && String(d.bodyHtmlRaw || '').trim()));

  let browser = null;
  if (SHOTS) {
    if (!CHROME) throw new Error('No Chrome found for screenshots; pass --no-shots');
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
  }

  for (const row of docs) {
    const doc = await getDocument(client, { id: row.id });
    if (doc.bodyBlocks && !APPLY) console.log(`\n== ${doc.slug}: already a builder document (comparing anyway)`);
    else console.log(`\n== ${doc.slug}`);
    const aliases = CLASS_ALIASES[doc.slug] || {};
    const res = parse(doc.bodyHtmlRaw, { classAliases: aliases });
    if (res.title && res.title !== doc.title) res.body.header.headline = res.title;
    if (STANDARD_FRAME.has(doc.slug)) {
      res.body.header.frame = [];
      res.body.header.toc = res.body.sections.filter(s => s.heading).length >= 2 ? 'auto' : 'none';
      if (!res.body.header.badge) res.body.header.badge = 'Utah Civic Compact';
      console.log('   standard frame: doc-body > doc-inner, byline strip, contents list (look changes by design)');
    }
    const author = doc.author || res.author;
    const authorHref = authors[String(author || '').trim()]?.url || '';
    const newHtml = serialize(res.body, { title: doc.title, author }, { authorHref });
    const newCss = rewritePageCss(doc.pageCss, { classAliases: aliases });
    const overrides = await listOverrides(client, doc.id);
    const foreignClassMap = await loadForeignClassMap(client, doc.templateKey);
    const docRules = compose.rulesFor(doc, rules);

    const oldDoc = { ...doc };
    const newDoc = { ...doc, author, bodyHtmlRaw: newHtml, pageCss: newCss, bodyBlocks: res.body };
    const known = new Set();
    const textOld = flatText(ingest(oldDoc.bodyHtmlRaw, { knownClasses: known }).bodyHtmlNormalized);
    const textNew = flatText(ingest(newDoc.bodyHtmlRaw, { knownClasses: known }).bodyHtmlNormalized);
    const blocks = res.body.sections.reduce((n, s) => n + s.blocks.length, 0);
    const line = { slug: doc.slug, sections: res.body.sections.length, blocks, raw: res.report.raw, text: textOld === textNew ? 'identical' : 'DIFFERENT', notes: res.report.notes };
    console.log(`   ${line.sections} sections, ${blocks} blocks, raw ${line.raw}; text ${line.text}${aliases && Object.keys(aliases).length ? `; aliases ${JSON.stringify(aliases)}` : ''}`);
    for (const n of res.report.notes) console.log(`   note: ${n}`);
    if (textOld !== textNew) { failures++; const i = [...textOld].findIndex((ch, k) => ch !== textNew[k]); console.log(`   TEXT DIFF at ${i}: old …${textOld.slice(Math.max(0, i - 40), i + 80)}\n                 new …${textNew.slice(Math.max(0, i - 40), i + 80)}`); }

    const dir = join(OUT, doc.slug);
    mkdirSync(dir, { recursive: true });
    const oldPage = composePage(oldDoc, { siteCss: oldSiteCss, settings, rules: docRules, overrides, foreignClassMap, coverage, authors });
    const newPage = composePage(newDoc, { siteCss: newSiteCss, settings, rules: docRules, overrides, foreignClassMap, coverage, authors });
    writeFileSync(join(dir, 'old.html'), oldPage);
    writeFileSync(join(dir, 'new.html'), newPage);
    writeFileSync(join(dir, 'blocks.json'), JSON.stringify(res.body, null, 2));
    writeFileSync(join(dir, 'new-body.html'), newHtml);
    writeFileSync(join(dir, 'new-page.css'), newCss);
    if (browser) {
      await screenshot(browser, join(dir, 'old.html'), join(dir, 'old.png'));
      await screenshot(browser, join(dir, 'new.html'), join(dir, 'new.png'));
      const d = diffPngs(join(dir, 'old.png'), join(dir, 'new.png'), join(dir, 'diff.png'));
      line.pixels = d;
      const ok = d.pct <= THRESHOLD && Math.abs(d.heightOld - d.heightNew) <= 8;
      console.log(`   pixels: ${d.pct.toFixed(3)}% differ (${d.differing} of ${d.total}); page height ${d.heightOld} → ${d.heightNew} ${ok ? 'PASS' : 'CHECK'}  (${join(dir, 'diff.png')})`);
      if (!ok) failures++;
    }
    summary.push(line);

    if (APPLY && textOld === textNew) {
      if (doc.bodyBlocks) { console.log('   skip apply: already a builder document'); continue; }
      const before = (({ bodyHtmlNormalized, ingestReport, liveHash, liveAt, lastPublishError, createdAt, updatedAt, contentHash, publishedAt, ...fields }) => ({ ...fields, overrides: overrides.map(({ nid, classes, mode }) => ({ nid, classes, mode })) }))(doc);
      // Store the normalized body + report as a save would (the admin re-ingests on the next save anyway).
      const result = ingest(newHtml, { knownClasses: compose.knownClassesFor(newSiteCss, newCss), foreignClassMap, allowScripts: Boolean(doc.allowScripts) });
      const next = { ...newDoc, bodyHtmlNormalized: result.bodyHtmlNormalized, ingestReport: result.report };
      await upsertDocument(client, next);
      await client.query(`INSERT INTO revisions (id, entity_type, entity_id, snapshot, author) VALUES (gen_random_uuid(), 'document', $1, $2, $3)`, [doc.id, JSON.stringify(before), 'scripts/convert-documents-to-blocks']);
      await client.query(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, diff) VALUES (gen_random_uuid(), $1, 'document.convert_blocks', 'document', $2, $3)`,
        ['scripts/convert-documents-to-blocks', doc.id, JSON.stringify({ sections: line.sections, blocks, raw: line.raw, pixelsPct: line.pixels?.pct ?? null })]);
      console.log('   applied: body_blocks, body_html_raw, page_css written; revision + audit row recorded');
    }
  }
  if (browser) await browser.close();
});

const md = [
  `# Legacy documents → blocks: conversion report (${envName}, ${new Date().toISOString().slice(0, 10)})`,
  '',
  'Generated by `scripts/convert-documents-to-blocks.mjs`. OLD = the legacy HTML + its page CSS + the site CSS before the "Document blocks" group; NEW = the serialized blocks + the rewritten page CSS + the current site CSS. Screenshots at 1280px, every `<details>` opened.',
  '',
  '| slug | sections | blocks | raw | text | differing pixels | page height old → new |',
  '|---|---|---|---|---|---|---|',
  ...summary.map(l => `| ${l.slug} | ${l.sections} | ${l.blocks} | ${l.raw} | ${l.text} | ${l.pixels ? `${l.pixels.pct.toFixed(3)}%` : 'n/a'} | ${l.pixels ? `${l.pixels.heightOld} → ${l.pixels.heightNew}` : 'n/a'} |`),
  '',
  ...summary.filter(l => l.notes.length).flatMap(l => [`- **${l.slug}**: ${l.notes.join('; ')}`]),
  '',
].join('\n');
writeFileSync(join(OUT, 'report.md'), md);
console.log(`\nReport: ${join(OUT, 'report.md')}${failures ? `\n${failures} check(s) need attention` : '\nAll checks passed'}`);
process.exit(failures ? 1 : 0);
