// Next config for the admin app. Server Actions compare the request Origin
// against Host / x-forwarded-host; behind Amplify Hosting's proxy that can
// differ from the public origin, so the public origin (APP_ORIGIN, the same
// value Cognito redirects use) is explicitly allowed.
const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

// Security headers on every admin response (docs/systems/admin.md "Security
// headers"). Amplify Hosting adds none of its own, so without this the admin
// shipped bare (no HSTS, framable). The CSP is deliberately minimal — the
// clickjacking/injection directives that need no allow-list. A full
// script-src needs per-request nonces (Next injects inline scripts) and is
// a separate change.
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // The builder's client components import the block registry
  // (packages/doc-blocks/schema.js, an ES module) into the browser bundle.
  transpilePackages: ['@uccsite/doc-blocks'],
  // Runtime reads of the copied site sources on Amplify (see amplify.yml).
  outputFileTracingIncludes: { '/documents/**': ['./site-src/**/*'], '/styles': ['./site-src/**/*'], '/revisions': ['./site-src/**/*'], '/dev-notes': ['./site-src/docs/**/*'] },
  experimental: {
    serverActions: {
      allowedOrigins: [new URL(appOrigin).host],
      // Documents "Upload a file": a .docx with embedded images is sent to
      // convertUpload as a server-action body (default limit is 1 MB).
      bodySizeLimit: '8mb',
    },
  },
};
