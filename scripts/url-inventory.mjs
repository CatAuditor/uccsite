#!/usr/bin/env node
// url-inventory.mjs — crawl the live site and record every URL's SEO-relevant
// state. Output is the baseline the seo-parity-check gate compares against
// (build-spec-aws.md §12, §19 Phase 0). Zero dependencies.
//
// Usage: node scripts/url-inventory.mjs [--base https://utahciviccompact.org] [--out path.json]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const BASE = argVal('--base', 'https://utahciviccompact.org').replace(/\/$/, '');
const OUT = argVal('--out', 'docs/migration/url-inventory.prod.json');

// Pages deliberately excluded from the sitemap but which must not 404 after
// migration, plus non-HTML assets whose presence/bytes matter.
const EXTRA_PATHS = [
  '/tip.html',
  '/success.html',
  // Pages not present in the (stale) production sitemap.xml:
  '/privacy.html',
  '/projects.html',
  '/weber-county.html',
  '/index.html',
  '/robots.txt',
  '/llms.txt',
  '/sitemap.xml',
  '/favicon.svg',
  '/UCC.png',
  '/css/styles.css',
  '/js/main.js',
  '/js/tip.js',
  '/auth', // _redirects rule -> Decap OAuth worker (302); retires Phase 7
];

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : undefined;
}
function findMeta(html, key, value) {
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if ((attr(tag, key) || '').toLowerCase() === value) return attr(tag, 'content');
  }
  return undefined;
}
function findLinkRel(html, relValue) {
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if ((attr(tag, 'rel') || '').toLowerCase() === relValue) return attr(tag, 'href');
  }
  return undefined;
}
function textOf(html, tagName) {
  const m = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : undefined;
}

async function inspect(path) {
  const url = BASE + path;
  const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'ucc-url-inventory/1.0' } });
  const entry = { path, status: res.status, contentType: res.headers.get('content-type') || undefined };
  if (res.status >= 300 && res.status < 400) {
    entry.location = res.headers.get('location') || undefined;
    return entry;
  }
  const type = entry.contentType || '';
  if (type.includes('text/html')) {
    const html = await res.text();
    entry.title = textOf(html, 'title');
    entry.metaDescription = findMeta(html, 'name', 'description');
    entry.metaRobots = findMeta(html, 'name', 'robots');
    entry.canonical = findLinkRel(html, 'canonical');
    entry.ogTitle = findMeta(html, 'property', 'og:title');
    entry.ogDescription = findMeta(html, 'property', 'og:description');
    entry.h1 = textOf(html, 'h1');
    entry.hasJsonLd = /<script[^>]+application\/ld\+json/i.test(html);
    entry.bytes = Buffer.byteLength(html);
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    entry.bytes = buf.length;
  }
  entry.xRobotsTag = res.headers.get('x-robots-tag') || undefined;
  return entry;
}

async function main() {
  const sitemapRes = await fetch(`${BASE}/sitemap.xml`);
  if (!sitemapRes.ok) throw new Error(`sitemap.xml fetch failed: ${sitemapRes.status}`);
  const sitemapXml = await sitemapRes.text();
  const sitemapPaths = [...sitemapXml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
    .map((m) => new URL(m[1]).pathname);

  // Crawl the seed set, then follow same-origin redirects so the inventory
  // records BOTH the redirect (e.g. Cloudflare Pages' /alpr.html -> /alpr 308)
  // and the final page's metadata. Parity must preserve both.
  const queue = [...new Set([...sitemapPaths, ...EXTRA_PATHS])].sort();
  const seen = new Set(queue);
  const entries = [];
  while (queue.length) {
    const p = queue.shift();
    try {
      const entry = await inspect(p);
      entries.push(entry);
      console.log(`${String(entry.status).padEnd(4)} ${p}${entry.location ? ' -> ' + entry.location : ''}`);
      if (entry.location) {
        let next;
        try { next = new URL(entry.location, BASE); } catch { next = null; }
        if (next && next.origin === new URL(BASE).origin && !seen.has(next.pathname)) {
          seen.add(next.pathname);
          queue.push(next.pathname);
        }
      }
    } catch (e) {
      entries.push({ path: p, error: String(e) });
      console.log(`ERR  ${p}: ${e}`);
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const doc = {
    base: BASE,
    crawledAt: new Date().toISOString(),
    sitemapPathCount: sitemapPaths.length,
    entries,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
  console.log(`\nWrote ${entries.length} entries to ${OUT}`);
  const bad = entries.filter((e) => e.error || (e.status >= 400));
  if (bad.length) {
    console.log(`WARNING: ${bad.length} entries errored or 4xx/5xx:`);
    for (const b of bad) console.log(`  ${b.path} -> ${b.error || b.status}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
