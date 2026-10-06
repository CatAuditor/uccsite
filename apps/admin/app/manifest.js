// Web app manifest (Next metadata route → /manifest.webmanifest, linked
// automatically from every page). Lets the admin be installed to a phone's
// home screen as a standalone app (docs/systems/admin.md "Phone / PWA").
// No service worker on purpose: every screen is a live DB read, offline
// would only show stale data, and a cached shell would survive Amplify
// deploys. Icons are app/icon.png + app/apple-icon.png (Next conventions).
export default function manifest() {
  return {
    name: 'UCC Admin',
    short_name: 'UCC Admin',
    description: 'Utah Civic Compact site administration',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f6f4',
    theme_color: '#16281e',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
