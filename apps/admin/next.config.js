// Next config for the admin app. Server Actions compare the request Origin
// against Host / x-forwarded-host; behind Amplify Hosting's proxy that can
// differ from the public origin, so the public origin (APP_ORIGIN, the same
// value Cognito redirects use) is explicitly allowed.
const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

/** @type {import('next').NextConfig} */
module.exports = {
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
