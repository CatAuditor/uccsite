'use strict';
// Which project a Document belongs to (docs/systems/projects.md "Nesting").
// A document is under a project when its project_slug says so, or, failing
// that, when the project's CTA button points at the document (/<slug> or
// /<slug>.html) — so the eight migrated reports nest without a backfill and
// an editor cannot unlink the page a project's button opens.
const ctaSlug = (p) => String(p.cta_url || p.ctaUrl || '').trim().replace(/\.html$/, '').replace(/^\//, '');

// projectOf({ slug, projectSlug }, projects) → project | null
function projectOf(doc, projects = []) {
  const explicit = String(doc.projectSlug || '').trim();
  if (explicit) return projects.find(p => String(p.slug || '').trim() === explicit) || null;
  const slug = String(doc.slug || '').trim();
  if (!slug) return null;
  return projects.find(p => ctaSlug(p) === slug) || null;
}

// projectAnchor(slug) → the id of the project's block on /projects.
const projectAnchor = (slug) => `project-${String(slug || '').trim()}`;

// deriveProjectDocuments(content) → every project gets `documents`: the
// published Documents nested under it (content.documents_index — DB render
// only; the git build has none, so the list is empty), minus the one its
// CTA already opens, in the admin's document order. Each project also gets
// `anchor` for the block id.
function deriveProjectDocuments(content) {
  const projects = content.projects?.projects;
  if (!Array.isArray(projects)) return content;
  const index = Array.isArray(content.documents_index) ? content.documents_index : [];
  return {
    ...content,
    projects: {
      ...content.projects,
      projects: projects.map(p => ({
        ...p,
        anchor: projectAnchor(p.slug),
        documents: index
          .filter(d => projectOf(d, projects) === p && d.slug !== ctaSlug(p))
          .map(d => ({ title: d.title, url: `/${d.slug}`, category: d.category || '', summary: d.summary || '' })),
      })),
    },
  };
}

module.exports = { projectOf, projectAnchor, deriveProjectDocuments };
