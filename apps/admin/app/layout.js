import Link from 'next/link';
import { getSession } from '../lib/auth';
import { withDb } from '../lib/data';
import './globals.css';

export const metadata = { title: 'UCC Admin' };

// Nav grouped by section (org decision: "site main" / "reports" / …).
// Documents ("Reports"/"Whitepapers") arrive in Phase 8.
const NAV = [
  { group: 'Site Main', items: [
    ['/settings', 'Site Settings'],
    ['/homepage', 'Homepage'],
    ['/team', 'Team & Bios'],
    ['/statements', 'Statements'],
    ['/issues', 'Policy Positions'],
    ['/blog', 'News & Media'],
    ['/projects', 'Projects'],
    ['/coverage', 'Report Coverage'],
    ['/media', 'Media Library'],
  ]},
  // Documents are grouped by their category field (planning addendum 3);
  // the categories are read live in RootLayout and appended after this group.
  { group: 'Documents', items: [['/documents', 'All documents'], ['/styles', 'Styles & rules']] },
  { group: 'Operations', items: [
    ['/', 'Publish & Status'],
    ['/redirects', 'Redirects'],
    ['/donations', 'Donations'],
    ['/subscribers', 'Subscribers'],
    ['/revisions', 'Revisions'],
    ['/audit', 'Audit Log'],
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
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">UCC Admin</div>
            {nav.map(({ group, items }) => (
              <div key={group} className="nav-group">
                <div className="nav-group-title">{group}</div>
                {items.map(([href, label]) => (
                  <Link key={href} href={href} className="nav-link">{label}</Link>
                ))}
              </div>
            ))}
            <div className="session">
              {session ? (
                <>
                  <div className="session-user">{session.email}</div>
                  <div className="session-role">{session.role}</div>
                  <form action="/logout" method="post"><button type="submit" className="nav-link linkish">Sign out</button></form>
                </>
              ) : (
                <Link href="/login" className="nav-link">Sign in</Link>
              )}
            </div>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
