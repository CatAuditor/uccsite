'use strict';
// Petitions on the site (docs/systems/petition.md). Pure. Each petition row
// (content.petitions.items, packages/db/petitions.js) becomes:
//   /projects/<project path>/<slug>          the signature page   (open or closed)
//   /projects/<project path>/<slug>/thanks   the thank-you page   (open only; noindex)
// and the ONE open petition ticked `featured` is the homepage hero
// (content.homepage.petition — templates/index.html keeps its shape). Every
// project hub lists its open petitions as sign-up cards and its closed ones
// as a plain list. /petitions is the index of everything open (and closed).
// Drafts never render. Runs AFTER deriveProjectTree (needs each project's
// path/url) and after withColorClasses.
const { projectPath, projectUrl } = require('./projects');

const SITE_URL = 'https://utahciviccompact.org';
const SHARE_IMAGE = /^\/(media|assets)\/[\w./-]+\.(png|jpe?g|webp)$/i;
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// petitionUrl(p, projects) → '/projects/<path>/<slug>' ('' when the project is unknown).
function petitionUrl(p, projects = []) {
  const path = projectPath(String(p?.project_slug || '').trim(), projects);
  const slug = String(p?.slug || '').trim();
  return path && slug ? `/projects/${path}/${slug}` : '';
}

// Share links (docs/systems/petition.md "Sharing"), built at render time so
// every button works with JavaScript off and the preview tags are in the HTML
// that Facebook, iMessage and X fetch.
function petitionShare(p, url, siteUrl = SITE_URL) {
  const e = encodeURIComponent;
  const abs = `${siteUrl}${url}`;
  const text = String(p.share_text || '').trim() ? stripTags(p.share_text) : stripTags(p.headline);
  const custom = SHARE_IMAGE.test(String(p.share_image || '').trim());
  return {
    title: p.share_title || 'Share the petition',
    page_title: `${stripTags(p.form_title) || 'Sign the petition'} | Utah Civic Compact`,
    url: abs, text,
    image: `${siteUrl}${custom ? String(p.share_image).trim() : '/assets/share-default.png'}`,
    card: 'summary_large_image',
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${e(abs)}`,
    x: `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(abs)}`,
    bluesky: `https://bsky.app/intent/compose?text=${e(`${text} ${abs}`)}`,
    sms: `sms:?&body=${e(`${text} ${abs}`)}`,
    email: `mailto:?subject=${e(text)}&body=${e(`${text}\n\n${abs}`)}`,
  };
}

// Thank-you page payment modal (docs/systems/petition.md "Donation ask").
// Amounts are typed as dollars ("5, 10, 25"); anything outside $1–$100,000
// (the API's bounds) is dropped, at most six are kept, and an empty or
// unreadable list falls back to $10/$25/$50/$100. Frequency: "both"
// (default), "one-time" or "monthly". An "Other" button is always offered.
const DONATE_FALLBACK = [10, 25, 50, 100];
function petitionDonate(p) {
  const dollars = [...new Set(String(p.donate_amounts || '').split(/[,\s]+/)
    .map((x) => Math.round(Number(x.replace(/[$]/g, ''))))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 100000))].slice(0, 6);
  const amounts = dollars.length ? dollars : DONATE_FALLBACK;
  const wanted = Math.round(Number(String(p.donate_default || '').replace(/[$]/g, '')));
  const preset = amounts.includes(wanted) ? wanted : (amounts.includes(25) ? 25 : amounts[0]);
  const f = String(p.donate_frequency || 'both').toLowerCase();
  const monthlyOnly = /month/.test(f) && !/one|both/.test(f);
  const onetimeOnly = /one/.test(f) && !/month|both/.test(f);
  const startMonthly = monthlyOnly || (!onetimeOnly && /month/.test(String(p.donate_default_frequency || '').toLowerCase()));
  const type = startMonthly ? 'subscription' : 'onetime';
  return {
    title: p.donate_title || 'Carry this fight through the legislature',
    body: p.donate_body || "Choose an amount. You'll finish on our secure Stripe checkout page.",
    tiers: amounts.map((d) => ({ cents: d * 100, label: `$${d.toLocaleString('en-US')}`, active: d === preset, per: startMonthly ? '/mo' : '' })),
    type, toggle: !monthlyOnly && !onetimeOnly, monthly: startMonthly, onetime: !startMonthly,
    customLabel: p.donate_custom_label || 'Other',
    button: p.donate_button || 'Continue to checkout',
    publicLabel: p.donate_public_label || 'Show my first name and amount on the public donor list',
  };
}

