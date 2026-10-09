'use strict';
// Press derive (docs/systems/press.md). content.press.items — the one press
// table, in admin order — feeds every place a story appears:
//   content.blog.articles / .videos      News & Media page (items not hidden)
//   content.homepage.press               homepage cards (featured, first three)
//   content.coverage['<slug>_coverage']  {{coverage:<slug>}} strips (articles of that project)
//   content.projects.projects[].articles / .videos   each hub's press
// Pure; a content map without `press.items` is returned unchanged (older
// content shapes still render). Runs before anything else in buildSite and
// in render-db so the fixed pages' content checks and the document token
// expansion see the derived collections.
const HOMEPAGE_CARDS = 3;
const on = (v) => v === '1' || v === 1 || v === true;
const isVideo = (it) => String(it.type || '') === 'video' || (!it.type && Boolean(it.youtube_id));
const slugOf = (it) => String(it.project_slug || '').trim();

function derivePress(content) {
  const items = content?.press?.items;
  if (!Array.isArray(items)) return content;
  const articles = items.filter(it => !isVideo(it));
  const videos = items.filter(isVideo);
  const projects = content.projects?.projects;
  const slugs = new Set([...(Array.isArray(projects) ? projects.map(p => String(p.slug || '').trim()) : []), ...items.map(slugOf)].filter(Boolean));
  const coverage = {};
  for (const slug of slugs) coverage[`${slug}_coverage`] = articles.filter(it => slugOf(it) === slug);
  return {
    ...content,
    blog: { ...(content.blog || {}), articles: articles.filter(it => !on(it.hide_from_news)), videos: videos.filter(it => !on(it.hide_from_news)) },
    homepage: content.homepage ? { ...content.homepage, press: items.filter(it => on(it.featured)).slice(0, HOMEPAGE_CARDS) } : content.homepage,
    coverage,
    projects: Array.isArray(projects)
      ? { ...content.projects, projects: projects.map(p => { const s = String(p.slug || '').trim(); return { ...p, articles: articles.filter(it => slugOf(it) === s), videos: videos.filter(it => slugOf(it) === s) }; }) }
      : content.projects,
  };
}

module.exports = { HOMEPAGE_CARDS, derivePress };
