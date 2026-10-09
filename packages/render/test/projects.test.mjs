// The project tree (docs/decisions/project-tree-nested-urls.md): which project
// a document is under, paths and URLs, tree validation, and the hub-page derive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { projectOf, projectPath, projectUrl, documentUrl, projectAnchor, validateProjectTree, deriveProjectTree } = createRequire(import.meta.url)('../projects.js');

const projects = [
  { name: 'License Plate Reader Investigation', slug: 'alpr', cta_url: '/projects/alpr/report', status: 'Active', tagline: 'Ten cameras.' },
  { name: 'Stratos Project', slug: 'stratos', cta_url: '/projects/stratos/report' },
  { name: 'The Records', slug: 'records', parent_slug: 'alpr', status: 'Open' },
];

test('projectOf: the explicit project_slug only; blank or unknown nests nowhere', () => {
  assert.equal(projectOf({ slug: 'weber-county', projectSlug: 'alpr' }, projects).slug, 'alpr');
  assert.equal(projectOf({ slug: 'alpr', projectSlug: '' }, projects), null);   // the CTA fallback is gone
  assert.equal(projectOf({ slug: 'x', projectSlug: 'gone' }, projects), null);
  assert.equal(projectAnchor('alpr'), 'project-alpr');
});

test('paths and URLs: top-level, sub-project, documents under each, root documents', () => {
  assert.equal(projectPath('alpr', projects), 'alpr');
  assert.equal(projectPath('records', projects), 'alpr/records');
  assert.equal(projectPath('nope', projects), '');
  assert.equal(projectUrl(projects[2], projects), '/projects/alpr/records');
  assert.equal(documentUrl({ slug: 'report', projectSlug: 'alpr' }, projects), '/projects/alpr/report');
  assert.equal(documentUrl({ slug: 'index', projectSlug: 'records' }, projects), '/projects/alpr/records/index');
  assert.equal(documentUrl({ slug: 'theory', projectSlug: '' }, projects), '/theory');
  assert.equal(documentUrl({ slug: 'orphan', projectSlug: 'gone' }, projects), '/orphan'); // not lost
});

test('validateProjectTree: slugs, duplicates, unknown/self parent, depth 2', () => {
  assert.deepEqual(validateProjectTree(projects), []);
  assert.match(validateProjectTree([{ slug: 'Bad Slug' }]).join(), /lowercase/);
  assert.match(validateProjectTree([{ slug: 'a' }, { slug: 'a' }]).join(), /share the slug/);
  assert.match(validateProjectTree([{ slug: 'a', parent_slug: 'a' }]).join(), /own parent/);
  assert.match(validateProjectTree([{ slug: 'a', parent_slug: 'zzz' }]).join(), /not a project/);
  assert.match(validateProjectTree([{ slug: 'a' }, { slug: 'b', parent_slug: 'a' }, { slug: 'c', parent_slug: 'b' }]).join(), /2 levels/);
});

test('deriveProjectTree: hub data, documents grouped by category, children, top_projects, breadcrumbs, JSON-LD', () => {
  const content = {
    projects: { projects: projects.map(p => ({ ...p, status_class: 'c-x' })) },
    documents_index: [
      { slug: 'report', title: 'Ten Cameras', category: 'Reports', summary: 'Main report', projectSlug: 'alpr', url: '/projects/alpr/report' },
      { slug: 'weber-county', title: 'Weber County Complaint', category: 'Reports', summary: '', projectSlug: 'alpr' },
      { slug: 'letter', title: 'Letter to the Sheriff', category: 'Letters', summary: '', projectSlug: 'alpr' },
      { slug: 'theory', title: 'Theory of Change', category: 'Whitepapers', summary: '', projectSlug: '' },
      { slug: 'csv', title: 'The CSV', category: 'Data', projectSlug: 'records' },
    ],
  };
  const out = deriveProjectTree(content, 'https://x.org').projects;
  const [alpr, stratos, records] = out.projects;
  assert.equal(alpr.url, '/projects/alpr');
  assert.equal(alpr.path, 'alpr');
  assert.equal(alpr.anchor, 'project-alpr');
  assert.equal(alpr.is_sub, false);
  assert.deepEqual(alpr.children, [{ name: 'The Records', url: '/projects/alpr/records', status: 'Open', status_class: 'c-x', tagline: '', region: '', date: '' }]);
  assert.deepEqual(alpr.document_groups.map(g => [g.category, g.documents.map(d => d.url)]), [
    ['Reports', ['/projects/alpr/report', '/projects/alpr/weber-county']],
    ['Letters', ['/projects/alpr/letter']],
  ]);
  assert.equal(records.is_sub, true);
  assert.equal(records.parent_url, '/projects/alpr');
  assert.deepEqual(records.documents.map(d => d.url), ['/projects/alpr/records/csv']);
  assert.deepEqual(records.breadcrumbs.map(c => c.name), ['Projects', 'License Plate Reader Investigation', 'The Records']);
  assert.deepEqual(stratos.documents, []);
  assert.deepEqual(out.top_projects.map(p => p.slug), ['alpr', 'stratos']);
  const ld = JSON.parse(records.jsonld);
  assert.equal(ld['@graph'][0]['@type'], 'CollectionPage');
  assert.equal(ld['@graph'][0].isPartOf['@id'], 'https://x.org/projects/alpr');
  assert.equal(ld['@graph'][1].itemListElement.length, 3);
});

test('git build (no documents_index) → every project gets empty lists and still has a url', () => {
  const out = deriveProjectTree({ projects: { projects } }).projects.projects;
  assert.deepEqual(out.map(p => p.documents), [[], [], []]);
  assert.deepEqual(out.map(p => p.url), ['/projects/alpr', '/projects/stratos', '/projects/alpr/records']);
});
