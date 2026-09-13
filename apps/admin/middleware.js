// Lightweight gate: no session cookie → /login. Real verification happens in
// getSession()/requireRole() on every server read — this only shapes routing.
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from './lib/cookies';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/favicon.ico'];

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p)) || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }
  if (!request.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
