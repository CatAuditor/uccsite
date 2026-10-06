// Site assembly ported from build.js: the PAGES manifest, markdown field map,
// derived content, page rendering, and sitemap generation. Pure — callers
// supply templates/partials/content as objects and a lastmod provider.
// Golden-file tests lock output byte-for-byte against the pre-port baseline.
'use strict';

const { render, mdToHtml } = require('./engine');
const { navFields } = require('./navigation');
const { deriveWriting } = require('./writing');

const SITE_URL = 'https://utahciviccompact.org';

// Templates → content file mapping. `sitemap: false` excludes a page (noindex pages).
const PAGES = [
  { template: 'index.html',    content: ['settings', 'homepage', 'projects', 'team'], priority: '1.0' },
  { template: 'team.html',     content: ['settings', 'team'] },
  // Author pages (docs/systems/author-pages.md): ONE template rendered once
  // per team member to team/<slug>.html. `each` names the list on the first
  // content collection; expandPages() turns this entry into N page entries.
  { template: 'team-member.html', content: ['team', 'settings', 'statements', 'projects', 'issues'], each: 'members', dir: 'team' },
  { template: 'blog.html',     content: ['settings', 'blog'] },
  { template: 'statements.html', content: ['settings', 'statements'] },
  // Every published statement, report and paper, newest first (docs/systems/writing.md).
  // content.writing is derived in buildSite, never stored.
  { template: 'writing.html',    content: ['settings', 'writing'], priority: '0.8' },
  { template: 'issues.html',   content: ['settings', 'issues'] },
  { template: 'privacy-report.html', content: ['settings'] },
  { template: 'projects.html', content: ['settings', 'projects'] },
  { template: 'stratos.html',      content: ['settings', 'coverage'] },
  { template: 'weber-county.html', content: ['settings'] },
  { template: 'alpr.html',         content: ['settings', 'coverage'], priority: '0.9' },
  { template: 'how-did-this-happen.html', content: ['settings'] },
  { template: 'dignity-index-statement.html', content: ['settings'] },
  { template: 'theory.html',       content: ['settings'] },
  { template: 'tip.html',          content: ['settings'], sitemap: false },
  // Petition campaign (docs/systems/petition.md): copy lives in homepage.petition.
  { template: 'petition.html',        content: ['settings', 'homepage'], priority: '0.9' },
  { template: 'petition-thanks.html', content: ['settings', 'homepage'], sitemap: false },
  { template: 'privacy.html',      content: ['settings'], priority: '0.3' },
  { template: 'success.html',  content: ['settings'], sitemap: false },
  { template: '404.html',      content: ['settings'], sitemap: false },
];

// Array → field containing markdown that must be converted to HTML before render
const MARKDOWN_FIELDS = { members: 'bio', statements: 'body', issues: 'body' };

// The homepage's featured statements are the newest HOMEPAGE_FEATURED entries
// of statements.json (not stored twice). Returns a NEW homepage object — inputs
// are not mutated. `url`/`more` feed each card's link and read-more line
// (templates/index.html); optional per-statement overrides let a card point at a
// standalone page (e.g. the Dignity Index statement) — see
// docs/decisions/homepage-statement-links.md.
const HOMEPAGE_FEATURED = 3;

function deriveHomepage(content) {
  if (!content.homepage) return content;
  const statements = (content.statements?.statements || []).slice(0, HOMEPAGE_FEATURED)
    .map(({ slug, date, title, snippet, url, more }) => ({
      slug, date, title, snippet,
      url: url || `/statements.html#${slug}`,
      more: more || 'Read the full statement →',
    }));
  return { ...content, homepage: { ...content.homepage, statements } };
}

