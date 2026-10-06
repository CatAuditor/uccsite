'use strict';
// Site navigation: header menu + footer columns + footer bottom links, edited
// on the admin's Menus page and stored as settings.navigation
// (docs/systems/navigation.md). Pure — strings and objects in, HTML out.
//
// The HTML is generated here rather than with template sections so the
// default menus reproduce the previous hand-written partials BYTE-FOR-BYTE
// (packages/render/test/parity.test.mjs): Mustache sections cannot control the
// whitespace between list items. Every label and href is escaped; hrefs go
// through the same safeUrl allow-list as template URLs.
const { escapeHtml, safeUrl } = require('./engine');

const CHEVRON = '<svg class="chevron" aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

// The menus as they were hand-written in templates/partials until 2026-10-06.
// Used whenever settings.navigation is absent or unreadable, so a missing or
// broken value can never strip the site of its menus.
const DEFAULT_NAVIGATION = {
  header: [
    { label: 'Mission', href: '/#mission' },
    { label: 'About Us', children: [
      { label: 'Team & Bios', href: '/team.html' },
      { label: 'Theory of Change', href: '/theory.html' },
      { label: 'Policies', href: '/issues.html' },
      { label: 'Privacy Report', href: '/privacy-report.html' },
    ] },
    { label: 'News & Media', href: '/blog.html' },
    { label: 'Projects', href: '/projects.html' },
    { label: 'Submit a Tip', href: '/tip.html' },
    { label: 'Donate', href: '/#donate', style: 'donate' },
    { label: 'Get Involved', href: '/#join', style: 'cta' },
  ],
  footer: {
    columns: [
      { heading: 'Organization', links: [
        { label: 'Mission', href: '/#mission' },
        { label: 'Issues', href: '/#issues' },
        { label: 'Team & Bios', href: '/team.html' },
        { label: 'Theory of Change', href: '/theory.html' },
        { label: 'Privacy Report', href: '/privacy-report.html' },
      ] },
      { heading: 'Get Involved', links: [
        { label: 'Join the Compact', href: '/#join' },
        { label: 'News & Blog', href: '/blog.html' },
        { label: 'Newsletters', href: '/newsletters' },
        { label: 'Donate', href: '/#donate' },
      ] },
      { heading: 'Contact', links: [
        { label: '{email}', href: 'mailto:{email}' },
        { label: 'Press Inquiries', href: 'mailto:{email}' },
      ] },
    ],
    bottom: [{ label: 'Privacy Policy', href: '/privacy.html' }],
  },
};

const STYLES = { donate: 'nav-donate', cta: 'nav-cta' };
const LIMITS = { header: 12, children: 12, columns: 5, links: 12, bottom: 6, label: 80, href: 500 };

const str = (v, max) => String(v ?? '').trim().slice(0, max);
function link(raw) {
  const label = str(raw && raw.label, LIMITS.label);
  let href = str(raw && raw.href, LIMITS.href);
  if (href.startsWith('//')) href = `https:${href}`; // protocol-relative → explicit
  return label && href ? { label, href } : null;
}

// normalizeNavigation(value) → a clean { header, footer } or null when the
// value is unusable. Drops empty entries, caps sizes, allows ONE level of
// dropdown, and keeps style only for top-level plain links. Used by the admin
// on save and by the renderer on read, so both agree on what is valid.
function normalizeNavigation(value) {
  let nav = value;
  if (typeof nav === 'string') { try { nav = JSON.parse(nav); } catch { return null; } }
  if (!nav || typeof nav !== 'object' || !Array.isArray(nav.header)) return null;
  const header = [];
  for (const raw of nav.header.slice(0, LIMITS.header)) {
    if (raw && Array.isArray(raw.children)) {
      const label = str(raw.label, LIMITS.label);
      const children = raw.children.slice(0, LIMITS.children).map(link).filter(Boolean);
      if (label && children.length) header.push({ label, children });
      continue;
    }
    const l = link(raw);
    if (!l) continue;
    if (raw.style && STYLES[raw.style]) l.style = raw.style;
    header.push(l);
  }
  const f = nav.footer && typeof nav.footer === 'object' ? nav.footer : {};
  const columns = (Array.isArray(f.columns) ? f.columns : []).slice(0, LIMITS.columns)
    .map((c) => ({ heading: str(c && c.heading, LIMITS.label), links: (Array.isArray(c && c.links) ? c.links : []).slice(0, LIMITS.links).map(link).filter(Boolean) }))
    .filter((c) => c.heading && c.links.length);
  const bottom = (Array.isArray(f.bottom) ? f.bottom : []).slice(0, LIMITS.bottom).map(link).filter(Boolean);
  if (!header.length) return null;
  return { header, footer: { columns, bottom } };
}

// "/team.html", "/team", "team.html" → "team"; anchors and other sites → null.
// Matches the `page` key each render path sets (site.js, documents.js,
// newsletters.js), which drives aria-current.
function pageKey(href) {
  if (!href.startsWith('/') || href.includes('#') || href.startsWith('//')) return null;
  return href.replace(/^\/+/, '').replace(/[?].*$/, '').replace(/\.html$/, '').replace(/\/+$/, '') || 'index';
}

function fill(text, settings) {
  return text.replace(/\{email\}/g, settings.email || '');
}

function anchor(l, settings, page, { styled = false, current = true } = {}) {
  const href = safeUrl(fill(l.href, settings));
  const attrs = [`href="${escapeHtml(href)}"`];
  if (styled && l.style) attrs.push(`class="${STYLES[l.style]}"`);
  if (/^https?:\/\//i.test(href) && !href.startsWith('https://utahciviccompact.org')) attrs.push('target="_blank" rel="noopener"');
  const isCurrent = current && !(styled && l.style) && pageKey(l.href) === page;
  return `<a ${attrs.join(' ')}${isCurrent ? ' aria-current="page"' : ''}>${escapeHtml(fill(l.label, settings))}</a>`;
}

// navFields(settings, page) → the three HTML blocks the header and footer
// partials print with {{{…}}}. `page` is the current page key.
function navFields(settings = {}, page = '') {
  const nav = normalizeNavigation(settings.navigation) || DEFAULT_NAVIGATION;
  const headerLines = [];
  for (const item of nav.header) {
    if (item.children) {
      headerLines.push('<li class="nav-dropdown">',
        '  <button class="nav-dropdown-toggle" type="button" aria-expanded="false" aria-haspopup="true">',
        `    ${escapeHtml(item.label)}`,
        `    ${CHEVRON}`,
        '  </button>',
        '  <ul class="nav-dropdown-menu">',
        ...item.children.map((c) => `    <li>${anchor(c, settings, page)}</li>`),
        '  </ul>',
        '</li>');
    } else {
      headerLines.push(`<li>${anchor(item, settings, page, { styled: true })}</li>`);
    }
  }
  const footerLines = [];
  for (const col of nav.footer.columns) {
    footerLines.push('<div class="footer-col">',
      `  <h2>${escapeHtml(col.heading)}</h2>`,
      '  <ul>',
      ...col.links.map((l) => `    <li>${anchor(l, settings, page, { current: false })}</li>`),
      '  </ul>',
      '</div>');
  }
  return {
    nav_header_html: headerLines.join('\n        '),
    nav_footer_html: footerLines.join('\n        '),
    nav_bottom_html: nav.footer.bottom.map((l) => anchor(l, settings, page)).join('\n          '),
  };
}

module.exports = { DEFAULT_NAVIGATION, LIMITS, normalizeNavigation, navFields, pageKey };
