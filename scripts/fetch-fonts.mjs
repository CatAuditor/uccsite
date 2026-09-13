#!/usr/bin/env node
// fetch-fonts.mjs — self-host the site's web fonts (build-spec-aws.md §3.2 /
// plan Phase 8: `style-src 'self'`, `font-src 'self'`, no fonts.googleapis /
// fonts.gstatic). Fetches Google Fonts' woff2 CSS for the families the
// templates use, keeps the latin + latin-ext subsets, downloads each file to
// assets/fonts/ and writes css/fonts.css with the same @font-face blocks
// pointing at /assets/fonts/. Re-runnable; commit the result.
//
// Usage: node scripts/fetch-fonts.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'assets', 'fonts');
const CSS_OUT = join(ROOT, 'css', 'fonts.css');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FAMILIES = [
  // site-wide (every template + the document shell)
  'family=Inter:wght@400;500;600;700;800;900&family=Playfair+Display:wght@700;800',
  // dignity-index-statement page CSS
  'family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400',
];
const SUBSETS = new Set(['latin', 'latin-ext']);

mkdirSync(OUT_DIR, { recursive: true });
const blocks = [];
for (const q of FAMILIES) {
  const res = await fetch(`https://fonts.googleapis.com/css2?${q}&display=swap`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fonts.googleapis ${res.status} for ${q}`);
  const css = await res.text();
  const re = /\/\* ([a-z-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g;
  let m;
  while ((m = re.exec(css))) {
    const [, subset, block] = m;
    if (!SUBSETS.has(subset)) continue;
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!url) continue;
    const family = block.match(/font-family: '([^']+)'/)[1].toLowerCase().replace(/\s+/g, '-');
    const weight = block.match(/font-weight: ([^;]+);/)[1].replace(/\s+/g, '-');
    const style = block.match(/font-style: ([^;]+);/)[1];
    const name = `${family}-${weight}-${style}-${subset}-${createHash('sha256').update(url).digest('hex').slice(0, 6)}.woff2`;
    const file = join(OUT_DIR, name);
    if (!existsSync(file)) {
      const f = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!f.ok) throw new Error(`gstatic ${f.status} for ${url}`);
      writeFileSync(file, Buffer.from(await f.arrayBuffer()));
    }
    blocks.push(`/* ${family} ${weight} ${style} ${subset} */\n${block.replace(url, `/assets/fonts/${name}`)}`);
  }
}
const header = `/* Self-hosted web fonts (scripts/fetch-fonts.mjs) — do not edit by hand.\n   Inter + Playfair Display site-wide; IBM Plex Sans + Newsreader for the\n   dignity-index-statement page. latin + latin-ext subsets. */\n`;
writeFileSync(CSS_OUT, header + blocks.join('\n') + '\n');
console.log(`Wrote ${blocks.length} @font-face blocks to css/fonts.css, files in assets/fonts/`);
