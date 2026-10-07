import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { projectOf, projectAnchor, deriveProjectDocuments } = createRequire(import.meta.url)('../projects.js');

const projects = [
  { name: 'License Plate Reader Investigation', slug: 'alpr', cta_url: '/alpr.html' },
  { name: 'Stratos Project', slug: 'stratos', cta_url: '/stratos' },
  { name: 'Weber County Election Law Complaint', slug: 'weber-county', cta_url: '/weber-county.html' },
];

test('explicit project_slug wins; a CTA pointing at the page is the fallback; otherwise none', () => {
  assert.equal(projectOf({ slug: 'alpr-followup', projectSlug: 'alpr' }, projects).slug, 'alpr');
  assert.equal(projectOf({ slug: 'alpr', projectSlug: '' }, projects).slug, 'alpr');          // /alpr.html
  assert.equal(projectOf({ slug: 'stratos' }, projects).slug, 'stratos');                     // /stratos
  assert.equal(projectOf({ slug: 'theory', projectSlug: '' }, projects), null);
  assert.equal(projectOf({ slug: 'x', projectSlug: 'gone' }, projects), null);                 // orphan link
  assert.equal(projectAnchor('weber-county'), 'project-weber-county');
});

test('deriveProjectDocuments nests published documents under their project, minus the CTA page', () => {
  const content = {
    projects: { projects },
    documents_index: [
      { slug: 'alpr', title: 'Ten Cameras', category: 'Reports', summary: 'Main report', projectSlug: '' },
      { slug: 'alpr-records', title: 'The Records', category: 'Reports', summary: 'Every row', projectSlug: 'alpr' },
      { slug: 'alpr-letter', title: 'Letter to the Sheriff', category: '', summary: '', projectSlug: 'alpr' },
      { slug: 'theory', title: 'Theory of Change', category: 'Whitepapers', summary: '', projectSlug: '' },
    ],
  };
  const out = deriveProjectDocuments(content).projects.projects;
  assert.equal(out[0].anchor, 'project-alpr');
  assert.deepEqual(out[0].documents, [
    { title: 'The Records', url: '/alpr-records', category: 'Reports', summary: 'Every row' },
    { title: 'Letter to the Sheriff', url: '/alpr-letter', category: '', summary: '' },
  ]);
  assert.deepEqual(out[1].documents, []);
  assert.deepEqual(out[2].documents, []);
});

test('git build (no documents_index) → every project gets an empty list', () => {
  const out = deriveProjectDocuments({ projects: { projects } }).projects.projects;
  assert.deepEqual(out.map(p => p.documents), [[], [], []]);
});
