import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import Nav from './nav';
import { getSession } from '../lib/auth';
import { withDb } from '../lib/data';
import './globals.css';

export const metadata = {
  title: 'UCC Admin',
  // Installable on phones (app/manifest.js). appleWebApp: iOS standalone mode.
  appleWebApp: { capable: true, title: 'UCC Admin', statusBarStyle: 'default' },
};
// viewportFit cover: the phone tab bar pads itself with env(safe-area-inset-bottom).
// themeColor = the sidebar / top bar (site --navy-dark), so the browser chrome matches.
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f1e33', viewportFit: 'cover' };

// The site's typeface (css/fonts.css self-hosts it for the public pages);
// next/font downloads it at build time and serves it from the admin itself.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], display: 'swap' });

// Nav grouped by section (org decision: "site main" / "reports" / …).
// Documents ("Reports"/"Whitepapers") arrive in Phase 8.
const NAV = [
  // The dashboard (publish queue + status) first: it is what most visits are for.
  { group: 'Overview', items: [['/', 'Publish & Status']] },
  { group: 'Site Main', items: [
    ['/settings', 'Site Settings'],
    ['/navigation', 'Menus (header & footer)'],
    ['/homepage', 'Homepage'],
    ['/appeals', 'Donation appeals'],
    ['/petition', 'Petition'],
    ['/team', 'Team & Bios'],
    ['/statements', 'Statements'],
    ['/issues', 'Policy Positions'],
    ['/press', 'Press & coverage'],
    ['/projects', 'Projects'],
    ['/media', 'Media Library'],
    ['/files', 'Files'],
  ]},
  // Documents are grouped by their category field (planning addendum 3);
  // the categories are read live in RootLayout and appended after this group.
  { group: 'Documents', items: [['/documents', 'All documents'], ['/styles', 'Styles & rules']] },
  // Mail (2026-10-05): newsletters are composed, reviewed and sent here;
  // the mailing list is the audience they reach (docs/systems/newsletters.md).
  { group: 'Mail', items: [['/mail', 'Outgoing emails'], ['/subscribers', 'Mailing list']] },
  { group: 'Operations', items: [
    ['/redirects', 'Redirects'],
    ['/donations', 'Donations'],
    ['/tips', 'Tips'],
    ['/revisions', 'Revisions'],
    ['/audit', 'Audit Log'],
    ['/dev-notes', 'Development notes'],
  ]},
  { group: 'Account', items: [['/profile', 'My profile & security']], owner: [['/users', 'Users & roles']] },
];

async function documentCategories() {
  try {
    const res = await withDb((client) => client.query(
      `SELECT category, count(*)::int AS n FROM documents GROUP BY category ORDER BY category NULLS LAST`));
    return res.rows.map(r => [`/documents?category=${encodeURIComponent(r.category || 'Uncategorized')}`, `${r.category || 'Uncategorized'} (${r.n})`]);
  } catch (err) {
    console.warn(`[admin] nav categories unavailable: ${err.message}`);
    return [];
  }
}

export default async function RootLayout({ children }) {
  const session = await getSession();
  const categories = session ? await documentCategories() : [];
  const nav = NAV.map(g => {
    if (g.group === 'Documents') return { ...g, items: [...g.items, ...categories] };
    if (g.owner) return { ...g, items: [...g.items, ...(session?.role === 'owner' ? g.owner : [])] };
    return g;
  });
  // Signed out (or ungrouped): nothing but the page itself — no sidebar,
  // no section names. The tabs exist only for a verified session.
  if (!session) {
    return (
      <html lang="en">
        <body className={inter.className}>
          <main className="content login-only">{children}</main>
        </body>
      </html>
    );
  }
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="shell">
          {/* Suspense: Nav reads useSearchParams, which Next needs bounded for the
              statically prerendered error pages. */}
          <Suspense fallback={<aside className="sidebar"><div className="sidebar-bar"><div className="brand"><img className="brand-mark" src="/icon1.png" alt="" width="30" height="30" /><span className="brand-text">UCC Admin</span></div></div></aside>}>
            <Nav groups={nav.map(({ group, items }) => ({ group, items }))} email={session.email} role={session.role} />
          </Suspense>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
