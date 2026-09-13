import Link from 'next/link';
import { getSession } from '../lib/auth';
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
  ]},
  { group: 'Reports', items: [['/documents', 'Long-form Documents']] },
  { group: 'Operations', items: [
    ['/', 'Publish & Status'],
    ['/donations', 'Donations'],
    ['/revisions', 'Revisions'],
    ['/audit', 'Audit Log'],
  ]},
];

export default async function RootLayout({ children }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">UCC Admin</div>
            {NAV.map(({ group, items }) => (
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
                  <a href="/logout" className="nav-link">Sign out</a>
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