// Petition share links (docs/systems/petition.md "Sharing"). Built at render
// time, not in the browser, so every button works with JavaScript off and the
// preview tags (og:image) are in the HTML that Facebook, iMessage and X fetch.
// Text: share_text, else the headline with its <em> markup stripped. Image: a
// site path to a png/jpg/webp under /media or /assets (1200×630 → large card),
// else the logo as a small card. Absent when the petition is switched off.
const SHARE_IMAGE = /^\/(media|assets)\/[\w./-]+\.(png|jpe?g|webp)$/i;
function derivePetitionShare(content, siteUrl = SITE_URL) {
  const p = content.homepage && content.homepage.petition;
  if (!p || !String(p.headline || '').trim()) return content;
  const e = encodeURIComponent;
  const url = `${siteUrl}/petition`;
  const text = String(p.share_text || p.headline).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const custom = SHARE_IMAGE.test(String(p.share_image || '').trim());
  const share = {
    title: p.share_title || 'Share the petition',
    url, text,
    image: custom ? `${siteUrl}${String(p.share_image).trim()}` : `${siteUrl}/UCC.png`,
    card: custom ? 'summary_large_image' : 'summary',
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`,
    x: `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}`,
    bluesky: `https://bsky.app/intent/compose?text=${e(`${text} ${url}`)}`,
    sms: `sms:?&body=${e(`${text} ${url}`)}`,
    email: `mailto:?subject=${e(text)}&body=${e(`${text}\n\n${url}`)}`,
  };
  return { ...content, homepage: { ...content.homepage, petition: { ...p, share, donate: petitionDonate(p) } } };
}

// Thank-you page payment modal (docs/systems/petition.md "Donation ask"), all
// from the admin's Petition page. Amounts are typed as dollars ("5, 10, 25");
// anything outside $1–$100,000 (the API's bounds) is dropped, at most six are
// kept, and an empty or unreadable list falls back to $10/$25/$50/$100.
// Frequency: "both" (default), "one-time" or "monthly". An "Other" button
// with a free amount is always offered.
const DONATE_FALLBACK = [10, 25, 50, 100];
function petitionDonate(p) {
  const dollars = [...new Set(String(p.donate_amounts || '').split(/[,\s]+/)
    .map((x) => Math.round(Number(x.replace(/[$]/g, ''))))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 100000))].slice(0, 6);
  const amounts = dollars.length ? dollars : DONATE_FALLBACK;
  const wanted = Math.round(Number(String(p.donate_default || '').replace(/[$]/g, '')));
  const preset = amounts.includes(wanted) ? wanted : (amounts.includes(25) ? 25 : amounts[0]);
  const f = String(p.donate_frequency || 'both').toLowerCase();
  const monthlyOnly = /month/.test(f) && !/one|both/.test(f);
  const onetimeOnly = /one/.test(f) && !/month|both/.test(f);
  const startMonthly = monthlyOnly || (!onetimeOnly && /month/.test(String(p.donate_default_frequency || '').toLowerCase()));
  const type = startMonthly ? 'subscription' : 'onetime';
  return {
    title: p.donate_title || 'Carry this fight through the legislature',
    body: p.donate_body || "Choose an amount. You'll finish on our secure Stripe checkout page.",
    tiers: amounts.map((d) => ({ cents: d * 100, label: `$${d.toLocaleString('en-US')}`, active: d === preset, per: startMonthly ? '/mo' : '' })),
    type, toggle: !monthlyOnly && !onetimeOnly, monthly: startMonthly, onetime: !startMonthly,
    customLabel: p.donate_custom_label || 'Other',
    button: p.donate_button || 'Continue to checkout',
    publicLabel: p.donate_public_label || 'Show my first name and amount on the public donor list',
  };
}

// withColorClasses(content) → { content, colorsCss }
// Content carries badge_color / status_color hex values; templates used to
// paint them with inline style attributes, which CSP style-src 'self'
// forbids. Every such value gets a sibling badge_class / status_class
// ('c-<hex>') and one generated stylesheet (css/colors.css) declares them.
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function withColorClasses(content) {
  const colors = new Set();
  const visit = (v) => {
    if (Array.isArray(v)) return v.map(visit);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = visit(val);
    for (const key of ['badge_color', 'status_color']) {
      const hex = typeof out[key] === 'string' && HEX.test(out[key].trim()) ? out[key].trim().toLowerCase() : null;
      if (hex) { colors.add(hex); out[key.replace('_color', '_class')] = `c-${hex.slice(1)}`; }
      else if (out[key]) out[key.replace('_color', '_class')] = '';
    }
    // lang_attr was rendered RAW ({{{lang_attr}}}) — a free-text attribute
    // sink. It is now parsed into a validated BCP-47-ish code (`lang`) and
    // the templates render lang="{{lang}}"; anything else renders nothing.
    if ('lang_attr' in out) {
      const m = typeof out.lang_attr === 'string' && out.lang_attr.trim().match(/^lang="([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)"$/);
      out.lang = m ? m[1] : '';
    }
    return out;
  };
  const derived = visit(content);
  const colorsCss = '/* Generated from content badge_color / status_color values (packages/render/site.js). */\n'
    + [...colors].sort().map(c => `.c-${c.slice(1)} { background: ${c}; }`).join('\n') + '\n';
  return { content: derived, colorsCss };
}

