import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validatePetition, PETITION_FIELDS, isOpen, isFeatured } = require('../petitions');
const { FIELD_MAPS, COLLECTION_TABLES } = require('../content');
const { COLLECTIONS } = require('../export');

const projects = [{ slug: 'alpr', parent_slug: '' }, { slug: 'records', parent_slug: 'alpr' }];

test('validatePetition: slug shape, project required and known, status, featured only when open', () => {
  assert.deepEqual(validatePetition({ slug: 'udot-alpr-permits', project_slug: 'alpr', status: 'open', featured: '1' }, { projects }), []);
  const msgs = validatePetition({ slug: 'Bad Slug', project_slug: '', status: 'maybe', featured: '1' }, { projects });
  assert.ok(msgs.some(m => /lowercase/.test(m)));
  assert.ok(msgs.some(m => /belongs to a project/.test(m)));
  assert.ok(msgs.some(m => /draft, open or closed/.test(m)));
  assert.ok(msgs.some(m => /Only an open petition/.test(m)));
  assert.match(validatePetition({ slug: 'x', project_slug: 'nope' }, { projects })[0], /not a project/);
  assert.match(validatePetition({ slug: 'thanks', project_slug: 'alpr' }, { projects })[0], /reserved/);
});

test('validatePetition: slugs are unique across every project (signatures key on the slug alone)', () => {
  const others = [{ slug: 'udot-alpr-permits', project_slug: 'records' }];
  assert.match(validatePetition({ slug: 'udot-alpr-permits', project_slug: 'alpr' }, { others, projects })[0], /already uses the slug/);
});

test('petitions is a content collection: FIELD_MAPS, lastmod tables, export', () => {
  assert.deepEqual(Object.keys(FIELD_MAPS.petitions), PETITION_FIELDS);
  assert.ok(COLLECTION_TABLES.petitions.includes('petitions'));
  assert.ok(COLLECTION_TABLES.homepage.includes('petitions')); // the hero follows the featured petition
  assert.ok(COLLECTION_TABLES.projects.includes('petitions')); // hubs show their petitions
  assert.ok(COLLECTIONS.includes('petitions'));
  assert.equal(isOpen({ status: 'open' }), true);
  assert.equal(isFeatured({ featured: '1' }), true);
});
