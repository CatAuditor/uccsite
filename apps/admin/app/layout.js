import { Suspense } from 'react';
import Nav from './nav';
import { getSession } from '../lib/auth';
import { withDb } from '../lib/data';
import './globals.css';

export const metadata = {
  title: 'UCC Admin',
  // Installable on phones (app/manifest.js). appleWebApp: iOS standalone mode.
  appleWebApp: { capable: true, title: 'UCC Admin', statusBarStyle: 'default' },
};
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#16281e' };

// Nav grouped by section (org decision: "site main" / "reports" / …).
// Documents ("Reports"/"Whitepapers") arrive in Phase 8.
const NAV = [
  { group: 'Site Main', items: [
    ['/settings', 'Site Settings'],
    ['/homepage', 'Homepage'],
    ['/appeals', 'Donation appeals'],
    ['/petition', 'Petition'],
    ['/team', 'Team & Bios'],
    ['/statements', 'Statements'],
    ['/issues', 'Policy Positions'],
    ['/blog', 'News & Media'],
    ['/projects', 'Projects'],
    ['/coverage', 'Report Coverage'],
    ['/media', 'Media Library'],
    ['/files', 'Files'],
  ]},
  // Documents are grouped by their category field (planning addendum 3);
  // the categories are read live in RootLayout and appended after this group.
  { group: 'Documents', items: [['/documents', 'All documents'], ['/styles', 'Styles & rules']] },
  // Mail (2026-10-05): newsletters are composed, reviewed and sent here;
  // the mailing list is the audience they reach (docs/systems/newsletters.md).
  { group: 'Mail', items: [['/mail', 'Newsletters'], ['/subscribers', 'Mailing list']] },
  { group: 'Operations', items: [
    ['/', 'Publish & Status'],
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
        <body>
          <main className="content login-only">{children}</main>
        </body>
      </html>
    );
  }
  return (
    <html lang="en">
      <body>
        <div className="shell">
          {/* Suspense: Nav reads useSearchParams, which Next needs bounded for the
              statically prerendered error pages. */}
          <Suspense fallback={<aside className="sidebar"><div className="sidebar-bar"><div className="brand">UCC Admin</div></div></aside>}>
            <Nav groups={nav.map(({ group, items }) => ({ group, items }))} email={session.email} role={session.role} />
          </Suspense>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
