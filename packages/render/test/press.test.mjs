// derivePress: the one press list → News & Media, homepage cards, coverage
// strips, each project's press (docs/systems/press.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { derivePress } = createRequire(import.meta.url)('../press.js');

const items = [
  { type: 'article', headline: 'A1', url: 'https://a/1', project_slug: 'alpr', featured: '1' },
  { type: 'video', headline: 'V1', youtube_id: 'v1', project_slug: 'alpr', featured: '1', hide_from_news: '1' },
  { headline: 'A2', url: 'https://a/2', project_slug: 'stratos' },
  { headline: 'A3', url: 'https://a/3', featured: '1' },
  { headline: 'A4', url: 'https://a/4', featured: '1', hide_from_news: '1' },
  { headline: 'V2', youtube_id: 'v2' }, // no type: a youtube id makes it a video
];

test('derives blog, homepage cards (first three featured), coverage per project, project press', () => {
  const out = derivePress({ press: { items }, projects: { projects: [{ slug: 'alpr' }, { slug: 'stratos' }, { slug: 'empty' }] }, homepage: { hero: {} } });
  assert.deepEqual(out.blog.articles.map(i => i.headline), ['A1', 'A2', 'A3']);
  assert.deepEqual(out.blog.videos.map(i => i.headline), ['V2']);
  assert.deepEqual(out.homepage.press.map(i => i.headline), ['A1', 'V1', 'A3']);
  assert.equal(out.homepage.hero !== undefined, true);
  assert.deepEqual(out.coverage.alpr_coverage.map(i => i.headline), ['A1']);
  assert.deepEqual(out.coverage.stratos_coverage.map(i => i.headline), ['A2']);
  assert.deepEqual(out.coverage.empty_coverage, []);
  const [alpr, stratos] = out.projects.projects;
  assert.deepEqual(alpr.articles.map(i => i.headline), ['A1']);
  assert.deepEqual(alpr.videos.map(i => i.headline), ['V1']); // hidden from news, still on its project page
  assert.deepEqual(stratos.videos, []);
  assert.deepEqual(out.press.items, items); // input kept
});

test('no press list → content untouched; idempotent when run twice', () => {
  const legacy = { blog: { articles: [1] }, coverage: { x_coverage: [] } };
  assert.equal(derivePress(legacy), legacy);
  const once = derivePress({ press: { items }, projects: { projects: [{ slug: 'alpr' }] } });
  assert.deepEqual(derivePress(once), once);
});
