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

// The menus as they were hand-written in templates/partials until 2026-10-06,
// plus the Writing dropdown and footer link (2026-10-07, docs/systems/writing.md)
// and Find Your Officials (2026-10-08, the separate lookup app) in a Get
// Involved dropdown (still the red CTA button) + the footer — a 10th top-level
// header item pushes Donate/Get Involved off at 861–1100px.
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
    { label: 'Writing', children: [
      { label: 'All writing', href: '/writing' },
      { label: 'Statements', href: '/statements.html' },
      { label: 'Reports', href: '/writing#reports' },
      { label: 'Newsletters', href: '/newsletters' },
    ] },
    { label: 'News & Media', href: '/blog.html' },
    // auto: the live top-level projects are listed underneath at render
    // (docs/decisions/project-tree-nested-urls.md); a plain link where the
    // render path has no projects (newsletter archive).
    { label: 'Projects', href: '/projects.html', auto: 'projects' },
    { label: 'Submit a Tip', href: '/tip.html' },
    { label: 'Donate', href: '/donate', style: 'donate' },
    { label: 'Get Involved', style: 'cta', children: [
      { label: 'Join the Compact', href: '/#join' },
      { label: 'Find Your Officials', href: 'https://lookup.utahciviccompact.org' },
    ] },
  ],
  footer: {
    columns: [
      { heading: 'Organization', links: [
        { label: 'Mission', href: '/#mission' },
        { label: 'Issues', href: '/#issues' },
        { label: 'Team & Bios', href: '/team.html' },
        { label: 'Theory of Change', href: '/theory.html' },
        { label: 'Privacy Report', href: '/privacy-report.html' },
        { label: 'Writing', href: '/writing' },
      ] },
      { heading: 'Get Involved', links: [
        { label: 'Join the Compact', href: '/#join' },
        { label: 'Find Your Officials', href: 'https://lookup.utahciviccompact.org' },
        { label: 'News & Blog', href: '/blog.html' },
        { label: 'Newsletters', href: '/newsletters' },
        { label: 'Donate', href: '/donate' },
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
// dropdown, and keeps style only on top-level items (a styled dropdown's
// toggle looks like that button). Used by the admin
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
      if (label && children.length) header.push(STYLES[raw.style] ? { label, style: raw.style, children } : { label, children });
      continue;
    }
    const l = link(raw);
    if (!l) continue;
    if (raw.style && STYLES[raw.style]) l.style = raw.style;
    if (raw.auto === 'projects') l.auto = 'projects'; // "list the projects underneath" (navFields)
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

// navFields(settings, page, { projects }) → the three HTML blocks the header
// and footer partials print with {{{…}}}. `page` is the current page key.
// projects: the top-level projects ([{ name, url }], deriveProjectTree) a
// header item with auto: 'projects' expands into a dropdown — its own link
// first ("All projects"), then one entry per project. Without projects the
// item stays a plain link.
function navFields(settings = {}, page = '', { projects } = {}) {
  const nav = normalizeNavigation(settings.navigation) || DEFAULT_NAVIGATION;
  const headerLines = [];
  for (const raw of nav.header) {
    let item = raw;
    if (item.auto === 'projects' && Array.isArray(projects) && projects.length) {
      item = {
        label: item.label,
        children: [{ label: `All ${item.label.toLowerCase()}`, href: item.href },
          ...projects.filter(p => p && p.name && p.url).slice(0, LIMITS.children - 1).map(p => ({ label: String(p.name), href: String(p.url) }))],
      };
    }
    if (item.children) {
      const styled = item.style ? ` ${STYLES[item.style]}` : '';
      headerLines.push(`<li class="nav-dropdown${item.style ? ' nav-dropdown-styled' : ''}">`,
        `  <button class="nav-dropdown-toggle${styled}" type="button" aria-expanded="false" aria-haspopup="true">`,
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