const { parseFreeDate } = require('./dates');

// deriveProjectFilters(content) → content with project_statuses /
// project_regions (distinct, in first-seen order) and per-project date_ts
// (Date.parse of the free-text date, '' when unparseable) for the projects
// page's client-side filter/sort controls (js/projects.js).
function deriveProjectFilters(content) {
  const projects = content.projects?.projects;
  if (!Array.isArray(projects)) return content;
  const uniq = (key) => [...new Set(projects.map(p => (p[key] || '').trim()).filter(Boolean))].map(value => ({ value }));
  return {
    ...content,
    projects: {
      ...content.projects,
      projects: projects.map(p => {
        const ts = parseFreeDate(p.date);
        // *_key: trimmed values the data attributes carry, so they match the
        // option lists exactly even for content loaded verbatim from JSON.
        return { ...p, date_ts: Number.isNaN(ts) ? '' : String(ts), status_key: (p.status || '').trim(), region_key: (p.region || '').trim() };
      }),
      project_statuses: uniq('status'),
      project_regions: uniq('region'),
    },
  };
}

// deriveProjectFiles(content) → every project gets `files`: the published
// project files for its slug from content.project_files ({ slug → [file] },
// supplied by the DB render path — aws/publish/render-db.js; the git/local
// build has none, so files is [] and the template emits nothing).
function deriveProjectFiles(content) {
  const projects = content.projects?.projects;
  if (!Array.isArray(projects)) return content;
  const bySlug = content.project_files || {};
  return {
    ...content,
    projects: {
      ...content.projects,
      projects: projects.map(p => ({ ...p, files: bySlug[(p.slug || '').trim()] || [] })),
    },
  };
}

// ── Author pages (docs/systems/author-pages.md) ──────────────────────────────
// slugify('Jarom Gillins') → 'jarom-gillins'. A member's explicit `slug`
// wins; the name is the fallback so no editor action is needed for a page.
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function memberSlug(m) { return slugify(m.slug) || slugify(m.name); }

// authorIndex(members, siteUrl) → { name → { slug, url, id } } for byline
// links and JSON-LD @id references. The Person @id is the author page URL +
// '#person' — ONE identifier every Article on the site points at, so search
// engines merge the author into a single entity.
function authorIndex(members, siteUrl = SITE_URL) {
  const idx = {};
  for (const m of members || []) {
    if (!m.name) continue;
    const slug = memberSlug(m);
    idx[m.name.trim()] = { slug, url: `/team/${slug}`, id: `${siteUrl}/team/${slug}#person` };
  }
  return idx;
}

