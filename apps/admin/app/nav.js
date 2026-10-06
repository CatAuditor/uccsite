'use client';
// Navigation (client). docs/systems/admin.md "Navigation & phone use".
//
// Desktop (>800px): the sidebar — "Find a page" filter, who is signed in,
// sections as <details> (all open; fold any), current page highlighted.
// Phone: a sticky top bar (brand → home, "Section › Page" so you always know
// where you are, Menu), a fixed bottom tab bar with the four places most
// often checked from a phone + Menu, and the menu itself as a full-screen
// sheet with only the current section expanded. The sheet closes on
// navigation, Escape or the Close/Menu buttons and locks body scroll.
// Groups arrive from RootLayout (server), already filtered by role.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const PHONE = '(max-width: 800px)';

// Bottom tabs: [href, short label, icon path]. "/" is Publish & Status.
const TABS = [
  ['/', 'Home', 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10'],
  ['/documents', 'Documents', 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6'],
  ['/mail', 'Mail', 'M3 6h18v12H3zM3 7l9 6 9-6'],
  ['/tips', 'Tips', 'M4 4h16v11H9l-5 4zM8 8h8M8 11h5'],
];

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

// Longest-prefix match: /documents/abc lights "All documents",
// /documents?category=Reports lights that category (not "All documents"),
// "/" only when exactly on the dashboard. Returns { href, label, group }.
function findActive(groups, current, pathname) {
  let best = null;
  for (const { group, items } of groups) {
    for (const [href, label] of items) {
      const hit = href === '/' ? current === '/'
        : current === href || (!href.includes('?') && pathname.startsWith(href + '/'));
      if (hit && (!best || href.length > best.href.length)) best = { href, label, group };
    }
  }
  return best;
}

export default function Nav({ groups, email, role }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search?.toString() || '';
  const current = query ? `${pathname}?${query}` : pathname;
  const active = useMemo(() => findActive(groups, current, pathname), [groups, current, pathname]);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  // Folded sections. Desktop: none. Phone: everything but the current one,
  // so the sheet opens as a short list of section names plus where you are.
  const [folded, setFolded] = useState(() => new Set());
  useEffect(() => {
    if (!window.matchMedia(PHONE).matches) return;
    setFolded(new Set(groups.map(g => g.group).filter(g => g !== active?.group)));
    // Mount only: afterwards the user's own folding wins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close + clear the filter on every navigation.
  useEffect(() => { setOpen(false); setFilter(''); }, [current]);
  // Escape closes; body scroll is locked while the sheet is up.
  useEffect(() => {
    document.body.classList.toggle('nav-open', open);
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('nav-open'); };
  }, [open]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? groups
      .map(g => ({ ...g, items: g.items.filter(([, label]) => label.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)) }))
      .filter(g => g.items.length)
    : groups;

  const toggleGroup = (group, isOpen) => setFolded(prev => {
    const next = new Set(prev);
    if (isOpen) next.delete(group); else next.add(group);
    return next;
  });

  const tabOn = (href) => !open && !!active
    && (href === '/' ? active.href === '/' : active.href === href || active.href.startsWith(href + '/') || active.href.startsWith(href + '?'));

  return (
    <>
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-bar">
          <Link href="/" className="brand" aria-label="UCC Admin home">
            <img className="brand-mark" src="/icon1.png" alt="" width="30" height="30" />
            <span className="brand-text">UCC Admin<small>Utah Civic Compact</small></span>
          </Link>
          <div className="crumb">
            {active
              ? <><span className="crumb-group">{active.group}</span><span className="crumb-sep"> › </span>{active.label}</>
              : 'UCC Admin'}
          </div>
          <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="sidebar-body"
            onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Menu'}</button>
        </div>
        <div className="sidebar-body" id="sidebar-body">
          <label className="nav-find">
            <span className="sr-only">Find a page</span>
            <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a page…" autoComplete="off" />
          </label>
          <nav aria-label="Admin sections">
            {shown.map(({ group, items }) => (
              <details key={group} className="nav-group" open={q ? true : !folded.has(group)}
                onToggle={(e) => { if (!q) toggleGroup(group, e.currentTarget.open); }}>
                <summary className="nav-group-title">
                  {group}
                  {group === active?.group && folded.has(group) && !q && <span className="nav-here">you are here</span>}
                </summary>
                {items.map(([href, label]) => {
                  const on = href === active?.href;
                  return (
                    <Link key={href} href={href} className={on ? 'nav-link active' : 'nav-link'}
                      aria-current={on ? 'page' : undefined}>{label}</Link>
                  );
                })}
              </details>
            ))}
            {q && !shown.length && <div className="nav-none">No page matches “{filter}”.</div>}
          </nav>
          <div className="session">
            <div className="session-user">{email}</div>
            <div className="session-role">{role}</div>
            <form action="/logout" method="post"><button type="submit" className="signout">Sign out</button></form>
          </div>
        </div>
      </aside>
      <nav className="tabbar" aria-label="Quick navigation">
        {TABS.map(([href, label, d]) => (
          <Link key={href} href={href} className={tabOn(href) ? 'tab active' : 'tab'} onClick={() => setOpen(false)}>
            <Icon d={d} /><span>{label}</span>
          </Link>
        ))}
        <button type="button" className={open ? 'tab active' : 'tab'} aria-expanded={open} aria-controls="sidebar-body"
          onClick={() => setOpen(o => !o)}>
          <Icon d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} /><span>{open ? 'Close' : 'Menu'}</span>
        </button>
      </nav>
    </>
  );
}
