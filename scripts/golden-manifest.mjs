#!/usr/bin/env node
// golden-manifest.mjs — hash every file in dist/ into a manifest JSON.
// Used once to freeze the pre-port baseline (Phase 1 golden-file tests), and
// re-runnable to diff any later build against it.
//
// Usage: node build.js && node scripts/golden-manifest.mjs [--out path.json]

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx !== -1 ? args[outIdx + 1] : 'packages/render/test/golden-baseline.json';
const DIST = 'dist';

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

const files = {};
for (const f of walk(DIST).sort()) {
  const rel = relative(DIST, f).replace(/\\/g, '/');
  const buf = readFileSync(f);
  files[rel] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  note: 'sitemap.xml hash is machine-dependent (fs-mtime lastmod) - tests treat it as volatile',
  files,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Hashed ${Object.keys(files).length} files -> ${OUT}`);
