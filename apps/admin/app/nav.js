'use client';
// Sidebar navigation (client): the current page is highlighted, sections
// collapse (<details>), and below 800px the sidebar becomes a top bar with a
// Menu button that opens the drawer — closing again on every navigation.
// The groups come from RootLayout (server), which already filtered them by
// session role. docs/systems/admin.md "Navigation" / "Phone / PWA".
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

// Longest-prefix match: /documents/abc lights "All documents",
// /documents?category=Reports lights that category (not "All documents"),
// "/" only when exactly on the dashboard.
function activeHref(groups, current, pathname) {
  let best = null;
  for (const { items } of groups) {
    for (const [href] of items) {
      const hit = href === '/' ? current === '/'
        : current === href || (!href.includes('?') && pathname.startsWith(href + '/'));
      if (hit && (!best || href.length > best.length)) best = href;
    }
  }
  return best;
}

export default function Nav({ groups, email, role }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search?.toString() || '';
  const current = query ? `${pathname}?${query}` : pathname;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [current]);
  const active = activeHref(groups, current, pathname);

  return (
    <aside className={open ? 'sidebar open' : 'sidebar'}>
      <div className="sidebar-bar">
        <div className="brand">UCC Admin</div>
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="sidebar-body"
          onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Menu'}</button>
      </div>
      <div className="sidebar-body" id="sidebar-body">
        <div className="session session-top">
          <div className="session-user">{email}</div>
          <div className="session-role">{role}</div>
          <form action="/logout" method="post"><button type="submit" className="signout">Sign out</button></form>
        </div>
        {groups.map(({ group, items }) => (
          <details key={group} className="nav-group" open>
            <summary className="nav-group-title">{group}</summary>
            {items.map(([href, label]) => (
              <Link key={href} href={href} className={href === active ? 'nav-link active' : 'nav-link'}
                aria-current={href === active ? 'page' : undefined}>{label}</Link>
            ))}
          </details>
        ))}
        <div className="session">
          <form action="/logout" method="post"><button type="submit" className="nav-link linkish">Sign out</button></form>
        </div>
      </div>
    </aside>
  );
}