// derivePetitions(content, siteUrl) → NEW content:
//   petitions.items      every non-draft petition + url, abs_url, thanks_url, path,
//                        thanks_path, project {name,url}, is_open / is_closed,
//                        share, donate (open only), page_title
//   petitions.open / petitions.closed   the two lists for /petitions
//   petitions.pages / petitions.thanks_pages   what expandPages renders
//                        ({ slug, path, petition }) — the templates read `petition.*`
//   homepage.petition    the featured open petition (hero takeover), or absent
//   projects.projects[]  + petitions (open cards) / closed_petitions (links)
// A petition whose project is unknown (or a draft) renders nowhere.
function derivePetitions(content, siteUrl = SITE_URL) {
  const items = content.petitions?.items;
  if (!Array.isArray(items)) return content;
  const projects = content.projects?.projects || [];
  const bySlug = new Map(projects.map((x) => [String(x.slug || '').trim(), x]));

  const derived = [];
  for (const p of items) {
    const status = String(p.status || 'draft');
    if (status !== 'open' && status !== 'closed') continue;
    const project = bySlug.get(String(p.project_slug || '').trim());
    const url = petitionUrl(p, projects);
    if (!project || !url) continue;
    const is_open = status === 'open';
    const share = petitionShare(p, url, siteUrl);
    derived.push({
      ...p,
      url, abs_url: `${siteUrl}${url}`, thanks_url: `${url}/thanks`,
      path: url.replace(/^\/projects\//, ''), thanks_path: `${url.replace(/^\/projects\//, '')}/thanks`,
      project: { name: project.name, url: project.url || projectUrl(project, projects) },
      is_open, is_closed: !is_open, is_featured: is_open && String(p.featured || '') === '1',
      page_title: share.page_title,
      headline_text: stripTags(p.headline),
      share, donate: petitionDonate(p),
    });
  }
  const open = derived.filter((p) => p.is_open);
  const closed = derived.filter((p) => p.is_closed);
  const featured = open.find((p) => p.is_featured) || null;

  const out = {
    ...content,
    petitions: {
      ...content.petitions,
      items: derived, open, closed,
      has_open: open.length > 0, has_closed: closed.length > 0,
      pages: derived.map((p) => ({ slug: p.slug, path: p.path, petition: p })),
      thanks_pages: open.map((p) => ({ slug: p.slug, path: p.thanks_path, petition: p })),
    },
  };
  if (content.homepage) {
    const { petition: _old, ...homepage } = content.homepage;
    out.homepage = featured ? { ...homepage, petition: featured } : homepage;
  }
  if (Array.isArray(content.projects?.projects)) {
    const withPetitions = projects.map((x) => {
      const slug = String(x.slug || '').trim();
      const mine = (list) => list.filter((p) => String(p.project_slug || '').trim() === slug);
      const o = mine(open);
      const c = mine(closed);
      return { ...x, petitions: o, has_petitions: o.length > 0, closed_petitions: c, has_closed_petitions: c.length > 0 };
    });
    out.projects = { ...content.projects, projects: withPetitions, ...(content.projects.top_projects ? { top_projects: withPetitions.filter((x) => !x.is_sub) } : {}) };
  }
  return out;
}

module.exports = { petitionUrl, petitionShare, petitionDonate, derivePetitions };
