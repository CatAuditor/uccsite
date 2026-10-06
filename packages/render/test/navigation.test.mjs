import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { DEFAULT_NAVIGATION, normalizeNavigation, navFields, pageKey } = createRequire(import.meta.url)('../navigation.js');

test('page keys match each render path', () => {
  assert.equal(pageKey('/team.html'), 'team');
  assert.equal(pageKey('/privacy-report'), 'privacy-report');
  assert.equal(pageKey('/newsletters'), 'newsletters');
  assert.equal(pageKey('/'), 'index');
  for (const h of ['/#join', 'https://x.org/a', '//x.org', 'mailto:a@b.c']) assert.equal(pageKey(h), null, h);
});

test('normalize: drops empties, one dropdown level, styles only on plain top-level links', () => {
  const n = normalizeNavigation({
    header: [
      { label: '', href: '/x' }, { label: 'A', href: '' },
      { label: 'Menu', children: [{ label: 'C', href: '/c', style: 'donate', children: [{ label: 'deep', href: '/d' }] }, { label: '', href: '' }] },
      { label: 'Empty dropdown', children: [] },
      { label: 'Give', href: '/#donate', style: 'donate' }, { label: 'Odd', href: '/o', style: 'bogus' },
    ],
    footer: { columns: [{ heading: 'H', links: [{ label: 'L', href: '/l' }] }, { heading: 'no links', links: [] }], bottom: [{ label: 'P', href: '/p' }] },
  });
  assert.deepEqual(n.header, [
    { label: 'Menu', children: [{ label: 'C', href: '/c' }] },
    { label: 'Give', href: '/#donate', style: 'donate' },
    { label: 'Odd', href: '/o' },
  ]);
  assert.equal(n.footer.columns.length, 1);
  assert.deepEqual(n.footer.bottom, [{ label: 'P', href: '/p' }]);
});

test('normalize: unusable values fall back (null), JSON strings accepted', () => {
  for (const bad of [null, undefined, 'not json', {}, { header: [] }, { header: [{ label: '', href: '' }] }]) assert.equal(normalizeNavigation(bad), null);
  assert.equal(normalizeNavigation(JSON.stringify(DEFAULT_NAVIGATION)).header.length, DEFAULT_NAVIGATION.header.length);
});

test('aria-current only on the matching page link, never on anchors or buttons', () => {
  const { nav_header_html: h } = navFields({}, 'team');
  assert.match(h, /<a href="\/team\.html" aria-current="page">Team &amp; Bios<\/a>/);
  assert.equal((h.match(/aria-current/g) || []).length, 1);
  assert.equal((navFields({}, 'index').nav_header_html.match(/aria-current/g) || []).length, 0);
  assert.match(navFields({}, 'privacy').nav_bottom_html, /href="\/privacy\.html" aria-current="page"/);
});

test('custom menus render: styles, {email}, external links, escaping', () => {
  const settings = {
    email: 'info@utahciviccompact.org',
    navigation: {
      header: [{ label: 'Petition <now>', href: '/petition', style: 'cta' }, { label: 'Reports', children: [{ label: 'ALPR', href: '/alpr.html' }] }],
      footer: { columns: [{ heading: 'Contact', links: [{ label: '{email}', href: 'mailto:{email}' }, { label: 'Lt. Gov', href: 'https://lobbyist.utah.gov/x' }] }], bottom: [{ label: 'Terms', href: '/terms.html' }, { label: 'Privacy Policy', href: '/privacy.html' }] },
    },
  };
  const f = navFields(settings, 'alpr');
  assert.match(f.nav_header_html, /<li><a href="\/petition" class="nav-cta">Petition &lt;now&gt;<\/a><\/li>/);
  assert.match(f.nav_header_html, /<li><a href="\/alpr\.html" aria-current="page">ALPR<\/a><\/li>/);
  assert.match(f.nav_footer_html, /<a href="mailto:info@utahciviccompact\.org">info@utahciviccompact\.org<\/a>/);
  assert.match(f.nav_footer_html, /href="https:\/\/lobbyist\.utah\.gov\/x" target="_blank" rel="noopener"/);
  assert.equal(f.nav_bottom_html, '<a href="/terms.html">Terms</a>\n          <a href="/privacy.html">Privacy Policy</a>');
});

test('dangerous links never reach the page', () => {
  const navigation = { header: [
    { label: 'x', href: 'javascript:alert(1)' }, { label: 'y', href: 'data:text/html,<script>' },
    { label: 'z', href: '/ok" onmouseover="alert(1)' }, { label: 'w', href: '//evil.example/p' },
  ], footer: { columns: [], bottom: [] } };
  const h = navFields({ navigation }, '').nav_header_html;
  assert.ok(!/javascript:|data:|onmouseover/.test(h), h);
  assert.match(h, /href="https:\/\/evil\.example\/p" target="_blank" rel="noopener"/, 'protocol-relative made explicit and marked external');
  assert.equal((h.match(/href="#"/g) || []).length, 3);
});
