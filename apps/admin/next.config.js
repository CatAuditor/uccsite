// Next config for the admin app. Server Actions compare the request Origin
// against Host / x-forwarded-host; behind Amplify Hosting's proxy that can
// differ from the public origin, so the public origin (APP_ORIGIN, the same
// value Cognito redirects use) is explicitly allowed.
const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

/** @type {import('next').NextConfig} */
module.exports = {
  // Runtime reads of the copied site sources on Amplify (see amplify.yml).
  outputFileTracingIncludes: { '/documents/**': ['./site-src/**/*'], '/styles': ['./site-src/**/*'], '/revisions': ['./site-src/**/*'] },
  experimental: {
    serverActions: {
      allowedOrigins: [new URL(appOrigin).host],
    },
  },
};
