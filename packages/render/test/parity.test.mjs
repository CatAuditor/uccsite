// Phase 1 golden-file tests (build-spec-aws.md §4.1): the ported engine's
// output must be byte-identical to the pre-port build.js baseline, except for
// paths named in expected-diffs.json — each of which must actually differ and
// carry a reason. sitemap.xml is volatile (lastmod source) and is asserted
// structurally instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSite, PAGES } = require('../index.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const baseline = JSON.parse(readFileSync(join(HERE, 'golden-baseline.json'), 'utf8'));
const expectedDiffsPath = join(HERE, 'expected-diffs.json');
const expectedDiffs = existsSync(expectedDiffsPath)
  ? JSON.parse(readFileSync(expectedDiffsPath, 'utf8'))
  : {};

function loadInputs() {
  const content = {};
  for (const f of readdirSync(join(ROOT, 'content'))) {
    if (f.endsWith('.json')) content[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(ROOT, 'content', f), 'utf8'));
  }
  const templates = {};
  for (const { template } of PAGES) {
    templates[template] = readFileSync(join(ROOT, 'templates', template), 'utf8');
  }
  const partials = {};
  for (const f of readdirSync(join(ROOT, 'templates', 'partials'))) {
    if (f.endsWith('.html')) partials[f.replace(/\.html$/, '')] = readFileSync(join(ROOT, 'templates', 'partials', f), 'utf8');
  }
  return { templates, partials, content };
}

const FIXED_LASTMOD = () => '2026-09-12';

test('buildSite renders with no errors', () => {
  const { files, errors } = buildSite({ ...loadInputs(), lastmod: FIXED_LASTMOD });
  assert.deepEqual(errors, []);
  assert.equal(Object.keys(files).length, PAGES.length + 1); // pages + sitemap.xml
});

test('rendered pages match the golden baseline byte-for-byte (except named diffs)', () => {
  const { files } = buildSite({ ...loadInputs(), lastmod: FIXED_LASTMOD });
  const unexpected = [];
  for (const [name, html] of Object.entries(files)) {
    if (name === 'sitemap.xml') continue; // volatile: asserted structurally below
    const base = baseline.files[name];
    if (!base) {
      if (!(name in expectedDiffs)) unexpected.push(`${name}: NEW file not in expected-diffs.json`);
      continue;
    }
    const hash = createHash('sha256').update(html).digest('hex');
    if (hash !== base.sha256 && !(name in expectedDiffs)) {
      unexpected.push(`${name}: differs from baseline but not in expected-diffs.json`);
    }
    if (hash === base.sha256 && name in expectedDiffs) {
      unexpected.push(`${name}: in expected-diffs.json but identical to baseline — stale entry`);
    }
  }
  assert.deepEqual(unexpected, []);
});

test('every baseline page is still produced', () => {
  const { files } = buildSite({ ...loadInputs(), lastmod: FIXED_LASTMOD });
  const missing = Object.keys(baseline.files)
    .filter(n => n.endsWith('.html') && !n.includes('/')) // rendered pages live at dist root
    .filter(n => !(n in files) && !(expectedDiffs[n] === 'removed'));
  assert.deepEqual(missing, []);
});

test('sitemap: structure, exclusions, priorities, injected lastmod', () => {
  const { files } = buildSite({ ...loadInputs(), lastmod: FIXED_LASTMOD });
  const xml = files['sitemap.xml'];
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  // tip + success excluded
  assert.ok(!locs.some(l => /tip|success/.test(l)), 'tip/success must not be in the sitemap');
  assert.equal(locs.length, PAGES.filter(p => p.sitemap !== false).length);
  assert.ok(locs.includes('https://utahciviccompact.org/'));
  // injected lastmod used verbatim
  assert.ok(xml.includes('<lastmod>2026-09-12</lastmod>'));
  // priorities preserved
  assert.match(xml, /<priority>1\.0<\/priority>/);
  assert.match(xml, /<priority>0\.9<\/priority>/);
  assert.match(xml, /<priority>0\.3<\/priority>/);
});

test('fail-fast: missing content aborts with no files', () => {
  const inputs = loadInputs();
  delete inputs.content.settings;
  const { files, errors } = buildSite({ ...inputs, lastmod: FIXED_LASTMOD });
  assert.ok(errors.length > 0);
  assert.deepEqual(files, {});
});

test('fail-fast: missing partial aborts with no files', () => {
  const inputs = loadInputs();
  delete inputs.partials.header;
  const { files, errors } = buildSite({ ...inputs, lastmod: FIXED_LASTMOD });
  assert.ok(errors.some(e => /Partial not found: header/.test(e)));
  assert.deepEqual(files, {});
});

test('fail-fast: unclosed section aborts', () => {
  const inputs = loadInputs();
  inputs.templates['index.html'] = '{{#press}} never closed';
  const { files, errors } = buildSite({ ...inputs, lastmod: FIXED_LASTMOD });
  assert.ok(errors.some(e => /Unclosed section/.test(e)));
  assert.deepEqual(files, {});
});

test('derived content does not mutate input content', () => {
  const inputs = loadInputs();
  const before = JSON.stringify(inputs.content.homepage);
  buildSite({ ...inputs, lastmod: FIXED_LASTMOD });
  assert.equal(JSON.stringify(inputs.content.homepage), before);
});