// "/alpr.html" | "/alpr" | "/statements.html#slug" → "/alpr" | "/statements#slug"
const cleanUrl = (u) => String(u || '').replace(/\.html(?=$|[#?])/, '');
const firstParagraph = (md) => String(md || '').trim().split(/\n{2,}/)[0].replace(/\*\*|\*|\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
const jsonForScript = (v) => JSON.stringify(v, null, 2).replace(/</g, '\\u003c');

// deriveTeam(content, siteUrl) → NEW content:
//   team.members[]  + slug, page_url, photo_abs, links[] ({url}), works[]
//                     ({title, date, url, kind}), meta_description, jsonld
//   statements/projects/issues items + author_url ('' when the author is not
//                     a team member → templates render a plain name)
//   team.org_members_json / team.org_sameas_json  fragments for the homepage
//                     Organization JSON-LD
// Works are everything on the site whose `author` equals the member's name:
// statements, projects, issue positions and, on the database render,
// content.documents_index ({slug, title, author, date, category} — supplied
// by aws/publish/render-db.js; the git build has none). Deduped by URL
// (a project and its Document report share one).
function deriveTeam(content, siteUrl = SITE_URL) {
  const members = content.team?.members;
  if (!Array.isArray(members)) return content;
  const idx = authorIndex(members, siteUrl);
  const linkAuthors = (items) => Array.isArray(items)
    ? items.map(it => ({ ...it, author_url: idx[String(it.author || '').trim()]?.url || '' }))
    : items;

  const statements = content.statements?.statements || [];
  const projects = content.projects?.projects || [];
  const issues = content.issues?.issues || [];
  const documents = Array.isArray(content.documents_index) ? content.documents_index : [];

  const derivedMembers = members.map(m => {
    const name = String(m.name || '').trim();
    const slug = memberSlug(m);
    const page_url = `/team/${slug}`;
    const byAuthor = (it) => String(it.author || '').trim() === name;
    const works = [];
    const seen = new Set();
    const add = (w) => {
      const url = cleanUrl(w.url);
      if (!url || seen.has(url)) return;
      seen.add(url);
      works.push({ ...w, url });
    };
    for (const p of projects.filter(byAuthor)) add({ title: p.name, date: p.date || '', url: p.cta_url, kind: 'Investigation' });
    for (const d of documents.filter(byAuthor)) add({ title: d.title, date: d.date || '', url: `/${d.slug}`, kind: d.category || 'Report' });
    for (const s of statements.filter(byAuthor)) add({ title: s.title, date: s.date || '', url: s.url || `/statements#${s.slug}`, kind: 'Statement' });
    for (const i of issues.filter(byAuthor)) add({ title: i.title, date: '', url: `/issues#${i.slug}`, kind: 'Policy position' });

    const links = String(m.links || '').split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s)).map(url => ({ url }));
    const photo_abs = m.photo ? (/^https?:/i.test(m.photo) ? m.photo : `${siteUrl}${m.photo}`) : '';
    const meta_description = firstParagraph(m.bio).slice(0, 300) || `${name}, ${m.title || ''} at Utah Civic Compact.`;
    const person = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url: `${siteUrl}${page_url}`,
      name,
      mainEntity: {
        '@type': 'Person',
        '@id': `${siteUrl}${page_url}#person`,
        name,
        url: `${siteUrl}${page_url}`,
        jobTitle: m.title || undefined,
        description: meta_description,
        image: photo_abs || undefined,
        worksFor: { '@type': 'Organization', name: 'Utah Civic Compact', url: siteUrl },
        affiliation: { '@type': 'Organization', name: 'Utah Civic Compact', url: siteUrl },
        sameAs: links.length ? links.map(l => l.url) : undefined,
      },
      hasPart: works.map(w => ({
        '@type': w.kind === 'Statement' ? 'Article' : 'Report',
        headline: w.title,
        url: `${siteUrl}${w.url}`,
        author: { '@id': `${siteUrl}${page_url}#person` },
      })),
    };
    return { ...m, slug, page_url, photo_abs, links, works, has_links: links.length > 0, has_works: works.length > 0, meta_description, jsonld: jsonForScript(person) };
  });

  const org_members_json = JSON.stringify(derivedMembers.map(m => ({
    '@type': 'Person', '@id': `${siteUrl}${m.page_url}#person`, name: m.name, jobTitle: m.title || undefined, url: `${siteUrl}${m.page_url}`,
  })), null, 2).replace(/</g, '\\u003c').replace(/\n/g, '\n    ');
  const org_sameas_json = JSON.stringify([content.settings?.instagram].filter(Boolean));

  return {
    ...content,
    team: { ...content.team, members: derivedMembers, org_members_json, org_sameas_json },
    statements: content.statements ? { ...content.statements, statements: linkAuthors(statements) } : content.statements,
    projects: content.projects ? { ...content.projects, projects: linkAuthors(projects) } : content.projects,
    issues: content.issues ? { ...content.issues, issues: linkAuthors(issues) } : content.issues,
  };
}

// expandPages(pages, content) → pages with every `each` entry replaced by one
// entry per list item: { template: 'team/<slug>.html', source: 'team-member.html',
// item, content, priority }. Callers' lastmod providers read `source` for the
// template file and `content` for the collections, as for fixed pages.
function expandPages(pages, content) {
  const out = [];
  for (const p of pages) {
    if (!p.each) { out.push(p); continue; }
    const list = content[p.content[0]]?.[p.each];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item.slug) continue;
      out.push({ ...p, each: undefined, template: `${p.dir}/${item.slug}.html`, source: p.template, item });
    }
  }
  return out;
}

