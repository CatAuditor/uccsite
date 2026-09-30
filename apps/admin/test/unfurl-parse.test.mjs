import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePreview, previewFromUrl, looksBlocked, isPrivateAddress, stripTitleSuffix, formatDate, cleanUrl, truncateWords } from '../lib/unfurl-parse.mjs';

const page = (head, lang = 'en') => `<!doctype html><html lang="${lang}"><head>${head}</head><body>x</body></html>`;

test('reads Open Graph into the article fields, in house style', () => {
  const { card, fields } = parsePreview(page(`
    <title>Flock cameras under review | KSL.com</title>
    <meta property="og:site_name" content="KSL.com">
    <meta property="og:title" content="Flock cameras under review">
    <meta property="og:description" content="Gov. Cox calls for a review &amp; new limits.">
    <meta property="og:image" content="/img/lead.jpg">
    <meta property="article:published_time" content="2026-08-21T02:30:00Z">
    <link rel="icon" href="/favicon.png">`), 'https://www.ksl.com/article/123?utm_source=fb&id=9');
  assert.equal(fields.outlet, 'KSL.com');
  assert.equal(fields.headline, 'Flock cameras under review');
  assert.equal(fields.excerpt, 'Gov. Cox calls for a review & new limits.');
  assert.equal(fields.date, 'August 20, 2026', 'late-evening UTC must read as the Utah date');
  assert.equal(fields.url, 'https://www.ksl.com/article/123?id=9', 'tracking params stripped, real ones kept');
  assert.equal(fields.read_more, 'Read on KSL.com →');
  assert.equal(fields.lang_attr, '');
  assert.equal(card.image, 'https://www.ksl.com/img/lead.jpg');
  assert.equal(card.icon, 'https://www.ksl.com/favicon.png');
});

test('Spanish pages get lang and a Spanish read-more', () => {
  const { fields } = parsePreview(page('<meta property="og:title" content="Crece la preocupación"><meta property="og:site_name" content="Telemundo Utah">', 'es'),
    'https://www.telemundoutah.com/noticias/x');
  assert.equal(fields.lang_attr, 'lang="es"');
  assert.equal(fields.read_more, 'Leer en Telemundo Utah →');
});

test('falls back to <title>, host name, JSON-LD date and /favicon.ico', () => {
  const { card, fields } = parsePreview(page('<title>County audit - Deseret News</title><script type="application/ld+json">{"datePublished":"2026-09-02T15:00:00-06:00"}</script>'),
    'https://www.deseret.com/utah/2026/9/2/audit');
  assert.equal(fields.outlet, 'Deseret');
  assert.equal(fields.headline, 'County audit');
  assert.equal(fields.date, 'September 2, 2026');
  assert.equal(card.icon, 'https://www.deseret.com/favicon.ico');
});

test('title suffix is only stripped when it names the site', () => {
  assert.equal(stripTitleSuffix('Utah passes law | Utah News Dispatch', 'Utah News Dispatch', 'utahnewsdispatch.com'), 'Utah passes law');
  assert.equal(stripTitleSuffix('Cox: a new era - for privacy', 'KSL', 'ksl.com'), 'Cox: a new era - for privacy');
});

test('helpers', () => {
  assert.equal(formatDate('not a date'), '');
  assert.equal(cleanUrl('https://a.com/x?fbclid=1#frag'), 'https://a.com/x');
  const long = 'word '.repeat(100).trim();
  assert.ok(truncateWords(long, 50).endsWith('…'));
  assert.ok(truncateWords(long, 50).length <= 51);
});

test('SSRF guard blocks every private, loopback and metadata range', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', 'garbage']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.140', '172.32.0.1', '2606:4700::6810:85e5']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('blocked outlets: outlet, date and a draft headline from the link itself', () => {
  const p = previewFromUrl('https://utahnewsdispatch.com/2026/08/20/utah-governor-deeply-troubled-flock-cameras/?utm_source=x');
  assert.equal(p.partial, true);
  assert.equal(p.fields.date, 'August 20, 2026');
  assert.equal(p.fields.headline, 'Utah governor deeply troubled flock cameras');
  assert.equal(p.fields.url, 'https://utahnewsdispatch.com/2026/08/20/utah-governor-deeply-troubled-flock-cameras/');
  assert.equal(p.fields.excerpt, '');
});

test('bot-challenge pages are recognised, real articles are not', () => {
  assert.equal(looksBlocked('<html><head><title>Just a moment...</title></head></html>'), true);
  assert.equal(looksBlocked('<html><head><title>Utah passes privacy law</title></head></html>'), false);
});
