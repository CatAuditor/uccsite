#!/usr/bin/env node
// blocks-roundtrip.mjs — conversion check for the document builder
// (docs/systems/document-builder.md "Legacy conversion"): parse each tracked
// legacy document (docs/migration/documents/*.document.json) into blocks,
// serialize the blocks back to HTML, run BOTH through the ingest and compare
// text content and tag sequence. Prints raw-block counts and the first
// differences. Usage: node scripts/blocks-roundtrip.mjs [slug ...] [--html out-dir]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse, serialize } = require('../packages/doc-blocks');
const { ingest, parseFragmentTree } = require('../packages/html-ingest');
const { textContent } = require('domutils');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--html');
const outDir = outIdx >= 0 ? args[outIdx + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);
const dir = join(process.cwd(), 'docs/migration/documents');
const files = readdirSync(dir).filter(f => f.endsWith('.document.json')).filter(f => !only.length || only.includes(f.replace('.document.json', '')));

function flatten(html) {
  const tree = parseFragmentTree(html);
  const tags = [];
  const texts = [];
  (function walk(n) {
    for (const c of n.children || []) {
      if (c.type === 'tag') { tags.push(c.name); walk(c); }
      else if (c.type === 'text' && c.data.trim()) texts.push(c.data.replace(/\s+/g, ' ').trim());
    }
  })(tree);
  return { tags, text: texts.join(' ').replace(/\s+/g, ' ') };
}
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { at: i, a: a.slice(Math.max(0, i - 3), i + 6), b: b.slice(Math.max(0, i - 3), i + 6) };
  return a.length === b.length ? null : { at: n, a: a.slice(n - 3, n + 6), b: b.slice(n - 3, n + 6) };
}

let failures = 0;
for (const f of files) {
  const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const res = parse(doc.bodyHtmlRaw);
  if (res.title && res.title !== doc.title) res.body.header.headline = res.title; // the page h1 differs from the SEO title
  const html = serialize(res.body, { title: doc.title, author: res.author || doc.author }, { authorHref: res.authorHref });
  const known = new Set();
  const before = ingest(doc.bodyHtmlRaw, { knownClasses: known });
  const after = ingest(html, { knownClasses: known });
  const A = flatten(before.bodyHtmlNormalized);
  const B = flatten(after.bodyHtmlNormalized);
  const textSame = A.text === B.text;
  const tagDiff = firstDiff(A.tags, B.tags);
  const blocks = res.body.sections.reduce((n, s) => n + s.blocks.length, 0);
  const types = {};
  for (const s of res.body.sections) for (const b of s.blocks) types[b.type] = (types[b.type] || 0) + 1;
  console.log(`\n== ${doc.slug}: ${res.body.sections.length} sections, ${blocks} blocks, raw ${res.report.raw} ${JSON.stringify(types)}`);
  console.log(`   title ${res.title === doc.title ? 'ok' : `DIFF "${res.title}"`} | author "${res.author}" ${res.body.header.authorTitle ? `(${res.body.header.authorTitle})` : ''} | date "${res.body.header.date}" | toc ${res.body.header.toc} | wrappers ${res.report.wrappers.join(',')}`);
  for (const n of res.report.notes) console.log(`   note: ${n}`);
  if (!textSame) {
    failures++;
    const i = [...A.text].findIndex((ch, k) => ch !== B.text[k]);
    console.log(`   TEXT DIFF at ${i}:\n     old: …${A.text.slice(Math.max(0, i - 60), i + 120)}\n     new: …${B.text.slice(Math.max(0, i - 60), i + 120)}`);
  } else console.log('   text: identical');
  if (tagDiff) console.log(`   tags: ${A.tags.length} → ${B.tags.length}; first diff at ${tagDiff.at}: old [${tagDiff.a}] new [${tagDiff.b}]`);
  else console.log('   tags: identical');
  if (outDir) { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, `${doc.slug}.blocks.json`), JSON.stringify(res, null, 2)); writeFileSync(join(outDir, `${doc.slug}.new.html`), html); }
}
process.exit(failures ? 1 : 0);
