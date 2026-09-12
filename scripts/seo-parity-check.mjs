#!/usr/bin/env node
// seo-parity-check.mjs — compare a target environment against a committed
// url-inventory baseline. FAILS (exit 1) if any previously-200 URL now 404s or
// loses/changes SEO metadata, unless the diff is named in an exceptions file.
// This is the migration gate from build-spec-aws.md §12/§19. Zero dependencies.
//
// Usage:
//   node scripts/seo-parity-check.mjs --target https://staging.example.com \
//     [--inventory docs/migration/url-inventory.prod.json] \
//     [--exceptions docs/migration/parity-exceptions.json] \
//     [--basic-auth user:pass]
//
// Exceptions file shape: { "/path.html": ["title", "h1"], "/other.html": ["*"] }
// — listed fields (or "*" for any) are allowed to differ for that path.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const TARGET = (argVal('--target', '') || '').replace(/\/$/, '');
if (!TARGET) { console.error('--target required'); process.exit(2); }
const INVENTORY = argVal('--inventory', 'docs/migration/url-inventory.prod.json');
const EXCEPTIONS_PATH = argVal('--exceptions', '');
const BASIC = argVal('--basic-auth', '');

const baseline = JSON.parse(readFileSync(INVENTORY, 'utf8'));
const exceptions = EXCEPTIONS_PATH ? JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8')) : {};

const COMPARED_FIELDS = ['title', 'metaDescription', 'metaRobots', 'canonical', 'ogTitle', 'ogDescription', 'h1', 'hasJsonLd'];

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : undefined;
}
function findMeta(html, key, value) {
  const re = /<meta\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    if ((attr(m[0], key) || '').toLowerCase() === value) return attr(m[0], 'content');
  }
  return undefined;
}
function findLinkRel(html, relValue) {
  const re = /<link\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    if ((attr(m[0], 'rel') || '').toLowerCase() === relValue) return attr(m[0], 'href');
  }
  return undefined;
}
function textOf(html, tagName) {
  const m = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : undefined;
}
// Canonicals may legitimately be absolute to different hosts between envs —
// compare path-only when both parse as URLs.
function normCanonical(v) {
  if (!v) return v;
  try { return new URL(v).pathname; } catch { return v; }
}

async function inspect(path) {
  const headers = { 'user-agent': 'ucc-seo-parity/1.0' };
  if (BASIC) headers.authorization = 'Basic ' + Buffer.from(BASIC).toString('base64');
  const res = await fetch(TARGET + path, { redirect: 'manual', headers });
  const entry = { status: res.status };
  if (res.status >= 300 && res.status < 400) {
    entry.location = res.headers.get('location') || undefined;
    return entry;
  }
  if ((res.headers.get('content-type') || '').includes('text/html')) {
    const html = await res.text();
    entry.title = textOf(html, 'title');
    entry.metaDescription = findMeta(html, 'name', 'description');
    entry.metaRobots = findMeta(html, 'name', 'robots');
    entry.canonical = findLinkRel(html, 'canonical');
    entry.ogTitle = findMeta(html, 'property', 'og:title');
    entry.ogDescription = findMeta(html, 'property', 'og:description');
    entry.h1 = textOf(html, 'h1');
    entry.hasJsonLd = /<script[^>]+application\/ld\+json/i.test(html);
  }
  return entry;
}

function allowed(path, field) {
  const ex = exceptions[path];
  return !!ex && (ex.includes('*') || ex.includes(field));
}

async function main() {
  const failures = [];
  let checked = 0;
  for (const base of baseline.entries) {
    if (base.error) continue;
    const path = base.path;
    let cur;
    try {
      cur = await inspect(path);
    } catch (e) {
      failures.push(`${path}: fetch failed: ${e}`);
      continue;
    }
    checked++;

    if (base.status !== cur.status && !allowed(path, 'status')) {
      failures.push(`${path}: status ${base.status} -> ${cur.status}`);
      continue; // downstream field diffs are noise once status differs
    }
    if (base.status >= 300 && base.status < 400) {
      if (base.location !== cur.location && !allowed(path, 'location')) {
        failures.push(`${path}: redirect ${base.location} -> ${cur.location}`);
      }
      continue;
    }
    for (const f of COMPARED_FIELDS) {
      if (!(f in base)) continue;
      let a = base[f], b = cur[f];
      if (f === 'canonical') { a = normCanonical(a); b = normCanonical(b); }
      if (a !== b && !allowed(path, f)) {
        failures.push(`${path}: ${f} ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      }
    }
  }

  console.log(`Checked ${checked} URLs against ${INVENTORY} (target ${TARGET})`);
  if (failures.length) {
    console.log(`\nPARITY FAILURES (${failures.length}):`);
    for (const f of failures) console.log('  ' + f);
    process.exit(1);
  }
  console.log('Parity OK.');
}

main().catch((e) => { console.error(e); process.exit(2); });
