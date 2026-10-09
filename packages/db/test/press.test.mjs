// unifyPress: the one-time unification of the four legacy press sources
// (docs/systems/press.md, scripts/migrate-press.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { unifyPress, normalizeUrl, isVideo } = createRequire(import.meta.url)('../press.js');

test('normalizeUrl: host case, www, trailing slash and tracking params do not split a story', () => {
  assert.equal(normalizeUrl('https://www.KSL.com/article/1/?utm_source=x&id=2'), 'ksl.com/article/1?id=2');
  assert.equal(normalizeUrl('https://ksl.com/article/1'), 'ksl.com/article/1');
});

test('the same story in four places becomes one row: fields merged, project set, featured set, newest first', () => {
  const ksl = { outlet: 'KSL', badge_color: '#0057a8', date: 'August 13, 2026', headline: 'Group cites data', url: 'https://www.ksl.com/a/1', read_more: 'Read on KSL →' };
  const { items, sources, report } = unifyPress({
    projects: [{ slug: 'alpr', articles: [{ ...ksl, region: 'Weber County', excerpt: 'Short.' }], videos: [{ outlet: 'FOX 13', date: 'May 26, 2026', headline: 'MIDA', youtube_id: 'abc123', youtube_title: 'T' }] }],
    coverage: { alpr_coverage: [{ ...ksl, url: 'https://ksl.com/a/1/?utm_campaign=z' }], stratos_coverage: [{ outlet: 'Tribune', date: 'June 9, 2026', headline: 'Complaint', url: 'https://sltrib.com/x' }] },
    blog: { articles: [{ ...ksl, excerpt: 'A much longer excerpt for the news page.' }, { outlet: 'Fox', date: 'September 1, 2026', headline: 'General', url: 'https://fox13.com/g' }], videos: [{ outlet: 'FOX 13', date: 'May 26, 2026', headline: 'MIDA', youtube_id: 'abc123', embed_params: '?start=9' }] },
    homepagePress: [{ ...ksl }],
  });
  assert.deepEqual(report, []);
  assert.deepEqual(items.map(i => i.headline), ['General', 'Group cites data', 'Complaint', 'MIDA']);
  const story = items[1];
  assert.equal(story.project_slug, 'alpr');
  assert.equal(story.featured, '1');
  assert.equal(story.excerpt, 'A much longer excerpt for the news page.');
  assert.equal(story.region, 'Weber County');
  assert.equal(story.url, 'https://www.ksl.com/a/1'); // first source's form kept
  assert.deepEqual(sources[1], ['project alpr article', 'coverage alpr', 'news article', 'homepage']);
  const video = items[3];
  assert.equal(video.type, 'video');
  assert.equal(video.project_slug, 'alpr');
  // a video with no project of its own but the same headline as a project's article inherits the project
  const { items: inh } = unifyPress({ coverage: { alpr_coverage: [{ outlet: 'KSL', date: 'August 20, 2026', headline: 'Cox answers', url: 'https://ksl.com/c' }] }, blog: { videos: [{ outlet: 'KSL', date: 'August 20, 2026', headline: 'Cox answers', youtube_id: 'zz' }] } });
  assert.equal(inh.find(i => i.type === 'video').project_slug, 'alpr');
  assert.equal(video.embed_params, '?start=9'); // filled from the news copy
  assert.equal(items[2].project_slug, 'stratos'); // coverage key → project
  assert.equal(items[0].project_slug, undefined); // blanks are dropped like every collection field
  assert.ok(isVideo(video) && !isVideo(story));
});

test('a homepage card linking to a YouTube watch URL merges with the video of that id (and makes it featured)', () => {
  const { items } = unifyPress({ blog: { videos: [{ outlet: 'KSL', date: 'September 22, 2026', headline: 'Spying', youtube_id: 'ID9' }] }, homepagePress: [{ outlet: 'KSL', date: 'September 22, 2026', headline: 'Spying', url: 'https://www.youtube.com/watch?v=ID9&t=4s' }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'video');
  assert.equal(items[0].featured, '1');
  assert.equal(items[0].url, 'https://www.youtube.com/watch?v=ID9&t=4s'); // the card keeps a link
  // the other way round too: a coverage card (article) with the YouTube link, then the video → one video
  const { items: rev } = unifyPress({ coverage: { alpr_coverage: [{ outlet: 'KSL', date: 'August 20, 2026', headline: 'Cox', url: 'https://www.youtube.com/watch?v=ID7' }] }, blog: { videos: [{ outlet: 'KSL', date: 'August 20, 2026', headline: 'Cox', youtube_id: 'ID7' }] } });
  assert.equal(rev.length, 1);
  assert.equal(rev[0].type, 'video');
  assert.equal(rev[0].project_slug, 'alpr');
});

test('a story under two projects keeps the first and is reported; rows without a url are skipped', () => {
  const a = { outlet: 'X', date: 'June 1, 2026', headline: 'Shared', url: 'https://x.org/s' };
  const { items, report } = unifyPress({ projects: [{ slug: 'p1', articles: [a] }, { slug: 'p2', articles: [a] }], blog: { articles: [{ outlet: 'Y', headline: 'No link' }] } });
  assert.equal(items.length, 1);
  assert.equal(items[0].project_slug, 'p1');
  assert.equal(report.length, 2);
});
