'use strict';
// Press (docs/systems/press.md): ONE table for every story about the
// organisation — the project hubs' "In the Press" / "On Television", the
// {{coverage:<project>}} strips inside reports, the News & Media page and the
// homepage cards all derive from it (packages/render/press.js). Pure helpers:
// the field list, flag reading, URL normalisation and the one-time
// unification of the four legacy sources (project articles/videos, coverage
// entries, blog articles/videos, homepage press).
const { parseFreeDate } = require('@uccsite/render/dates');

// Stored as strings like every collection (sanitizeItems); flags are '1' or absent.
const PRESS_FIELDS = ['type', 'outlet', 'badge_color', 'date', 'region', 'headline', 'excerpt', 'url', 'read_more', 'lang_attr',
  'youtube_id', 'embed_params', 'youtube_title', 'project_slug', 'featured', 'hide_from_news'];

const isOn = (v) => v === '1' || v === 1 || v === true;
const isVideo = (item) => String(item.type || '') === 'video' || (!item.type && Boolean(item.youtube_id));

// normalizeUrl('https://www.KSL.com/a/b/?utm_source=x') → 'ksl.com/a/b' — the
// dedupe key. Videos key on their YouTube id instead.
function normalizeUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    const q = u.searchParams.toString();
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${q ? `?${q}` : ''}`;
  } catch { return String(url || '').trim().toLowerCase(); }
}
// youtubeIdFromUrl('https://www.youtube.com/watch?v=ID&t=9' | 'https://youtu.be/ID') → 'ID' | ''
function youtubeIdFromUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    if (host === 'youtube.com' && u.pathname === '/watch') return u.searchParams.get('v') || '';
    if (host === 'youtube.com' && /^\/(embed|live|shorts)\//.test(u.pathname)) return u.pathname.split('/')[2] || '';
  } catch { /* not a URL */ }
  return '';
}
// A video keys on its YouTube id; an article whose link IS a YouTube video keys the same way, so a
// homepage card pointing at the interview merges with the "On Television" entry for it.
const itemKey = (item) => {
  const yt = isVideo(item) ? String(item.youtube_id || '').trim() : youtubeIdFromUrl(item.url);
  return yt ? `yt:${yt}` : `url:${normalizeUrl(item.url)}`;
};

// unifyPress({ projects, blog, coverage, homepagePress }) → { items, report }
// projects: [{ slug, articles: [], videos: [] }]; blog: { articles, videos };
// coverage: { '<slug>_coverage': [] }; homepagePress: []. The same story found
// in several places becomes ONE item: the first source sets the fields, later
// sources fill blanks (the longest excerpt wins), a project source sets
// project_slug, the homepage source sets featured. Sorted newest first.
function unifyPress({ projects = [], blog = {}, coverage = {}, homepagePress = [] } = {}) {
  const items = new Map();
  const report = [];
  const add = (raw, { source, project = '', featured = false, type }) => {
    const incoming = { ...raw };
    if (type) incoming.type = type;
    if (!incoming.type) incoming.type = incoming.youtube_id ? 'video' : 'article';
    if (!incoming.url && !incoming.youtube_id) { report.push(`${source}: skipped "${incoming.headline || '?'}" (no url)`); return; }
    const key = itemKey(incoming);
    const existing = items.get(key);
    if (!existing) {
      items.set(key, { ...incoming, project_slug: project, ...(featured ? { featured: '1' } : {}), _sources: [source] });
      return;
    }
    for (const [k, v] of Object.entries(incoming)) {
      if (v === undefined || v === null || v === '') continue;
      // A story that is a video in any source is a video (it has an embed); an article card pointing at the same YouTube page folds into it.
      if (k === 'type') { if (v === 'video') existing.type = 'video'; continue; }
      if (k === 'excerpt' ? String(v).length > String(existing.excerpt || '').length : !existing[k]) existing[k] = v;
    }
    if (project && !existing.project_slug) existing.project_slug = project;
    if (project && existing.project_slug && existing.project_slug !== project) report.push(`${source}: "${existing.headline}" is listed under both ${existing.project_slug} and ${project} — kept ${existing.project_slug}`);
    if (featured) existing.featured = '1';
    existing._sources.push(source);
  };
  for (const p of projects) {
    for (const a of p.articles || []) add(a, { source: `project ${p.slug} article`, project: p.slug, type: 'article' });
    for (const v of p.videos || []) add(v, { source: `project ${p.slug} video`, project: p.slug, type: 'video' });
  }
  for (const [key, list] of Object.entries(coverage)) {
    const slug = key.replace(/_coverage$/, '');
    for (const e of list || []) add(e, { source: `coverage ${slug}`, project: slug, type: 'article' });
  }
  for (const a of blog.articles || []) add(a, { source: 'news article', type: 'article' });
  for (const v of blog.videos || []) add(v, { source: 'news video', type: 'video' });
  for (const h of homepagePress || []) add(h, { source: 'homepage', featured: true, type: h.youtube_id ? 'video' : 'article' });

  // A row with no project (a video filed only under News & Media, say) whose
  // headline matches a project's story inherits that project.
  const headlineKey = (it) => String(it.headline || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const projectByHeadline = new Map();
  for (const it of items.values()) if (it.project_slug && headlineKey(it)) projectByHeadline.set(headlineKey(it), it.project_slug);
  for (const it of items.values()) {
    if (!it.project_slug && projectByHeadline.has(headlineKey(it))) { it.project_slug = projectByHeadline.get(headlineKey(it)); it._sources.push('project by headline'); }
  }
  const out = [...items.values()].map(({ _sources, ...it }) => {
    const clean = {};
    for (const f of PRESS_FIELDS) if (it[f] !== undefined && it[f] !== null && it[f] !== '') clean[f] = String(it[f]);
    return { item: clean, sources: _sources };
  });
  const ts = (it) => { const t = parseFreeDate(it.date); return Number.isNaN(t) ? -Infinity : t; };
  out.sort((a, b) => ts(b.item) - ts(a.item) || String(a.item.headline).localeCompare(String(b.item.headline)));
  return { items: out.map(o => o.item), sources: out.map(o => o.sources), report };
}

module.exports = { PRESS_FIELDS, isOn, isVideo, normalizeUrl, youtubeIdFromUrl, itemKey, unifyPress };
