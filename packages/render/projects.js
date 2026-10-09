'use strict';
// The project tree (docs/decisions/project-tree-nested-urls.md, docs/systems/projects.md).
// Pure: which project a Document belongs to, every project's path and URL,
// every document's URL, the tree validation the admin save runs, and the
// derive step that gives each project its hub-page data.
//
//   project  alpr              → /projects/alpr            (path 'alpr')
//   project  alpr/records      → /projects/alpr/records    (parent_slug 'alpr')
//   document weber-county @alpr → /projects/alpr/weber-county
//   document theory (no project) → /theory
const { mdToHtml } = require('./engine');

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_DEPTH = 2;

const slugOf = (p) => String((p && (p.slug ?? p.projectSlug)) || '').trim();
const parentOf = (p) => String((p && (p.parent_slug ?? p.parentSlug)) || '').trim();

// projectOf({ projectSlug }, projects) → project | null. The document's
// project_slug names it; a blank or unknown slug nests nowhere. (Until
// 2026-10-09 a project's CTA pointing at the page was a fallback; the
// migration backfilled project_slug, so the fallback is gone.)
function projectOf(doc, projects = []) {
  const explicit = String(doc?.projectSlug || '').trim();
  if (!explicit) return null;
  return projects.find(p => slugOf(p) === explicit) || null;
}

// projectPath(project | slug, projects) → 'alpr' | 'alpr/records' | '' (unknown).
function projectPath(project, projects = []) {
  const p = typeof project === 'string' ? projects.find(x => slugOf(x) === project.trim()) : project;
  if (!p) return '';
  const parent = parentOf(p) && projects.find(x => slugOf(x) === parentOf(p));
  return parent && parent !== p ? `${slugOf(parent)}/${slugOf(p)}` : slugOf(p);
}
const projectUrl = (project, projects) => { const path = projectPath(project, projects); return path ? `/projects/${path}` : '/projects'; };

// documentUrl(doc, projects) → '/projects/<path>/<slug>' | '/<slug>'. A
// document whose project no longer exists renders at the root (it is not lost).
function documentUrl(doc, projects = []) {
  const slug = String(doc?.slug || '').trim();
  const path = projectPath(projectOf(doc, projects), projects);
  return path ? `/projects/${path}/${slug}` : `/${slug}`;
}

// projectAnchor(slug) → the id of the project's card on /projects (kept so
// links to /projects#project-<slug> from before the hub pages still land).
const projectAnchor = (slug) => `project-${String(slug || '').trim()}`;

// validateProjectTree(projects) → [] | ['message', …]. Every slug well
// formed and unique, every parent a known project, no self-parenting, depth
// at most MAX_DEPTH (a sub-project cannot have children).
function validateProjectTree(projects = []) {
  const errors = [];
  const seen = new Map();
  for (const p of projects) {
    const slug = slugOf(p);
    if (!SLUG_RE.test(slug)) { errors.push(`Project "${p?.name || slug || '(blank)'}": slug must be lowercase letters, digits and dashes`); continue; }
    if (seen.has(slug)) errors.push(`Two projects share the slug "${slug}"`);
    seen.set(slug, p);
  }
  for (const p of projects) {
    const slug = slugOf(p);
    const parent = parentOf(p);
    if (!parent) continue;
    if (parent === slug) { errors.push(`Project "${slug}" cannot be its own parent`); continue; }
    const pp = seen.get(parent);
    if (!pp) { errors.push(`Project "${slug}": parent "${parent}" is not a project`); continue; }
    if (parentOf(pp)) errors.push(`Project "${slug}": "${parent}" is already a sub-project (projects nest ${MAX_DEPTH} levels)`);
  }
  return errors;
}

// Site-facing shape of a document list entry under a project.
const docEntry = (d) => ({ title: d.title, url: d.url || `/${d.slug}`, category: d.category || '', summary: d.summary || '', date: d.date || '' });

// Documents grouped by category, categories in first-seen order.
function groupByCategory(docs) {
  const groups = new Map();
  for (const d of docs) {
    const key = d.category || 'Documents';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(docEntry(d));
  }
  return [...groups].map(([category, documents]) => ({ category, documents }));
}

// deriveProjectTree(content, siteUrl) → content where every project carries
//   path, url, depth, anchor, parent_name/parent_url (sub-projects),
//   children [{ name, url, status, status_class, tagline }],
//   documents [entries] + document_groups [{ category, documents }] (from
//   content.documents_index — DB render only; the git build has none, so
//   both are empty), summary_html, breadcrumbs, jsonld (CollectionPage +
//   BreadcrumbList) for templates/project.html,
// and content.projects.top_projects: the top-level projects in admin order
// (the /projects index and the homepage cards; sub-projects live on their
// parent's hub). Runs after deriveProjectFiles so `files` is already there.
function deriveProjectTree(content, siteUrl = 'https://utahciviccompact.org') {
  const projects = content.projects?.projects;
  if (!Array.isArray(projects)) return content;
  const index = Array.isArray(content.documents_index) ? content.documents_index : [];
  const bySlug = new Map(projects.map(p => [slugOf(p), p]));
  const card = (p) => ({ name: p.name, url: projectUrl(p, projects), status: p.status || '', status_class: p.status_class || '', tagline: p.tagline || '', region: p.region || '', date: p.date || '' });

  const derived = projects.map(p => {
    const slug = slugOf(p);
    const path = projectPath(p, projects);
    const url = projectUrl(p, projects);
    const parent = parentOf(p) ? bySlug.get(parentOf(p)) : null;
    const children = projects.filter(c => parentOf(c) === slug).map(card);
    const docs = index.filter(d => String(d.projectSlug || '').trim() === slug).map(d => ({ ...d, url: d.url || documentUrl(d, projects) }));
    const crumbs = [{ name: 'Projects', url: '/projects' }, ...(parent ? [{ name: parent.name, url: projectUrl(parent, projects) }] : []), { name: p.name, url }];
    const jsonld = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          '@id': `${siteUrl}${url}`,
          name: p.name,
          description: p.tagline || undefined,
          url: `${siteUrl}${url}`,
          ...(parent ? { isPartOf: { '@type': 'CollectionPage', '@id': `${siteUrl}${projectUrl(parent, projects)}`, name: parent.name } } : {}),
          hasPart: [...children.map(c => ({ '@type': 'CollectionPage', name: c.name, url: `${siteUrl}${c.url}` })),
            ...docs.map(d => ({ '@type': 'Report', headline: d.title, url: `${siteUrl}${d.url}` }))],
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${siteUrl}${c.url}` })),
        },
      ],
    };
    return {
      ...p,
      path, url, depth: parent ? 2 : 1, anchor: projectAnchor(slug), is_sub: Boolean(parent),
      parent_name: parent ? parent.name : '', parent_url: parent ? projectUrl(parent, projects) : '',
      children, has_children: children.length > 0,
      documents: docs.map(docEntry), document_groups: groupByCategory(docs),
      summary_html: p.summary ? mdToHtml(p.summary) : '',
      breadcrumbs: crumbs.map((c, i) => ({ ...c, last: i === crumbs.length - 1 })),
      jsonld: JSON.stringify(jsonld, null, 2).replace(/</g, '\\u003c'),
    };
  });
  return {
    ...content,
    projects: { ...content.projects, projects: derived, top_projects: derived.filter(p => !p.is_sub) },
  };
}

module.exports = { SLUG_RE, MAX_DEPTH, projectOf, projectPath, projectUrl, documentUrl, projectAnchor, validateProjectTree, deriveProjectTree };