// buildSite({ templates, partials, content, lastmod, pages?, siteUrl? })
//   templates: { 'index.html' → template string } — must cover every PAGES entry
//   partials:  { 'header' → string, ... }
//   content:   { 'settings' → object, ... } — parsed JSON per collection
//   lastmod:   (page) => 'YYYY-MM-DD' — injected so CI/Lambda don't depend on fs mtimes
// Returns { files: { 'index.html' → html, 'sitemap.xml' → xml }, errors: [] }.
// Fail-fast contract matches build.js: on any error, callers must write nothing.
// sitemapExtra: additional { template, priority, sitemap } entries (Documents
// rendered by packages/render/documents.js) that belong in the same sitemap.
function buildSite({ templates, partials, content, lastmod, pages = PAGES, siteUrl = SITE_URL, sitemapExtra = [] }) {
  const errors = [];
  const fail = (msg) => errors.push(msg);
  // Derived page data that no content file carries (filled in below).
  content = { ...content, writing: content.writing || {} };

  for (const { template, content: names } of pages) {
    if (!(template in templates)) fail(`Template not found: ${template}`);
    for (const name of names) {
      if (!(name in content)) fail(`${template} needs content/${name}.json, which is missing`);
    }
  }
  if (errors.length) return { files: {}, errors };

  const colored = withColorClasses(content);
  const teamed = deriveTeam(deriveProjectFiles(deriveProjectFilters(derivePetitionShare(deriveHomepage(colored.content), siteUrl))), siteUrl);
  const authors = authorIndex(teamed.team?.members || [], siteUrl);
  // Wrapped like every content file ({ statements: { statements: [...] } }): a
  // page's data merges each content object's keys, so the template reads writing.items.
  const derived = { ...teamed, writing: { writing: deriveWriting(teamed, (name) => authors[String(name || '').trim()]?.url || '') } };
  const expanded = expandPages(pages, derived);

  const files = { 'css/colors.css': colored.colorsCss };
  for (const { template, source, item, content: names } of expanded) {
    // Expanded pages (team/<slug>.html) take nav state from their directory
    // ('team') and get the item's fields merged on top of the collections.
    const page = (source ? template.split('/')[0] : template).replace(/\.html$/, '');
    const data = Object.assign(
      { page, is_home: page === 'index', current: { [page]: true } }, // used by partials for nav state
      navFields(derived.settings, page), // header + footer menus (docs/systems/navigation.md)
      ...names.map(n => derived[n]),
      item ? { ...item, bio: mdToHtml(item.bio) } : {}
    );

    for (const [arrayKey, field] of Object.entries(MARKDOWN_FIELDS)) {
      if (Array.isArray(data[arrayKey])) {
        data[arrayKey] = data[arrayKey].map(item => ({ ...item, [field]: mdToHtml(item[field]) }));
      }
    }

    files[template] = render(templates[source || template], data, partials, fail);
  }
  if (errors.length) return { files: {}, errors };

  files['sitemap.xml'] = makeSitemap([...expanded, ...sitemapExtra], lastmod, siteUrl);
  return { files, errors };
}

function makeSitemap(pages, lastmod, siteUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schema/sitemap/0.9">
${pages.filter(p => p.sitemap !== false).map(p => {
  // Clean URLs: the live site serves pages extensionless (Cloudflare Pages
  // 308s *.html → clean; CloudFront reproduces that). Sitemap lists the
  // canonical clean form (spec addenda 10/12).
  const loc = p.template === 'index.html' ? `${siteUrl}/` : `${siteUrl}/${p.template.replace(/\.html$/, '')}`;
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod(p)}</lastmod>\n    <priority>${p.priority || '0.7'}</priority>\n  </url>`;
}).join('\n')}
</urlset>
`;
}

module.exports = {
  PAGES, MARKDOWN_FIELDS, SITE_URL, deriveHomepage, deriveProjectFilters, deriveProjectFiles, withColorClasses, buildSite, makeSitemap,
  slugify, memberSlug, authorIndex, deriveTeam, expandPages, derivePetitionShare, petitionDonate,
};
