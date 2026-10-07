import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { derivePetitionShare, petitionDonate } = createRequire(import.meta.url)('../site.js');

const withPetition = (p) => derivePetitionShare({ homepage: { petition: p } }).homepage.petition;

test('share links are pre-built, URL-encoded, and strip the headline markup', () => {
  const s = withPetition({ headline: 'Tell <em>UDOT</em>: no' }).share;
  assert.equal(s.text, 'Tell UDOT: no');
  assert.equal(s.url, 'https://utahciviccompact.org/petition');
  assert.equal(s.facebook, 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Futahciviccompact.org%2Fpetition');
  assert.match(s.x, /^https:\/\/twitter\.com\/intent\/tweet\?text=Tell%20UDOT%3A%20no&url=/);
  assert.match(s.sms, /^sms:\?&body=Tell%20UDOT%3A%20no%20https%3A/);
});

test('share_text overrides the headline; no petition means no share block', () => {
  assert.equal(withPetition({ headline: 'H', share_text: 'Sign this' }).share.text, 'Sign this');
  assert.equal(withPetition({ headline: '' }).share, undefined);
});

test('preview image: only a /media or /assets picture, else the logo on navy', () => {
  const ok = withPetition({ headline: 'H', share_image: '/media/abc/1200.jpg' }).share;
  assert.equal(ok.image, 'https://utahciviccompact.org/media/abc/1200.jpg');
  assert.equal(ok.card, 'summary_large_image');
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.jpg', '/media/x.svg', '']) {
    const s = withPetition({ headline: 'H', share_image: bad }).share;
    assert.equal(s.image, 'https://utahciviccompact.org/assets/share-default.png', bad);
    assert.equal(s.card, 'summary_large_image', bad);
  }
});

test('page title (and the link preview headline) follows the form title', () => {
  assert.equal(withPetition({ headline: 'H', form_title: 'Get The Flock Off Our Streets' }).share.page_title, 'Get The Flock Off Our Streets | Utah Civic Compact');
  assert.equal(withPetition({ headline: 'H', form_title: ' <b>x</b> ' }).share.page_title, 'x | Utah Civic Compact');
  assert.equal(withPetition({ headline: 'H' }).share.page_title, 'Sign the petition | Utah Civic Compact');
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
