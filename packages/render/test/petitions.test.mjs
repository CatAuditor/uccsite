import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { derivePetitions, petitionUrl, petitionShare, petitionDonate } = createRequire(import.meta.url)('../petitions.js');

const projects = [
  { slug: 'alpr', name: 'ALPR', url: '/projects/alpr', is_sub: false },
  { slug: 'sub', name: 'Sub', parent_slug: 'alpr', url: '/projects/alpr/sub', is_sub: true },
];
const base = (items) => ({ homepage: { hero: { headline: 'Standing' } }, projects: { projects, top_projects: [projects[0]] }, petitions: { items } });
const udot = { slug: 'udot', project_slug: 'alpr', status: 'open', featured: '1', headline: 'Tell <em>UDOT</em>: no', form_title: 'Sign it', label: 'Petition' };

test('petitionUrl nests under the project path; unknown project → nothing', () => {
  assert.equal(petitionUrl(udot, projects), '/projects/alpr/udot');
  assert.equal(petitionUrl({ slug: 'x', project_slug: 'sub' }, projects), '/projects/alpr/sub/x');
  assert.equal(petitionUrl({ slug: 'x', project_slug: 'nope' }, projects), '');
});

test('derivePetitions: pages, thanks pages, the hero, the hub cards; drafts and orphans never render', () => {
  const out = derivePetitions(base([
    udot,
    { slug: 'old', project_slug: 'sub', status: 'closed', headline: 'Done <em>deal</em>' },
    { slug: 'draft', project_slug: 'alpr', status: 'draft', headline: 'Soon' },
    { slug: 'orphan', project_slug: 'nope', status: 'open', headline: 'Lost' },
  ]));
  assert.deepEqual(out.petitions.pages.map((p) => p.path), ['alpr/udot', 'alpr/sub/old']);
  assert.deepEqual(out.petitions.thanks_pages.map((p) => p.path), ['alpr/udot/thanks']);
  assert.equal(out.petitions.pages[0].petition.thanks_url, '/projects/alpr/udot/thanks');
  assert.equal(out.petitions.pages[0].petition.abs_url, 'https://utahciviccompact.org/projects/alpr/udot');
  assert.deepEqual(out.petitions.pages[0].petition.project, { name: 'ALPR', url: '/projects/alpr' });
  assert.equal(out.petitions.closed[0].headline_text, 'Done deal');
  assert.equal(out.petitions.closed[0].is_closed, true);
  // the hero: the featured open petition; the standing hero fields stay
  assert.equal(out.homepage.petition.url, '/projects/alpr/udot');
  assert.equal(out.homepage.hero.headline, 'Standing');
  // hub cards
  assert.deepEqual(out.projects.projects[0].petitions.map((p) => p.slug), ['udot']);
  assert.equal(out.projects.projects[0].has_closed_petitions, false);
  assert.deepEqual(out.projects.projects[1].closed_petitions.map((p) => p.slug), ['old']);
  assert.equal(out.projects.top_projects[0].petitions[0].slug, 'udot');
  assert.equal(projects[0].petitions, undefined); // inputs untouched
});

test('derivePetitions: no featured open petition → no hero takeover (and the stale homepage.petition group is dropped)', () => {
  const out = derivePetitions({ ...base([{ ...udot, featured: '' }]), homepage: { hero: {}, petition: { headline: 'legacy group' } } });
  assert.equal(out.homepage.petition, undefined);
  const closedOnly = derivePetitions(base([{ ...udot, status: 'closed' }]));
  assert.equal(closedOnly.homepage.petition, undefined);
  assert.equal(closedOnly.petitions.has_open, false);
  assert.equal(closedOnly.petitions.has_closed, true);
  assert.equal(derivePetitions({ homepage: {} }).homepage.petition, undefined); // no petitions content at all
});

test('share links are pre-built, URL-encoded, and strip the headline markup', () => {
  const s = petitionShare({ headline: 'Tell <em>UDOT</em>: no' }, '/projects/alpr/udot');
  assert.equal(s.text, 'Tell UDOT: no');
  assert.equal(s.url, 'https://utahciviccompact.org/projects/alpr/udot');
  assert.equal(s.facebook, 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Futahciviccompact.org%2Fprojects%2Falpr%2Fudot');
  assert.match(s.x, /^https:\/\/twitter\.com\/intent\/tweet\?text=Tell%20UDOT%3A%20no&url=/);
  assert.match(s.sms, /^sms:\?&body=Tell%20UDOT%3A%20no%20https%3A/);
  assert.equal(petitionShare({ headline: 'H', share_text: 'Sign this' }, '/p').text, 'Sign this');
});

test('preview image: only a /media or /assets picture, else the logo on navy', () => {
  const ok = petitionShare({ headline: 'H', share_image: '/media/abc/1200.jpg' }, '/p');
  assert.equal(ok.image, 'https://utahciviccompact.org/media/abc/1200.jpg');
  assert.equal(ok.card, 'summary_large_image');
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.jpg', '/media/x.svg', '']) {
    const s = petitionShare({ headline: 'H', share_image: bad }, '/p');
    assert.equal(s.image, 'https://utahciviccompact.org/assets/share-default.png', bad);
  }
});

test('page title (and the link preview headline) follows the form title', () => {
  assert.equal(petitionShare({ headline: 'H', form_title: 'Get The Flock Off Our Streets' }, '/p').page_title, 'Get The Flock Off Our Streets | Utah Civic Compact');
  assert.equal(petitionShare({ headline: 'H', form_title: ' <b>x</b> ' }, '/p').page_title, 'x | Utah Civic Compact');
  assert.equal(petitionShare({ headline: 'H' }, '/p').page_title, 'Sign the petition | Utah Civic Compact');
});

test('donate amounts: dollars, bounds, de-dupe, cap of six, fallback', () => {
  const labels = (p) => petitionDonate(p).tiers.map((t) => t.label + (t.active ? '*' : ''));
  assert.deepEqual(labels({}), ['$10', '$25*', '$50', '$100']);
  assert.deepEqual(labels({ donate_amounts: '$5, 10, 25', donate_default: '10' }), ['$5', '$10*', '$25']);
  assert.deepEqual(labels({ donate_amounts: '5 5 0 -3 abc 200000 7' }), ['$5*', '$7']);
  assert.equal(petitionDonate({ donate_amounts: '1,2,3,4,5,6,7,8' }).tiers.length, 6);
  assert.equal(petitionDonate({ donate_amounts: '1000' }).tiers[0].label, '$1,000');
  assert.equal(petitionDonate({ donate_amounts: '5' }).tiers[0].cents, 500);
});

test('donate frequency: both (default), one-time only, monthly only, starting side', () => {
  const both = petitionDonate({});
  assert.deepEqual([both.toggle, both.type], [true, 'onetime']);
  const monthly = petitionDonate({ donate_frequency: 'monthly' });
  assert.deepEqual([monthly.toggle, monthly.type, monthly.tiers[0].per], [false, 'subscription', '/mo']);
  const once = petitionDonate({ donate_frequency: 'one-time', donate_default_frequency: 'monthly' });
  assert.deepEqual([once.toggle, once.type], [false, 'onetime']);
  assert.equal(petitionDonate({ donate_default_frequency: 'Monthly' }).type, 'subscription');
});
