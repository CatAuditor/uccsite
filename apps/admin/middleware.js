// Lightweight gate: no session cookie → /login. Real verification happens in
// getSession()/requireRole() on every server read — this only shapes routing.
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from './lib/cookies';

// Manifest + icons: fetched by the browser's install flow, sometimes without
// cookies — a redirect to /login there breaks "Add to Home Screen".
const PUBLIC_PATHS = ['/login', '/auth/callback', '/favicon.ico', '/manifest.webmanifest', '/icon1.png', '/apple-icon1.png'];
// /profile is a registered Cognito callback (passkeys/add returns there); it
// is still session-gated by requireSession in the page.

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p)) || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }
  if (!request.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/login', process.env.APP_ORIGIN || request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
