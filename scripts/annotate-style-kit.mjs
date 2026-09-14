#!/usr/bin/env node
// annotate-style-kit.mjs — add Style Kit annotations (spec §6.1) to every
// class in css/styles.css that has none. Labels are humanised from the class
// name, `@applies` comes from the tags the class is actually used on across
// templates/ (empty = any), `@group` from the class-name prefix, and `@desc`
// summarises usage + the first declarations. Every generated comment ends
// with "(auto)" so a developer can tell it from a hand-written one and refine
// it. Re-runnable: annotated classes are left alone.
//
// Usage: node scripts/annotate-style-kit.mjs [--dry]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseStyleKit } = require('../packages/style-kit');

const ROOT = join(import.meta.dirname, '..');
const CSS = join(ROOT, 'css', 'styles.css');
const dry = process.argv.includes('--dry');

// Where each class appears: tag names and templates.
const usage = new Map(); // class → { tags: Set, pages: Set }
const scan = (file, label) => {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\sclass="([^"]*)"/gi)) {
    for (const cls of m[2].split(/\s+/).filter(c => c && !c.includes('{'))) {
      const u = usage.get(cls) || { tags: new Set(), pages: new Set() };
      u.tags.add(m[1].toLowerCase()); u.pages.add(label); usage.set(cls, u);
    }
  }
};
for (const f of readdirSync(join(ROOT, 'templates'))) if (f.endsWith('.html')) scan(join(ROOT, 'templates', f), f.replace(/\.html$/, ''));
for (const f of readdirSync(join(ROOT, 'templates', 'partials'))) if (f.endsWith('.html')) scan(join(ROOT, 'templates', 'partials', f), `partial:${f.replace(/\.html$/, '')}`);

const GROUPS = [
  [/^(nav|logo|skip-link|site-header|chevron|scrolled)/, 'Navigation'],
  [/^hero|^scroll-line/, 'Hero'],
  [/^(mission|pillar)/, 'Mission & pillars'],
  [/^(issues?|issue-)/, 'Policy positions'],
  [/^impact/, 'Impact stats'],
  [/^about/, 'About'],
  [/^(join|form|success-icon|check-label|field)/, 'Forms'],
  [/^(footer|site-footer)/, 'Footer'],
  [/^(donate|donation|tracker|tier|toggle-btn|active$)/, 'Donations'],
  [/^modal/, 'Modal'],
  [/^(news|video|outlet|coverage)/, 'News & coverage'],
  [/^(fight|project)/, 'Projects'],
  [/^(subpage|report|briefing|section-label|section-title|section-sub)/, 'Report pages'],
  [/^(btn)/, 'Buttons'],
  [/^(container|section|light$|visible$|open$)/, 'Layout'],
];
const groupFor = (cls) => (GROUPS.find(([re]) => re.test(cls)) || [null, 'Site stylesheet'])[1];
const humanise = (cls) => cls.replace(/^is-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

let css = readFileSync(CSS, 'utf8');
const kit = parseStyleKit(css);
let added = 0;
for (const cls of kit.undocumented) {
  const m = css.match(new RegExp(`^(\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[\\s,{:])`, 'm'));
  if (!m) { console.log('  no bare rule for', cls); continue; }
  const idx = m.index;
  if (/\/\*[^*]*@class\s+\S+[^*]*\*\/\s*$/.test(css.slice(Math.max(0, idx - 500), idx))) continue;
  const u = usage.get(cls);
  const tags = u ? [...u.tags].sort() : [];
  const pages = u ? [...u.pages].sort() : [];
  const entry = kit.entries.find(e => e.className === cls);
  const decl = (entry?.declarations || '').split(' /* + */')[0].replace(/\s+/g, ' ').trim().slice(0, 90);
  const where = pages.length ? `Used on ${tags.map(t => `<${t}>`).join(', ')} in ${pages.slice(0, 4).join(', ')}${pages.length > 4 ? '…' : ''}.` : 'Not used by any template today (script- or state-toggled, or spare).';
  const desc = `${where}${decl ? ` Sets: ${decl}${decl.length >= 90 ? '…' : ''}` : ''} (auto)`;
  const comment = `/* @class ${cls}\n   @label ${humanise(cls)}\n   @applies ${tags.join(' ')}\n   @group ${groupFor(cls)}\n   @desc ${desc.replace(/\*\//g, '* /')} */\n`;
  css = css.slice(0, idx) + comment + css.slice(idx);
  added++;
}
if (!dry) writeFileSync(CSS, css);
const after = parseStyleKit(css);
console.log(`${dry ? '[dry] would add' : 'added'} ${added} annotations; ${after.undocumented.length} still undocumented: ${after.undocumented.join(' ') || '-'}`);
