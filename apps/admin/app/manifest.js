// Web app manifest (Next metadata route → /manifest.webmanifest, linked
// automatically from every page). Lets the admin be installed to a phone's
// home screen as a standalone app (docs/systems/admin.md "Phone / PWA").
// Icons are the numbered conventions (icon1 / apple-icon1): Next serves
// app/icon*.png as immutable, max-age 1 year, and this manifest cannot carry
// the content hash the <link> tags get, so a changed icon needs a new number
// or phones keep the old one for a year.
// No service worker on purpose: every screen is a live DB read, offline
// would only show stale data, and a cached shell would survive Amplify
// deploys. Icons are app/icon1.png + app/apple-icon1.png (Next conventions).
export default function manifest() {
  return {
    name: 'UCC Admin',
    short_name: 'UCC Admin',
    description: 'Utah Civic Compact site administration',
    start_url: '/',
    display: 'standalone',
    // Icons are the UCC mark flattened onto site navy (--navy), padded for
    // maskable launchers; background_color matches so the splash is seamless.
    background_color: '#1b2f4e',
    theme_color: '#0f1e33',
    icons: [
      { src: '/icon1.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/apple-icon1.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
